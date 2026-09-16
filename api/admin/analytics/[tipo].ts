import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../../_lib/cors";
import { checkAdminAuth, requireAdmin } from "../../_lib/auth";
import { getSupabase } from "../../../src/db/supabase-client";
import { StateRepository } from "../../../src/state/repository";
import { WhatsAppClient } from "../../../src/whatsapp/client";
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


// ── campanhas ────────────────────────────────────────────────────────────────
// Disparo de template em massa, SOMENTE ADMIN. O estado vive no banco
// (public/admin/supabase-campanhas.sql) porque a função da Vercel morre em 60s
// e o WhatsApp só aceita 250 conversas iniciadas por 24h: a campanha anda em
// lotes, sobrevive a fechar a aba e nunca manda duas vezes pra mesma pessoa.

// Trava abaixo do teto do número (250/24h), pra sobrar folga pro atendimento.
const LIMITE_24H = 240;
const LOTE_MAX = 20;

// Rótulo do público → filtro. Espelha a lista da tela (templates-audience).
const PUBLICOS: Record<string, (q: any) => any> = {
  "seletiva-pendentes": (q) => q.eq("seletiva_status", "pendente"),
  "seletiva-inscritos": (q) => q.eq("seletiva_status", "inscrito"),
  "seletiva-interessados": (q) => q.not("seletiva_status", "is", null),
  "tag-matricula": (q) => q.eq("tag", "matricula"),
  "tag-rematricula": (q) => q.eq("tag", "rematricula"),
  "tag-eixo": (q) => q.eq("tag", "eixo"),
  "tag-esporte": (q) => q.eq("tag", "esporte"),
  todos: (q) => q,
};

async function waIdsDoPublico(sb: any, publico: string): Promise<string[]> {
  const filtro = PUBLICOS[publico];
  if (!filtro) return [];
  const PAGE = 1000; // teto do PostgREST: sem paginar, a campanha pararia em 1000
  const ids: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await filtro(
      sb.from("contacts").select("wa_id").neq("optout_marketing", true)
    ).range(from, from + PAGE - 1);
    if (error) throw error;
    const lote = (data || []) as { wa_id: string }[];
    ids.push(...lote.map((r) => r.wa_id).filter(Boolean));
    if (lote.length < PAGE) return ids;
  }
}

async function enviadosNasUltimas24h(sb: any): Promise<number> {
  const desde = Date.now() - 24 * 60 * 60 * 1000;
  const { count } = await sb
    .from("campanha_envios")
    .select("*", { count: "exact", head: true })
    .eq("status", "enviado")
    .gte("enviado_em", desde);
  return count || 0;
}

function novoClienteWhatsApp(): WhatsAppClient {
  return new WhatsAppClient(
    config.whatsapp.accessToken,
    config.whatsapp.phoneNumberId,
    config.whatsapp.businessAccountId
  );
}

