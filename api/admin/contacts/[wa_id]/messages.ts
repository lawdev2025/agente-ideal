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

  // GET — histórico da conversa
  if (req.method === "GET") {
    try {
      const sb = getSupabase();
      const { data } = await sb
        .from("messages")
        .select("id, wa_id, role, content, created_at")
        .eq("wa_id", wa_id)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      res.status(200).json({ messages: data || [] });
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
    const body = (req.body || {}) as { text?: string };
    const text = (body.text || "").trim();
    if (!text) {
      res.status(400).json({ error: "Body must contain non-empty { text }" });
      return;
    }

    try {
      // 1. Garante que o bot fica pausado (assumimos o contato).
      await repo.pauseBot(wa_id, "Atendimento humano via painel");

      // 2. Envia pelo WhatsApp Cloud API. Pode falhar fora da janela de 24h.
      await whatsapp.sendMessage(wa_id, text);

      // 3. Registra no histórico (role assistant → aparece como mensagem enviada).
      await repo.appendMessage(wa_id, "assistant", text);

      res.status(200).json({ ok: true, wa_id });
    } catch (error: any) {
      // Erro mais comum: janela de 24h fechada (cliente não escreve há +24h) —
      // o WhatsApp exige template aprovado nesse caso. Devolvemos 422 com uma
      // mensagem amigável pro painel mostrar, sem quebrar.
      const apiErr = error?.response?.data?.error;
      const code = apiErr?.code;
      const friendly =
        code === 131047 || code === 131051
          ? "Não dá pra enviar: faz mais de 24h que o cliente não escreve. Ele precisa mandar uma mensagem primeiro (regra do WhatsApp)."
          : apiErr?.message || "Falha ao enviar a mensagem pelo WhatsApp.";
      logger.error({ error, wa_id, code }, "Erro em POST /api/admin/contacts/:wa_id/messages");
      res.status(422).json({ error: friendly, code: code ?? null });
    }
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
