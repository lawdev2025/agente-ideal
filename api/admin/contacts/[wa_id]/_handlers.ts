// Handlers por contato reunidos (prefixo "_" → NÃO vira Serverless Function).
// O roteador é api/admin/contacts/[wa_id]/[action].ts, que despacha por
// ?action: "messages" (GET histórico / POST takeover) e "pause" (PATCH).
// URLs do front inalteradas; consolidado p/ caber no limite Hobby (≤12).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../../../_lib/cors";
import { requireUser, checkAdminAuth } from "../../../_lib/auth";
import { getSupabase } from "../../../../src/db/supabase-client";
import { config as appConfig } from "../../../../src/config";
import { StateRepository } from "../../../../src/state/repository";
import { WhatsAppClient } from "../../../../src/whatsapp/client";
import { logger } from "../../../../src/logger";

// Singletons por warm function (mesmo padrao do webhook).
const repo = new StateRepository();
const whatsapp = new WhatsAppClient(
  appConfig.whatsapp.accessToken,
  appConfig.whatsapp.phoneNumberId,
  appConfig.whatsapp.businessAccountId
);

// A Meta às vezes não devolve o id ("unknown"): aí a mensagem só não pode ser citada.
const wamidOf = (sent: { messageId: string }) =>
  sent.messageId && sent.messageId !== "unknown" ? sent.messageId : undefined;

