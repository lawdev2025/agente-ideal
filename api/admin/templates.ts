import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "../_lib/cors";
import { requireAdmin } from "../_lib/auth";
import { config } from "../../src/config";
import { logger } from "../../src/logger";

// Modelos de mensagem (templates) da conta do WhatsApp, lidos direto da Meta.
//
// SOMENTE ADMIN (requireAdmin, 403 para atendente de unidade): disparar
// template é a única mensagem PAGA do WhatsApp — uma cobrança por destinatário
// — então a tela não fica ao alcance de quem não decide gasto.
//
// Usa WHATSAPP_MANAGEMENT_TOKEN, separado do token de envio do bot: se este
// vencer ou for revogado, o atendimento continua funcionando.
const GRAPH = "https://graph.facebook.com/v22.0";
const TTL_MS = 60_000;
let cache: { at: number; payload: unknown } | null = null;

function contarVariaveis(texto: string): number {
  const achadas = new Set((texto.match(/\{\{\s*\d+\s*\}\}/g) || []).map((v) => v.replace(/\s/g, "")));
  return achadas.size;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
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

  const cached = cache;
  if (cached && Date.now() - cached.at < TTL_MS) {
    res.setHeader("X-Cache", "HIT");
    res.status(200).json(cached.payload);
    return;
  }

  try {
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
    cache = { at: Date.now(), payload };
    res.setHeader("X-Cache", "MISS");
    res.status(200).json(payload);
  } catch (error) {
    logger.error({ error }, "Erro em GET /api/admin/templates");
    res.status(500).json({ error: "Internal error" });
  }
}
