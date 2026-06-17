import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../../../_lib/cors";
import { checkAdminAuth } from "../../../_lib/auth";
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (!checkAdminAuth(req, res)) return;

  const wa_id = (req.query.wa_id as string) || "";
  if (!wa_id) {
    res.status(400).json({ error: "wa_id required" });
    return;
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
        .select("id, wa_id, role, content, created_at, media_type, media_url, media_mime, media_filename")
        .eq("wa_id", wa_id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);
      if (before != null && !Number.isNaN(before)) q = q.lt("created_at", before);

      const { data } = await q;
      const batch = data || [];
      const hasMore = batch.length === limit;
      // Veio descendente (do mais novo pro mais antigo); inverte pra ascendente.
      const messages = batch.slice().reverse();
      res.status(200).json({ messages, hasMore });
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
        });
      } else {
        await whatsapp.sendMessage(wa_id, text);
        await repo.appendMessage(wa_id, "assistant", text);
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