// /api/admin/contacts/:wa_id/messages — GET histórico, POST takeover humano
export async function messages(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;

  const authUser = requireUser(req, res);
  if (!authUser) return;

  const wa_id = (req.query.wa_id as string) || "";
  if (!wa_id) { res.status(400).json({ error: "wa_id required" }); return; }

  // Escopo de unidade: atendente só acessa contato da própria unidade.
  if (authUser.role === "unit") {
    const sbAuth = getSupabase();
    const { data: ct } = await sbAuth.from("contacts").select("unit_tag").eq("wa_id", wa_id).maybeSingle();
    if (!ct || (ct as any).unit_tag !== authUser.unit) {
      res.status(403).json({ error: "Sem acesso a este contato" });
      return;
    }
  }

  // GET — histórico da conversa (paginado).
  // ?limit=N (default 50, máx 200) e ?before=<created_at> (cursor, exclusivo).
  // Retorna as N mensagens mais recentes anteriores ao cursor, em ordem
  // ascendente. hasMore indica se ainda há histórico mais antigo pra carregar.
  if (req.method === "GET") {
    try {
      const sb = getSupabase();
      const limit = Math.min(
        Math.max(parseInt((req.query.limit as string) || "50", 10) || 50, 1),
        200
      );
      const before = req.query.before ? Number(req.query.before) : null;

      const BASE_COLS = "id, wa_id, role, content, created_at, media_type, media_url, media_mime, media_filename, agent_name";
      const page = (cols: string) => {
        let q = sb
          .from("messages")
          .select(cols)
          .eq("wa_id", wa_id)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(limit);
        if (before != null && !Number.isNaN(before)) q = q.lt("created_at", before);
        return q;
      };

      // Colunas do "responder" (supabase-message-reply.sql); sem a migração,
      // cai no select antigo e o painel só não mostra o botão de responder.
      let { data, error } = await page(`${BASE_COLS}, wa_message_id, reply_to_id`);
      if (error) ({ data } = await page(BASE_COLS));
      const batch = ((data || []) as unknown) as any[];
      const hasMore = batch.length === limit;
      // Veio descendente (do mais novo pro mais antigo); inverte pra ascendente.
      const msgs = batch.slice().reverse();

      // Citação: anexa a mensagem respondida (pode estar fora desta página).
      const replyIds = [...new Set(msgs.map((m) => m.reply_to_id).filter((v) => v != null))];
      if (replyIds.length) {
        const { data: quoted } = await sb
          .from("messages")
          .select("id, role, content, media_type, agent_name")
          .eq("wa_id", wa_id)
          .in("id", replyIds);
        const byQuotedId = new Map(((quoted || []) as any[]).map((q) => [q.id, q]));
        for (const m of msgs) if (m.reply_to_id != null) m.reply_to = byQuotedId.get(m.reply_to_id) ?? null;
      }
      res.status(200).json({ messages: msgs, hasMore });
    } catch (error) {
      logger.error({ error, wa_id }, "Erro em GET /api/admin/contacts/:wa_id/messages");
      res.status(500).json({ error: "Internal error" });
    }
    return;
  }

  // POST — atendente humano responde pelo painel (takeover).
  // Envia pelo WhatsApp, salva no histórico e PAUSA o bot pra ele não responder
  // junto. A próxima mensagem do cliente fica pro humano até clicar "Retomar Bot".
  if (req.method === "POST") {
    const body = (req.body || {}) as {
      text?: string;
      mediaUrl?: string;
      mediaType?: string;
      caption?: string;
      filename?: string;
      replyToId?: number; // messages.id da mensagem citada ("responder")
    };
    const text = (body.text || "").trim();
    const mediaUrl = (body.mediaUrl || "").trim();
    const mediaType = (body.mediaType || "").trim();

    if (!text && !mediaUrl) {
      res.status(400).json({ error: "Body must contain text or mediaUrl" });
      return;
    }

    // Responder: busca o wamid da mensagem citada — é ele que faz a mensagem
    // chegar pro cliente como "respondendo a".
    let replyToId: number | undefined;
    let replyWamid: string | undefined;
    if (body.replyToId != null) {
      const { data: quoted, error: qErr } = await getSupabase()
        .from("messages")
        .select("id, wa_message_id")
        .eq("wa_id", wa_id)
        .eq("id", Number(body.replyToId))
        .maybeSingle();
      if (qErr || !(quoted as any)?.wa_message_id) {
        res.status(422).json({ error: "Não dá pra responder essa mensagem (é antiga). Envie sem citar." });
        return;
      }
      replyToId = (quoted as any).id;
      replyWamid = (quoted as any).wa_message_id;
    }

    try {
      await repo.pauseBot(wa_id, "Atendimento humano via painel");

      if (mediaUrl) {
        const caption = (body.caption || "").trim();
        const filename = (body.filename || "").trim();

        let sent: { messageId: string };
        if (mediaType === "image" || mediaType === "sticker") {
          sent = await whatsapp.sendImage(wa_id, mediaUrl, caption || undefined, replyWamid);
        } else if (mediaType === "video") {
          sent = await whatsapp.sendVideo(wa_id, mediaUrl, caption || undefined, replyWamid);
        } else if (mediaType === "audio") {
          sent = await whatsapp.sendAudio(wa_id, mediaUrl, replyWamid);
        } else {
          // document or unknown
          sent = await whatsapp.sendDocument(wa_id, mediaUrl, filename || undefined, replyWamid);
        }

        const content = caption || (filename ? `[documento: ${filename}]` : `[${mediaType || 'arquivo'}]`);
        await repo.appendMessage(wa_id, "assistant", content, {
          media_type: mediaType || "document",
          media_url: mediaUrl,
          media_filename: filename || undefined,
        }, authUser.name, { wa_message_id: wamidOf(sent), reply_to_id: replyToId });
      } else {
        const sent = await whatsapp.sendMessage(wa_id, text, replyWamid);
        await repo.appendMessage(wa_id, "assistant", text, undefined, authUser.name, {
          wa_message_id: wamidOf(sent),
          reply_to_id: replyToId,
        });
      }

      res.status(200).json({ ok: true, wa_id });
    } catch (error: any) {
      const apiErr = error?.response?.data?.error;
      const code = apiErr?.code;
      const friendly =
        code === 131047 || code === 131051
          ? "Não dá pra enviar: faz mais de 24h que o cliente não escreve."
          : apiErr?.message || "Falha ao enviar pelo WhatsApp.";
      logger.error({ error, wa_id, code }, "Erro em POST /api/admin/contacts/:wa_id/messages");
      res.status(422).json({ error: friendly, code: code ?? null });
    }
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}

// /api/admin/contacts/:wa_id/pause — PATCH pausa/retoma o bot
export async function pause(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== "PATCH") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!checkAdminAuth(req, res)) return;

  const wa_id = (req.query.wa_id as string) || "";
  if (!wa_id) {
    res.status(400).json({ error: "wa_id required" });
    return;
  }

  const body = (req.body || {}) as { paused?: boolean };
  if (typeof body.paused !== "boolean") {
    res.status(400).json({ error: "Body must contain { paused: boolean }" });
    return;
  }

  try {
    if (body.paused) {
      await repo.pauseBot(wa_id, "Pausado via painel admin");
    } else {
      await repo.resumeBot(wa_id);
    }
    res.status(200).json({ ok: true, wa_id, bot_paused: body.paused });
  } catch (error) {
    logger.error({ error, wa_id }, "Erro em PATCH /api/admin/contacts/:wa_id/pause");
    res.status(500).json({ error: "Internal error" });
  }
}
