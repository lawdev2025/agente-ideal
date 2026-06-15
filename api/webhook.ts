import type { VercelRequest, VercelResponse } from "@vercel/node";
import { config as appConfig } from "../src/config";
import { logger } from "../src/logger";
import { validateMetaSignature } from "../src/webhook/signature";
import { StateRepository } from "../src/state/repository";
import { shouldProcessMessage } from "../src/state/dedupe";
import { buildProfileNameMap } from "../src/webhook/contacts";
import { classifyContactTag, unitAbbrev } from "../src/kb/contact-tags";
import { detectUnit } from "../src/worker/intent-router";
import { ClaudeProvider } from "../src/llm/claude";
import { GeminiProvider } from "../src/llm/gemini";
import { WhatsAppClient } from "../src/whatsapp/client";
import { EscalationHandler } from "../src/handoff/telegram";
import { MessageOrchestrator } from "../src/worker/orchestrator";
import { LearningRepository } from "../src/learning/repository";
import { sendPushToAll } from "../src/push/web-push";

// Vercel exige `export const config` no top-level pra disable bodyParser
// (precisamos do raw body pra validar a assinatura HMAC do webhook Meta).
export const config = {
  api: {
    bodyParser: false,
  },
};

// Singletons por warm function (recriados em cold start, mas duram entre
// invocacoes da mesma instancia warm — economiza ~200ms por chamada).
const stateRepo = new StateRepository();
const llmProvider =
  appConfig.llmProvider === "claude"
    ? new ClaudeProvider(appConfig.claude.apiKey, appConfig.claude.model)
    : new GeminiProvider(appConfig.gemini.apiKey, appConfig.gemini.model);
const whatsappClient = new WhatsAppClient(
  appConfig.whatsapp.accessToken,
  appConfig.whatsapp.phoneNumberId,
  appConfig.whatsapp.businessAccountId
);
const escalationHandler = new EscalationHandler(
  appConfig.telegram.botToken,
  appConfig.telegram.chatId
);
const learningRepo = new LearningRepository();
const orchestrator = new MessageOrchestrator(
  llmProvider,
  stateRepo,
  whatsappClient,
  escalationHandler,
  learningRepo
);

async function readRawBody(req: VercelRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as any) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// CRM IDEAL: depois de processar a mensagem, se o bot acabou ficando PAUSADO
// (handoff humano ou contato ja em atendimento manual), avisa o celular do
// atendente via Web Push. Bot ativo respondendo sozinho nao gera push. Nunca
// lanca — push e best-effort e nao pode derrubar o webhook.
async function notifyIncoming(
  senderId: string,
  text: string,
  name?: string
): Promise<void> {
  try {
    const paused = await stateRepo.isBotPaused(senderId);
    const who = name || senderId;
    await sendPushToAll({
      title: paused
        ? `🔴 ${who} precisa de atendimento`
        : `Nova mensagem de ${who}`,
      body: text.length > 120 ? text.slice(0, 117) + "..." : text,
      wa_id: senderId,
      tag: `crm-ideal-${senderId}`,
      // Bot pausado = conversa no ponto de atendimento humano → heads-up.
      urgent: paused,
    });
  } catch (pushErr) {
    logger.warn({ pushErr, senderId }, "Falha ao enviar push (ignorado)");
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // GET: verificacao do webhook pela Meta
  if (req.method === "GET") {
    const mode = (req.query["hub.mode"] || req.query.mode) as string;
    const token = (req.query["hub.verify_token"] || req.query.token) as string;
    const challenge = (req.query["hub.challenge"] || req.query.challenge) as string;
    if (mode === "subscribe" && token === appConfig.webhook.verifyToken) {
      logger.info("Webhook verified");
      res.status(200).send(challenge);
      return;
    }
    res.status(403).send("Forbidden");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  // POST: validar assinatura
  try {
    const signature = (req.headers["x-hub-signature-256"] as string) || "";
    if (!signature) {
      logger.warn("Missing signature header");
      res.status(400).send("Missing signature");
      return;
    }
    const rawBody = await readRawBody(req);
    const isValid = validateMetaSignature(
      rawBody,
      signature.replace("sha256=", ""),
      appConfig.webhook.secret
    );
    if (!isValid) {
      logger.warn("Invalid signature");
      res.status(403).send("Invalid signature");
      return;
    }

    const body = JSON.parse(rawBody);

    if (body.object === "whatsapp_business_account") {
      for (const entry of body.entry || []) {
        // Formato WhatsApp Cloud API (changes/value/messages)
        for (const change of entry.changes || []) {
          const nameByWaId = buildProfileNameMap(change.value);
          const messages = change.value?.messages || [];
          for (const msg of messages) {
            if (msg.type !== "text" || !msg.text?.body) continue;
            const messageId = msg.id as string;
            const senderId = msg.from as string;
            const text = msg.text.body as string;
            const tsSec = Number(msg.timestamp);

            const guard = await shouldProcessMessage(tsSec, messageId);
            if (!guard.ok) {
              logger.warn(
                { messageId, senderId, reason: guard.reason },
                "Mensagem descartada"
              );
              continue;
            }

            logger.info({ messageId, senderId }, "Received message");

            try {
              await stateRepo.getOrCreateContact(senderId, nameByWaId[senderId]);
              await stateRepo.updateLastSeen(senderId);
              await stateRepo.appendMessage(senderId, "user", text);
              const tag = classifyContactTag(text);
              if (tag) await stateRepo.setContactTag(senderId, tag);
              const unitTag = unitAbbrev(detectUnit(text));
              if (unitTag) await stateRepo.setContactUnitTag(senderId, unitTag);
              await orchestrator.processMessage(senderId, text, senderId);
              await notifyIncoming(senderId, text, nameByWaId[senderId]);
            } catch (procErr) {
              logger.error(
                { error: procErr, messageId },
                "Erro ao processar msg"
              );
            }
          }
        }
        // Compat com formato antigo (Messenger-style entry.messaging)
        for (const msg of entry.messaging || []) {
          if (!msg.message?.text) continue;
          const messageId = msg.message.mid as string;
          const senderId = msg.sender.id as string;
          const text = msg.message.text as string;
          const tsMs = Number(msg.timestamp);

          const guard = await shouldProcessMessage(tsMs, messageId);
          if (!guard.ok) {
            logger.warn(
              { messageId, senderId, reason: guard.reason },
              "Mensagem descartada"
            );
            continue;
          }

          try {
            await stateRepo.getOrCreateContact(senderId);
            await stateRepo.updateLastSeen(senderId);
            await stateRepo.appendMessage(senderId, "user", text);
            const legacyTag = classifyContactTag(text);
            if (legacyTag) await stateRepo.setContactTag(senderId, legacyTag);
            const legacyUnitTag = unitAbbrev(detectUnit(text));
            if (legacyUnitTag) await stateRepo.setContactUnitTag(senderId, legacyUnitTag);
            await orchestrator.processMessage(senderId, text, senderId);
            await notifyIncoming(senderId, text);
          } catch (procErr) {
            logger.error(
              { error: procErr, messageId },
              "Erro ao processar msg"
            );
          }
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Webhook processing error"
    );
    res.status(500).send("Internal error");
  }
}
