import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../../_lib/cors";
import { checkAdminAuth, requireAdmin } from "../../_lib/auth";
import { getSupabase } from "../../../src/db/supabase-client";
import { config } from "../../../src/config";
import { logger } from "../../../src/logger";

// Duas leituras do painel numa função só: /api/admin/analytics/topics e
// /api/admin/analytics/templates.
//
// POR QUE JUNTAS: o plano Hobby da Vercel aceita no máximo 12 Serverless
// Functions e o projeto já está no teto — uma rota nova derruba o deploy
// inteiro (o build passa e a publicação falha). Mesma solução já usada em
// api/jobs/[job].ts.

// ── topics ───────────────────────────────────────────────────────────────────
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

async function handleTopics(req: VercelRequest, res: VercelResponse) {
  if (!checkAdminAuth(req, res)) return;
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
}

// ── templates ────────────────────────────────────────────────────────────────
// Modelos de mensagem da conta do WhatsApp, lidos direto da Meta.
//
// SOMENTE ADMIN (requireAdmin → 403 para atendente de unidade): disparar
// template é a única mensagem PAGA do WhatsApp — uma cobrança por destinatário
// — então a tela não fica ao alcance de quem não decide gasto.
//
// Usa WHATSAPP_MANAGEMENT_TOKEN, separado do token de envio do bot: se este
// vencer ou for revogado, o atendimento continua funcionando.
const GRAPH = "https://graph.facebook.com/v22.0";
const TEMPLATES_TTL_MS = 60_000;
let templatesCache: { at: number; payload: unknown } | null = null;

function contarVariaveis(texto: string): number {
  const achadas = new Set((texto.match(/\{\{\s*\d+\s*\}\}/g) || []).map((v) => v.replace(/\s/g, "")));
  return achadas.size;
}

async function handleTemplates(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return;

  const token = config.whatsapp.managementToken;
  const waba = config.whatsapp.wabaId;
  if (!token || !waba) {
    res.status(200).json({
      configured: false,
      templates: [],
      aviso: "Faltam as variáveis WHATSAPP_MANAGEMENT_TOKEN e WHATSAPP_WABA_ID.",
    });
    return;
  }

  const cached = templatesCache;
  if (cached && Date.now() - cached.at < TEMPLATES_TTL_MS) {
    res.setHeader("X-Cache", "HIT");
    res.status(200).json(cached.payload);
    return;
  }

  const campos = "name,status,category,language,components,quality_score,rejected_reason";
  const r = await fetch(`${GRAPH}/${waba}/message_templates?limit=100&fields=${campos}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body: any = await r.json();
  if (!r.ok) {
    // Erro da Meta (token revogado, permissão faltando) não é erro nosso:
    // devolve 200 com a mensagem pra tela explicar em vez de ficar vazia.
    logger.warn({ erro: body?.error }, "Falha ao listar templates na Meta");
    res.status(200).json({
      configured: true,
      templates: [],
      erro: body?.error?.message || "Não consegui ler os templates na Meta.",
    });
    return;
  }

  const templates = (body.data || []).map((t: any) => {
    const comps = t.components || [];
    const corpo = comps.find((c: any) => c.type === "BODY")?.text || "";
    const botoes = comps
      .filter((c: any) => c.type === "BUTTONS")
      .flatMap((c: any) => (c.buttons || []).map((b: any) => b.text))
      .filter(Boolean);
    return {
      id: t.id,
      nome: t.name,
      status: t.status,
      categoria: t.category,
      idioma: t.language,
      corpo,
      botoes,
      variaveis: contarVariaveis(corpo),
      qualidade: t.quality_score?.score || null,
      motivoRejeicao: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
    };
  });

  const payload = { configured: true, templates };
  templatesCache = { at: Date.now(), payload };
  res.setHeader("X-Cache", "MISS");
  res.status(200).json(payload);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const tipo = String(req.query.tipo || "");
  try {
    if (tipo === "topics") return await handleTopics(req, res);
    if (tipo === "templates") return await handleTemplates(req, res);
    res.status(404).json({ error: "Not found" });
  } catch (error) {
    logger.error({ error, tipo }, "Erro em GET /api/admin/analytics/[tipo]");
    res.status(500).json({ error: "Internal error" });
  }
}
