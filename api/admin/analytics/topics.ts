import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../../_lib/cors";
import { checkAdminAuth } from "../../_lib/auth";
import { getSupabase } from "../../../src/db/supabase-client";
import { logger } from "../../../src/logger";

// Reclassificação por regex é set-based e barata, mas não precisa rodar a cada
// request. Limita a 1x/min por function warm. (O upgrade futuro pra LLM roda
// num Vercel Cron separado e grava source='llm', que o regex não sobrescreve.)
const RECLASSIFY_EVERY_MS = 60_000;
let lastClassifyAt = 0;

async function maybeReclassify(sb: ReturnType<typeof getSupabase>) {
  if (Date.now() - lastClassifyAt < RECLASSIFY_EVERY_MS) return;
  const { error } = await sb.rpc("classify_conversations_regex");
  if (error) {
    logger.warn(
      { error },
      "classify_conversations_regex indisponível (rode supabase-conversation-topics.sql)"
    );
    return;
  }
  lastClassifyAt = Date.now();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!checkAdminAuth(req, res)) return;

  try {
    const sb = getSupabase();
    await maybeReclassify(sb);

    const topic = (req.query.topic as string) || "";

    // Drill-down: conversas de um assunto específico.
    if (topic) {
      const { data, error } = await sb.rpc("conversations_by_topic", { p_topic: topic });
      if (error) {
        res.status(200).json({ topic, conversations: [], unavailable: true });
        return;
      }
      res.status(200).json({ topic, conversations: data || [] });
      return;
    }

    // Distribuição de assuntos (nº de conversas por tópico).
    const { data, error } = await sb.rpc("topics_distribution");
    if (error) {
      // Migração não rodada — não quebra o dashboard, sinaliza indisponível.
      res.status(200).json({ distribution: [], total: 0, unavailable: true });
      return;
    }
    const distribution = (data || []) as { topic: string; conversations: number }[];
    const total = distribution.reduce((s, d) => s + Number(d.conversations || 0), 0);
    res.status(200).json({ distribution, total });
  } catch (error) {
    logger.error({ error }, "Erro em GET /api/admin/analytics/topics");
    res.status(500).json({ error: "Internal error" });
  }
}
