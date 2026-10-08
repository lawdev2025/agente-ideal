import { getSupabase, isSupabaseEnabled } from "../db/supabase-client";
import { logger } from "../logger";
import { JevDecision, routesAgree } from "../worker/jev-router";

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