async function handleCampanha(req: VercelRequest, res: VercelResponse) {
  const user = requireAdmin(req, res);
  if (!user) return;

  const sb = getSupabase();
  const corpoReq: any = req.body || {};
  const acao = String(corpoReq.acao || "");

  // TESTE: um número só, pra conferir o texto antes de gastar com a lista.
  if (acao === "teste") {
    const { template, idioma, numero } = corpoReq;
    if (!template || !idioma || !numero) {
      res.status(400).json({ error: "Informe template, idioma e numero." });
      return;
    }
    try {
      const r = await novoClienteWhatsApp().sendTemplate(String(numero), String(template), String(idioma));
      res.status(200).json({ ok: true, messageId: r.messageId });
    } catch (e: any) {
      res.status(200).json({ ok: false, erro: e?.message || "Falha no envio." });
    }
    return;
  }

  if (acao === "criar") {
    const { template, idioma, publico, corpo } = corpoReq;
    if (!template || !idioma || !PUBLICOS[String(publico)]) {
      res.status(400).json({ error: "Informe template, idioma e um público válido." });
      return;
    }
    const ids = await waIdsDoPublico(sb, String(publico));
    if (!ids.length) {
      res.status(200).json({ error: "Esse público não tem ninguém (ou todos pediram descadastro)." });
      return;
    }
    const { data: camp, error: errCamp } = await sb
      .from("campanhas")
      .insert({
        criada_em: Date.now(),
        criada_por: user.name || user.uid,
        template: String(template),
        idioma: String(idioma),
        publico: String(publico),
        corpo: corpo ? String(corpo) : null,
        total: ids.length,
        status: "ativa",
      })
      .select("id")
      .single();
    if (errCamp) {
      logger.error({ errCamp }, "Falha ao criar campanha");
      res.status(200).json({ error: "Rode public/admin/supabase-campanhas.sql no Supabase antes." });
      return;
    }
    const campanhaId = (camp as any).id;
    for (let i = 0; i < ids.length; i += 500) {
      const linhas = ids.slice(i, i + 500).map((wa_id) => ({ campanha_id: campanhaId, wa_id }));
      const { error } = await sb.from("campanha_envios").insert(linhas);
      if (error) logger.warn({ error }, "Falha ao gravar parte da fila da campanha");
    }
    res.status(200).json({ campanhaId, total: ids.length });
    return;
  }

  if (acao === "lote") {
    const campanhaId = Number(corpoReq.campanhaId);
    if (!campanhaId) {
      res.status(400).json({ error: "Informe campanhaId." });
      return;
    }
    const { data: camp } = await sb
      .from("campanhas")
      .select("id, template, idioma, corpo, status")
      .eq("id", campanhaId)
      .single();
    if (!camp) {
      res.status(404).json({ error: "Campanha não encontrada." });
      return;
    }

    const jaHoje = await enviadosNasUltimas24h(sb);
    const folga = Math.max(0, LIMITE_24H - jaHoje);
    if (folga === 0) {
      res.status(200).json({ pausado: true, motivo: "Limite de 24h do número atingido. Continue amanhã.", enviados: 0 });
      return;
    }

    const { data: alvos } = await sb
      .from("campanha_envios")
      .select("id, wa_id")
      .eq("campanha_id", campanhaId)
      .eq("status", "pendente")
      .order("id")
      .limit(Math.min(LOTE_MAX, folga));

    const fila = (alvos || []) as { id: number; wa_id: string }[];
    if (!fila.length) {
      await sb.from("campanhas").update({ status: "concluida" }).eq("id", campanhaId);
      res.status(200).json({ concluida: true, enviados: 0 });
      return;
    }

    const wa = novoClienteWhatsApp();
    const repo = new StateRepository();
    let enviados = 0;
    let falhas = 0;
    for (const alvo of fila) {
      try {
        const r = await wa.sendTemplate(alvo.wa_id, (camp as any).template, (camp as any).idioma);
        await sb
          .from("campanha_envios")
          .update({ status: "enviado", message_id: r.messageId, enviado_em: Date.now(), erro: null })
          .eq("id", alvo.id);
        // Grava no histórico pra a mensagem aparecer na conversa do CRM.
        if ((camp as any).corpo) {
          await repo.appendMessage(alvo.wa_id, "assistant", (camp as any).corpo).catch(() => {});
        }
        enviados++;
      } catch (e: any) {
        await sb
          .from("campanha_envios")
          .update({ status: "falhou", erro: String(e?.message || "erro").slice(0, 300) })
          .eq("id", alvo.id);
        falhas++;
      }
    }
    res.status(200).json({ enviados, falhas });
    return;
  }

  res.status(400).json({ error: "Ação desconhecida." });
}

async function handleCampanhaStatus(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return;
  const sb = getSupabase();
  const campanhaId = Number(req.query.campanhaId || 0);
  const conta = async (status?: string) => {
    let q = sb.from("campanha_envios").select("*", { count: "exact", head: true }).eq("campanha_id", campanhaId);
    if (status) q = q.eq("status", status);
    return (await q).count || 0;
  };
  const [total, enviados, falhas, pendentes] = await Promise.all([
    conta(), conta("enviado"), conta("falhou"), conta("pendente"),
  ]);
  res.status(200).json({ total, enviados, falhas, pendentes, jaHoje: await enviadosNasUltimas24h(sb) });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  // POST só existe para campanha (criar/disparar/testar); o resto é leitura.
  const metodoOk = req.method === "GET" || (req.method === "POST" && req.query.tipo === "campanha");
  if (!metodoOk) {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const tipo = String(req.query.tipo || "");
  try {
    if (tipo === "campanha") {
      if (req.method === "POST") return await handleCampanha(req, res);
      return await handleCampanhaStatus(req, res);
    }
    if (tipo === "topics") return await handleTopics(req, res);
    if (tipo === "templates") return await handleTemplates(req, res);
    res.status(404).json({ error: "Not found" });
  } catch (error) {
    logger.error({ error, tipo }, "Erro em GET /api/admin/analytics/[tipo]");
    res.status(500).json({ error: "Internal error" });
  }
}
