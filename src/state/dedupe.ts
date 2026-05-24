import { getSupabase } from "../db/supabase-client";
import { logger } from "../logger";

const RETENTION_DAYS = 7;

/**
 * Retorna o cutoff atual (epoch ms). Mensagens com timestamp menor que isto
 * sao descartadas. Valor 0 significa "aceitar tudo".
 */
export async function getCutoffMs(): Promise<number> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("bot_state")
    .select("value")
    .eq("key", "cutoff_ms")
    .maybeSingle();
  const v = data?.value ? Number(data.value) : 0;
  return Number.isFinite(v) ? v : 0;
}

/**
 * Marca o messageId como processado. Retorna true se foi a primeira vez
 * (continua o processamento); false se ja existia (duplicata — descartar).
 *
 * Tambem dispara limpeza assincrona de registros antigos (>7d) — fire-and-forget.
 */
export async function markProcessedOnce(messageId: string): Promise<boolean> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("processed_messages")
    .insert({ message_id: messageId });

  if (error) {
    // 23505 = unique_violation (Postgres) — significa duplicata
    if ((error as any).code === "23505" || /duplicate key/i.test(error.message || "")) {
      return false;
    }
    logger.error({ error, messageId }, "Erro ao inserir processed_message");
    // Em caso de erro de infra, deixamos passar pra nao perder mensagem
    return true;
  }

  // Limpeza assincrona (nao bloqueia resposta)
  void cleanupOldProcessed();
  return true;
}

async function cleanupOldProcessed(): Promise<void> {
  try {
    const cutoff = new Date(
      Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    const supabase = getSupabase();
    await supabase.from("processed_messages").delete().lt("processed_at", cutoff);
  } catch (e) {
    logger.warn({ error: e }, "Cleanup de processed_messages falhou (nao critico)");
  }
}

/**
 * Decide se uma mensagem deve ser processada.
 * Checa cutoff E dedupe atomicamente.
 */
export async function shouldProcessMessage(
  timestamp: number | undefined,
  messageId: string
): Promise<{ ok: boolean; reason?: string }> {
  const tsMs = !timestamp
    ? Date.now()
    : timestamp < 1e12
    ? timestamp * 1000
    : timestamp;

  const cutoff = await getCutoffMs();
  if (cutoff > 0 && tsMs < cutoff) {
    const ageSec = Math.round((Date.now() - tsMs) / 1000);
    return {
      ok: false,
      reason: `message older than cutoff (${ageSec}s old, cutoff_ms=${cutoff})`,
    };
  }

  const firstTime = await markProcessedOnce(messageId);
  if (!firstTime) {
    return { ok: false, reason: "duplicate messageId (already processed)" };
  }

  return { ok: true };
}
