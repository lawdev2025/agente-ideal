import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors";
import { checkAdminAuth } from "../_lib/auth";
import { getSupabase } from "../../src/db/supabase-client";
import { config as appConfig } from "../../src/config";
import { ClaudeProvider } from "../../src/llm/claude";
import { GeminiProvider } from "../../src/llm/gemini";
import { logger } from "../../src/logger";

// Job de classificação de assunto por LLM — o "depois" da abordagem híbrida.
// Pega conversas ainda classificadas por regex (source != 'llm'), reclassifica
// com o provider já plugado e grava source='llm'. O classificador regex não
// sobrescreve essas linhas (ver supabase-conversation-topics.sql).
//
// Disparado por Vercel Cron (ver vercel.json) ou manualmente com o admin token.
// Mantém o lote pequeno pra caber no timeout da function.

const CATEGORIES = [
  "Mensalidades / Valores",
  "Matrículas & Vagas",
  "Materiais / Livros",
  "Contatos / Secretaria",
  "Horários & Grade",
  "Reclamações",
  "Outras dúvidas",
] as const;

const CLASSIFY_SYSTEM_PROMPT = `Você classifica conversas de atendimento de uma escola em UMA categoria.
Categorias permitidas (use exatamente este texto):
${CATEGORIES.map((c) => `- ${c}`).join("\n")}

Responda SOMENTE com um JSON, sem texto antes ou depois, no formato:
{"categoria": "<uma das categorias>", "confianca": <número de 0 a 1>}
Se não houver sinal claro, use "Outras dúvidas" com confiança baixa.`;

function getProvider() {
  return appConfig.llmProvider === "claude"
    ? new ClaudeProvider(appConfig.claude.apiKey, appConfig.claude.model)
    : new GeminiProvider(appConfig.gemini.apiKey, appConfig.gemini.model);
}

// Extrai {categoria, confianca} da resposta do LLM (tolera texto ao redor).
function parseClassification(
  text: string
): { topic: string; confidence: number } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]);
    const topic = String(obj.categoria || "").trim();
    if (!CATEGORIES.includes(topic as (typeof CATEGORIES)[number])) return null;
    let confidence = Number(obj.confianca);
    if (!Number.isFinite(confidence)) confidence = 0.5;
    confidence = Math.min(1, Math.max(0, confidence));
    return { topic, confidence };
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Autoriza por CRON_SECRET (Vercel Cron) OU admin token (execução manual).
  const cronSecret = process.env.CRON_SECRET;
  const auth = (req.headers.authorization || "") as string;
  const cronOk = !!cronSecret && auth === `Bearer ${cronSecret}`;
  if (!cronOk && !checkAdminAuth(req, res)) return;

  const limit = Math.min(
    Math.max(parseInt((req.query.limit as string) || "8", 10) || 8, 1),
    25
  );

  try {
    const sb = getSupabase();

    // Candidatas: conversas ainda não classificadas por LLM, mais recentes 1º.
    const { data: candidates, error: candErr } = await sb
      .from("conversation_topics")
      .select("wa_id, last_message_at, source")
      .neq("source", "llm")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(limit);

    if (candErr) {
      logger.warn(
        { error: candErr },
        "classify-topics: conversation_topics indisponível (rode a migração)"
      );
      res.status(200).json({ ok: false, reason: "table_unavailable", processed: 0 });
      return;
    }
    if (!candidates || candidates.length === 0) {
      res.status(200).json({ ok: true, processed: 0, updated: 0 });
      return;
    }

    const provider = getProvider();
    let updated = 0;
    const results: Array<{ wa_id: string; topic?: string; skipped?: string }> = [];

    for (const cand of candidates as any[]) {
      const wa_id = cand.wa_id;
      // Transcrição: mensagens do usuário (sinal de assunto), em ordem.
      const { data: msgs } = await sb
        .from("messages")
        .select("content")
        .eq("wa_id", wa_id)
        .eq("role", "user")
        .order("created_at", { ascending: true })
        .limit(40);

      const transcript = (msgs || [])
        .map((m: any) => (m.content || "").trim())
        .filter(Boolean)
        .join(" | ")
        .slice(0, 1500);

      if (!transcript) {
        results.push({ wa_id, skipped: "empty" });
        continue;
      }

      let parsed: { topic: string; confidence: number } | null = null;
      try {
        const r = await provider.generateMessage(transcript, [], [], {
          systemPromptOverride: CLASSIFY_SYSTEM_PROMPT,
          flow: "classify-topics",
        });
        parsed = parseClassification(r.message || "");
      } catch (err) {
        logger.warn({ err, wa_id }, "classify-topics: falha na chamada ao LLM");
      }

      if (!parsed) {
        results.push({ wa_id, skipped: "unparseable" });
        continue;
      }

      const { error: upErr } = await sb.from("conversation_topics").upsert(
        {
          wa_id,
          topic: parsed.topic,
          confidence: parsed.confidence,
          source: "llm",
          processed_at: Date.now(),
          last_message_at: cand.last_message_at ?? null,
        },
        { onConflict: "wa_id" }
      );
      if (upErr) {
        logger.warn({ error: upErr, wa_id }, "classify-topics: falha ao gravar");
        results.push({ wa_id, skipped: "write_failed" });
        continue;
      }
      updated++;
      results.push({ wa_id, topic: parsed.topic });
    }

    logger.info(
      { processed: candidates.length, updated, provider: appConfig.llmProvider },
      "classify-topics concluído"
    );
    res.status(200).json({ ok: true, processed: candidates.length, updated, results });
  } catch (error) {
    logger.error({ error }, "Erro em /api/jobs/classify-topics");
    res.status(500).json({ error: "Internal error" });
  }
}
