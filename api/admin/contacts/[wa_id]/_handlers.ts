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

      let q = sb
        .from("messages")
        .select("id, wa_id, role, content, created_at, media_type, media_url, media_mime, media_filename, agent_name")
        .eq("wa_id", wa_id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);
      if (before != null && !Number.isNaN(before)) q = q.lt("created_at", before);

      const { data } = await q;
      const batch = data || [];
      const hasMore = batch.length === limit;
      // Veio descendente (do mais novo pro mais antigo); inverte pra ascendente.
      const msgs = batch.slice().reverse();
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
    };
    const text = (body.text || "").trim();
    const mediaUrl = (body.mediaUrl || "").trim();
    const mediaType = (body.mediaType || "").trim();

    if (!text && !mediaUrl) {
      res.status(400).json({ error: "Body must contain text or mediaUrl" });
      return;
    }

    try {
      await repo.pauseBot(wa_id, "Atendimento humano via painel");

      if (mediaUrl) {
        const caption = (body.caption || "").trim();
        const filename = (body.filename || "").trim();

        if (mediaType === "image" || mediaType === "sticker") {
          await whatsapp.sendImage(wa_id, mediaUrl, caption || undefined);
        } else if (mediaType === "video") {
          await whatsapp.sendVideo(wa_id, mediaUrl, caption || undefined);
        } else if (mediaType === "audio") {
          await whatsapp.sendAudio(wa_id, mediaUrl);
        } else {
          // document or unknown
          await whatsapp.sendDocument(wa_id, mediaUrl, filename || undefined);
        }

        const content = caption || (filename ? `[documento: ${filename}]` : `[${mediaType || 'arquivo'}]`);
        await repo.appendMessage(wa_id, "assistant", content, {
          media_type: mediaType || "document",
          media_url: mediaUrl,
          media_filename: filename || undefined,
        }, authUser.name);
      } else {
        await whatsapp.sendMessage(wa_id, text);
        await repo.appendMessage(wa_id, "assistant", text, undefined, authUser.name);
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
