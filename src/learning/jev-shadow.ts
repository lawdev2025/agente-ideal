import { getSupabase, isSupabaseEnabled } from "../db/supabase-client";
import { logger } from "../logger";
import { JevDecision, routesAgree } from "../worker/jev-router";
import type { AlertaAcao } from "../worker/jev-alert";
import { sendPushToAll } from "../push/web-push";

export interface JevShadowRow {
  waId: string;
  message: string;
  legacyRoute: string;
  legacyUnit?: string;
  legacyNivel?: string;
  decision: JevDecision | null;
}

/**
 * Grava uma linha do modo sombra (tabela jev_shadow, ver
 * public/admin/supabase-jev-shadow.sql). Best-effort: falha de banco só loga.
 */
export async function recordJevShadow(row: JevShadowRow): Promise<void> {
  const d = row.decision;
  logger.info(
    {
      legacy: row.legacyRoute,
      jev: d?.route ?? null,
      conf: d?.confidence ?? null,
      agree: d ? routesAgree(row.legacyRoute, d.route) : null,
      ms: d?.latencyMs ?? null,
    },
    "Jev shadow"
  );
  if (!isSupabaseEnabled()) return;
  try {
    const { error } = await getSupabase()
      .from("jev_shadow")
      .insert({
        created_at: Date.now(),
        wa_id: row.waId,
        message: row.message.slice(0, 1000),
        legacy_route: row.legacyRoute,
        jev_route: d?.route ?? null,
        jev_raw_route: d?.rawRoute ?? null,
        jev_confidence: d?.confidence ?? null,
        jev_continuacao: d?.continuacao ?? null,
        agree: d ? routesAgree(row.legacyRoute, d.route) : null,
        jev_top: d?.top ?? null,
        legacy_unit: row.legacyUnit ?? null,
        jev_unit: d?.unit ?? null,
        jev_unit_confidence: d?.unitConfidence ?? null,
        legacy_nivel: row.legacyNivel ?? null,
        jev_nivel: d?.nivel ?? null,
        jev_nivel_confidence: d?.nivelConfidence ?? null,
        jev_humano: d?.humano ?? null,
        latency_ms: d?.latencyMs ?? null,
        input_tokens: d?.inputTokens ?? null,
        model: d?.model ?? null,
      });
    if (error) logger.warn({ error }, "jev_shadow: insert falhou");
  } catch (err) {
    logger.warn({ err }, "jev_shadow: insert falhou");
  }
}

/**
 * Grava a satisfação do contato (0-5, média móvel — ver nextSatisfaction).
 * Best-effort: antes de supabase-jev-satisfacao-temperatura.sql a coluna não
 * existe e o update só loga.
 */
export async function recordSatisfaction(waId: string, value: number): Promise<void> {
  if (!isSupabaseEnabled()) return;
  try {
    const { error } = await getSupabase()
      .from("contacts")
      .update({ satisfaction: value, satisfaction_at: Date.now() })
      .eq("wa_id", waId);
    if (error) logger.warn({ error }, "satisfaction: update falhou");
  } catch (err) {
    logger.warn({ err }, "satisfaction: update falhou");
  }
}

/**
 * Abre, atualiza ou encerra o alerta de cliente insatisfeito do contato
 * (colunas alert_* de supabase-jev-alerta.sql). Ao ABRIR, avisa o celular do
 * time com push heads-up — é pra alguém assumir agora. Best-effort.
 */
export async function recordAlerta(
  waId: string,
  acao: AlertaAcao,
  nome: string | null,
  now: number = Date.now()
): Promise<void> {
  if (acao.acao === "nada" || !isSupabaseEnabled()) return;
  const patch =
    acao.acao === "encerrar"
      ? { alert_title: null, alert_reason: null, alert_at: null, alert_updated_at: now }
      : acao.acao === "abrir"
        ? { alert_title: acao.titulo, alert_reason: acao.motivo, alert_at: now, alert_updated_at: now }
        : { alert_title: acao.titulo, alert_reason: acao.motivo, alert_updated_at: now };
  try {
    const { error } = await getSupabase().from("contacts").update(patch).eq("wa_id", waId);
    if (error) {
      logger.warn({ error }, "alerta: update falhou");
      return;
    }
  } catch (err) {
    logger.warn({ err }, "alerta: update falhou");
    return;
  }
  logger.info({ waId, acao: acao.acao }, "Alerta de cliente insatisfeito");
  if (acao.acao === "abrir") {
    try {
      await sendPushToAll({
        title: `🔴 ${acao.titulo}: ${nome || waId}`,
        body: `${acao.motivo} — toque para assumir a conversa`,
        wa_id: waId,
        tag: `crm-alerta-${waId}`,
        urgent: true,
      });
    } catch (err) {
      logger.warn({ err }, "alerta: push falhou (ignorado)");
    }
  }
}
