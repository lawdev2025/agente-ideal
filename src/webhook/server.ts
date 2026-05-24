import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import staticFiles from "@fastify/static";
import path from "path";
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

  // Serve the admin panel at /admin
  const adminPanelPath = path.resolve(__dirname, "../../admin-panel");
  await fastify.register(staticFiles, {
    root: adminPanelPath,
    prefix: "/admin",
    decorateReply: false,
  });

  // Inject credentials as JS globals so admin panel connects automatically
  fastify.get("/admin/config.js", async (_req, reply) => {
    reply.header("Content-Type", "application/javascript");
    return `window.__ADMIN_CONFIG__ = ${JSON.stringify({
      SUPABASE_URL: config.database.supabaseUrl || "",
      SUPABASE_ANON_KEY: config.database.supabaseAnonKey || "",
      ADMIN_TOKEN: config.adminToken || "",
      BACKEND_URL: "",
    })};`;
  });

  // Health check
  fastify.get("/health", async () => {
    return { status: "ok" };
  });

  // Get Supabase configurations (also exposes ADMIN_TOKEN for the admin panel)
  fastify.get("/api/config", async () => {
    return {
      SUPABASE_URL: config.database.supabaseUrl || "",
      SUPABASE_ANON_KEY: config.database.supabaseAnonKey || "",
      ADMIN_TOKEN: config.adminToken || "",
    };
  });

  // Admin: toggle bot pause for a contact
  fastify.patch<{
    Params: { wa_id: string };
    Body: { paused: boolean };
  }>("/api/admin/contacts/:wa_id/pause", async (request, reply) => {
    const authHeader = request.headers["authorization"] || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token || token !== config.adminToken) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }

    const { wa_id } = request.params;
    const { paused } = request.body;

    if (typeof paused !== "boolean") {
      reply.code(400).send({ error: "Body must contain { paused: boolean }" });
      return;
    }

    try {
      if (paused) {
        stateRepository.pauseBot(wa_id, "Pausado via painel admin");
      } else {
        stateRepository.resumeBot(wa_id);
      }
      reply.send({ ok: true, wa_id, bot_paused: paused });
    } catch (error) {
      logger.error({ error, wa_id }, "Error toggling bot pause via admin panel");
      reply.code(500).send({ error: "Internal error" });
    }
  });

  // Admin: dashboard stats (reads from SQLite — always reliable, auto-updates)
  fastify.get("/api/admin/stats", async (request, reply) => {
    const authHeader = request.headers["authorization"] || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token || token !== config.adminToken) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }
    try {
      const { getDatabase } = await import("../db/connection");
      const db = getDatabase();

      const totalMessages = (db.prepare(`SELECT COUNT(*) AS c FROM messages`).get() as { c: number }).c;
      const totalContacts = (db.prepare(`SELECT COUNT(*) AS c FROM contacts`).get() as { c: number }).c;
      // Ativo = teve atividade nas últimas 24h. Inativo = >24h sem mensagem.
      const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
      const activeContacts = (db.prepare(
        `SELECT COUNT(*) AS c FROM contacts WHERE COALESCE(last_seen_at, 0) >= ?`
      ).get(cutoff24h) as { c: number }).c;
      const inactiveContacts = totalContacts - activeContacts;
      const escalations = (db.prepare(`SELECT COUNT(*) AS c FROM contacts WHERE bot_paused = 1`).get() as { c: number }).c;
      const escalationMessages = (db.prepare(
        `SELECT COUNT(*) AS c FROM messages WHERE role = 'tool' AND content LIKE '%escalate_to_specialist%'`
      ).get() as { c: number }).c;

      // Last 7 days message counts
      const now = new Date();
      const days: string[] = [];
      const msgCounts: number[] = [];
      const dayLabels: string[] = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dayLabel = `${dayLabels[d.getDay()]} ${d.getDate()}`;
        days.push(dayLabel);
        const start = new Date(d); start.setHours(0, 0, 0, 0);
        const end = new Date(d); end.setHours(23, 59, 59, 999);
        const c = (db.prepare(
          `SELECT COUNT(*) AS c FROM messages WHERE created_at >= ? AND created_at <= ?`
        ).get(start.getTime(), end.getTime()) as { c: number }).c;
        msgCounts.push(c);
      }

      // Topic buckets from user messages
      const userMsgs = db.prepare(`SELECT content FROM messages WHERE role = 'user'`).all() as Array<{ content: string }>;
      const subjects: Record<string, number> = {
        'Mensalidades / Valores': 0,
        'Matrículas & Vagas': 0,
        'Materiais / Livros': 0,
        'Contatos / Secretaria': 0,
        'Horários & Grade': 0,
        'Outras dúvidas': 0,
      };
      for (const m of userMsgs) {
        const t = (m.content || '').toLowerCase();
        if (/mensal|pre[çc]o|valor|pagamento|custo/.test(t)) subjects['Mensalidades / Valores']++;
        else if (/matr[íi]cula|vaga|inscri[çc][ãa]o|inscrever/.test(t)) subjects['Matrículas & Vagas']++;
        else if (/material|livro|apostila|caderno/.test(t)) subjects['Materiais / Livros']++;
        else if (/contato|telefone|whatsapp|secretaria|falar com/.test(t)) subjects['Contatos / Secretaria']++;
        else if (/hor[áa]rio|aula|grade|calend[áa]rio/.test(t)) subjects['Horários & Grade']++;
        else subjects['Outras dúvidas']++;
      }

      reply.send({
        totalMessages,
        totalContacts,
        activeContacts,
        inactiveContacts,
        escalations,
        escalationMessages,
        days,
        msgCounts,
        subjects,
      });
    } catch (error) {
      logger.error({ error }, "Error fetching dashboard stats from SQLite");
      reply.code(500).send({ error: "Internal error" });
    }
  });

  // Admin: list all contacts (reads from SQLite directly — always reliable)
  fastify.get("/api/admin/contacts", async (request, reply) => {
    const authHeader = request.headers["authorization"] || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token || token !== config.adminToken) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }
    try {
      const { getDatabase } = await import("../db/connection");
      const db = getDatabase();

      // Backfill: create contact rows for any wa_id present in messages but
      // missing from contacts (handles older messages from before contacts
      // were auto-created on webhook).
      const orphans = db
        .prepare(
          `SELECT DISTINCT m.wa_id, MAX(m.created_at) AS last_at
           FROM messages m
           LEFT JOIN contacts c ON c.wa_id = m.wa_id
           WHERE c.wa_id IS NULL
           GROUP BY m.wa_id`
        )
        .all() as Array<{ wa_id: string; last_at: number }>;
      if (orphans.length > 0) {
        const insert = db.prepare(
          `INSERT INTO contacts (wa_id, name, phone, bot_paused, paused_reason, paused_at, last_seen_at)
           VALUES (?, NULL, NULL, 0, NULL, NULL, ?)`
        );
        const tx = db.transaction((rows: typeof orphans) => {
          for (const r of rows) insert.run(r.wa_id, r.last_at);
        });
        tx(orphans);
      }

      const contacts = db
        .prepare(
          `SELECT wa_id, name, phone, bot_paused, paused_reason, paused_at, last_seen_at
           FROM contacts ORDER BY COALESCE(last_seen_at, 0) DESC`
        )
        .all();
      reply.send({ contacts });
    } catch (error) {
      logger.error({ error }, "Error fetching contacts from SQLite");
      reply.code(500).send({ error: "Internal error" });
    }
  });

  // Admin: get messages for a contact (reads from SQLite directly)
  fastify.get<{ Params: { wa_id: string } }>(
    "/api/admin/contacts/:wa_id/messages",
    async (request, reply) => {
      const authHeader = request.headers["authorization"] || "";
      const token = authHeader.replace("Bearer ", "").trim();
      if (!token || token !== config.adminToken) {
        reply.code(401).send({ error: "Unauthorized" });
        return;
      }
      const { wa_id } = request.params;
      try {
        const { getDatabase } = await import("../db/connection");
        const db = getDatabase();
        const messages = db
          .prepare(
            `SELECT id, wa_id, role, content, created_at
             FROM messages WHERE wa_id = ?
             ORDER BY created_at ASC, id ASC`
          )
          .all(wa_id);
        reply.send({ messages });
      } catch (error) {
        logger.error({ error, wa_id }, "Error fetching messages from SQLite");
        reply.code(500).send({ error: "Internal error" });
      }
    }
  );

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

              // Store conversation state — make sure the contact row exists
              // before appending messages, otherwise the admin panel's
              // contacts list stays empty.
              stateRepository.getOrCreateContact(senderId);
              stateRepository.updateLastSeen(senderId);
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
