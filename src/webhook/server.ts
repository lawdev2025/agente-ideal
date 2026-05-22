import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { validateMetaSignature } from "./signature";
import { logger } from "../logger";
import { config } from "../config";
import { StateRepository } from "../state/repository";
import { createQueueDb } from "../queue/db";

export interface WebhookPayload {
  object: string;
  entry?: Array<{
    id: string;
    time: number;
    messaging?: Array<{
      sender: { id: string };
      recipient: { id: string };
      timestamp: number;
      message?: {
        mid: string;
        text: string;
        attachments?: Array<{ type: string; payload: unknown }>;
      };
    }>;
  }>;
}

export async function createWebhookServer(
  stateRepository: StateRepository
): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
        },
      },
    },
  });

  // Enable CORS for local testing
  await fastify.register(cors, {
    origin: true,
  });

  // Health check
  fastify.get("/health", async () => {
    return { status: "ok" };
  });

  // Get latest response for a user (for testing)
  fastify.get<{ Querystring: { userId: string } }>(
    "/api/response",
    async (request, reply) => {
      const userId = request.query.userId;
      if (!userId) {
        reply.code(400).send({ error: "Missing userId" });
        return;
      }

      try {
        const queueDb = await createQueueDb();
        // Get the latest assistant message for this user
        const db = (queueDb as any).getDb();
        const latestResponse = db
          .prepare(
            `SELECT content FROM messages
             WHERE wa_id = ? AND role = 'assistant'
             ORDER BY created_at DESC LIMIT 1`
          )
          .get(userId) as any;

        if (latestResponse) {
          reply.send({ response: latestResponse.content });
        } else {
          reply.code(404).send({ error: "No response yet" });
        }
      } catch (error) {
        logger.error({ error, userId }, "Error fetching response");
        reply.code(500).send({ error: "Internal error" });
      }
    }
  );

  // Webhook verification (Meta)
  fastify.get<{ Querystring: { mode: string; token: string; challenge: string } }>(
    "/webhook",
    async (request, reply) => {
      const mode = request.query.mode;
      const token = request.query.token;
      const challenge = request.query.challenge;

      if (
        mode === "subscribe" &&
        token === config.webhook.verifyToken
      ) {
        logger.info("Webhook verified");
        reply.code(200).send(challenge);
        return;
      }

      reply.code(403).send("Forbidden");
    }
  );

  // Webhook receiver
  fastify.post<{ Body: WebhookPayload }>("/webhook", async (request, reply) => {
    try {
      const signature = request.headers["x-hub-signature-256"] as string;

      if (!signature) {
        logger.warn("Missing signature header");
        reply.code(400).send("Missing signature");
        return;
      }

      const payload = JSON.stringify(request.body);
      const isValid = validateMetaSignature(
        payload,
        signature.replace("sha256=", ""),
        config.webhook.secret
      );

      if (!isValid) {
        logger.warn("Invalid signature");
        reply.code(403).send("Invalid signature");
        return;
      }

      const body = request.body as WebhookPayload;

      if (body.object === "whatsapp_business_account") {
        logger.info({ entries: body.entry?.length }, "Processing WhatsApp webhook");

        for (const entry of body.entry || []) {
          for (const message of entry.messaging || []) {
            if (message.message?.text) {
              const messageId = message.message.mid;
              const senderId = message.sender.id;
              const text = message.message.text;

              logger.info(
                { messageId, senderId, textLength: text.length },
                "Received message"
              );

              // Store in database queue for processing
              const queueDb = await createQueueDb();
              await queueDb.addMessage({
                messageId,
                senderId,
                text,
                platform: "whatsapp",
              });

              // Store conversation state
              stateRepository.appendMessage(senderId, "user", text);
            }
          }
        }
      }

      reply.code(200).send({ received: true });
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }, "Webhook processing error");
      reply.code(500).send("Internal error");
    }
  });

  return fastify;
}

export async function startWebhookServer(
  stateRepository: StateRepository,
  port: number = 3000
) {
  const fastify = await createWebhookServer(stateRepository);

  await fastify.listen({ port, host: "0.0.0.0" });

  logger.info({ port }, "Webhook server started");

  return fastify;
}
