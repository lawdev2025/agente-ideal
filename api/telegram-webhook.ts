import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";
import { config } from "../src/config";
import { logger } from "../src/logger";
import { StateRepository } from "../src/state/repository";

const repo = new StateRepository();

// Telegram update -> nosso handler. Aceita o comando /retomar <wa_id>
// (ou /retomar_<wa_id>, formato que o Telegram gera quando o admin clica
// num link tg://... no app) e despausa o contato.
//
// Setup: aponte o webhook do Telegram pra esta URL via:
//   curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<seu-deploy>/api/telegram-webhook&secret_token=<TG_WEBHOOK_SECRET>"
//
// Adicione TG_WEBHOOK_SECRET nas env vars do Vercel para autenticar.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  // Telegram envia esse header se você configurou secret_token no setWebhook.
  // Sem env var configurada, pula a checagem (modo dev).
  const expected = process.env.TG_WEBHOOK_SECRET || "";
  if (expected) {
    const got = (req.headers["x-telegram-bot-api-secret-token"] as string) || "";
    if (got !== expected) {
      logger.warn("Telegram webhook: bad secret token");
      res.status(403).send("Forbidden");
      return;
    }
  }

  try {
    const body: any = req.body || {};
    const message = body.message || body.edited_message;
    if (!message?.text) {
      res.status(200).json({ ok: true });
      return;
    }

    const chatId = String(message.chat?.id ?? "");
    // Aceita só do grupo configurado (mesmo do escalation), pra ninguém
    // de fora conseguir retomar bot de cliente.
    if (chatId && config.telegram.chatId && chatId !== String(config.telegram.chatId)) {
      logger.warn({ chatId }, "Telegram webhook: chat não autorizado");
      res.status(200).json({ ok: true });
      return;
    }

    const text = String(message.text).trim();
    // Aceita: "/retomar 5591..." ou "/retomar_5591..." ou "/retomar@BotName 5591..."
    const match = text.match(/^\/retomar(?:@\w+)?[\s_]+([\d+]+)\b/i);
    if (!match) {
      res.status(200).json({ ok: true });
      return;
    }
    const waId = match[1].replace(/\D/g, "");
    if (!waId) {
      await replyTelegram(chatId, "❌ Formato inválido. Use: <code>/retomar &lt;wa_id&gt;</code>");
      res.status(200).json({ ok: true });
      return;
    }

    try {
      await repo.resumeBot(waId);
      logger.info({ waId }, "Bot retomado via comando /retomar do Telegram");
      await replyTelegram(
        chatId,
        `✅ Bot retomado para <code>${waId}</code>. Próxima mensagem do cliente já volta pra IA.`
      );
    } catch (err) {
      logger.error({ err, waId }, "Falha ao retomar bot via Telegram");
      await replyTelegram(
        chatId,
        `⚠️ Não consegui retomar <code>${waId}</code>. Veja o painel admin.`
      );
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    logger.error({ error }, "Telegram webhook error");
    res.status(500).send("Internal error");
  }
}

async function replyTelegram(chatId: string, text: string): Promise<void> {
  try {
    await axios.post(
      `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`,
      { chat_id: chatId, text, parse_mode: "HTML" }
    );
  } catch (err) {
    logger.error({ err }, "Falha ao responder no Telegram");
  }
}
