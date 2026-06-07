import { getSupabase } from "../db/supabase-client";
import { logger } from "../logger";
import {
  canonicalKey,
  tokenSet,
  bestMatch,
  shouldPromote,
  type CacheableIntentKind,
  type LearnedEntry,
} from "./normalize";

// Limiar de similaridade pra um lookup casar por sobreposição de tokens (Jaccard).
// 0.7 = bem conservador: a frase nova precisa compartilhar a grande maioria das
// palavras-chave com algo já aprendido.
const MATCH_THRESHOLD = 0.7;

export interface LearningMetrics {
  activeIntents: number;
  candidateIntents: number;
  totalCacheHits: number;
  learnedThisWeek: number;
}

/**
 * Acesso à tabela `intent_learning`. Todo método é best-effort: falha de
 * aprendizado JAMAIS pode derrubar o atendimento, então o caller envolve em
 * try/catch e os erros são logados sem propagar onde faz sentido.
 *
 * O cache só preenche o buraco do `ask_llm` no orchestrator — ver design em
 * docs/superpowers/specs/2026-06-06-intent-learning-design.md.
 */
export class LearningRepository {
  /**
   * Registra que o regex roteou (com confiança) uma mensagem pra um intent
   * elegível. Cria/atualiza a entrada como `candidate` e incrementa regex_hits.
   * Se a chave já existe com OUTRO intent, mantém o intent atual (anti-ruído:
   * o primeiro mapeamento confiante manda; conflitos não sobrescrevem).
   */
  async recordObservation(
    message: string,
    intentKind: CacheableIntentKind
  ): Promise<void> {
    const key = canonicalKey(message);
    if (!key) return; // mensagem só com stopwords — nada a aprender
    const tokens = Array.from(tokenSet(message));
    const sb = getSupabase();
    const now = Date.now();

    const { data: existing, error: selErr } = await sb
      .from("intent_learning")
      .select("*")
      .eq("canonical_key", key)
      .maybeSingle();
    if (selErr) {
      logger.warn({ error: selErr, key }, "learning: select falhou");
      return;
    }

    if (existing) {
      const { error } = await sb
        .from("intent_learning")
        .update({ regex_hits: (existing.regex_hits ?? 0) + 1, updated_at: now })
        .eq("canonical_key", key);
      if (error) logger.warn({ error, key }, "learning: update hits falhou");
      return;
    }

    const { error } = await sb.from("intent_learning").insert({
      canonical_key: key,
      tokens,
      intent_kind: intentKind,
      sample_message: message.slice(0, 280),
      regex_hits: 1,
      positive_outcomes: 0,
      negative_outcomes: 0,
      cache_hits: 0,
      status: "candidate",
      created_at: now,
      updated_at: now,
    });
    if (error) logger.warn({ error, key }, "learning: insert falhou");
  }

  /**
   * Registra o desfecho de um turno. positive=true (não houve deflexão/escala)
   * promove candidata→ativa quando os limiares batem; um negativo numa entrada
   * ativa a rebaixa pra candidata (deixa de ser usada até reconquistar).
   */
  async recordOutcome(message: string, positive: boolean): Promise<void> {
    const key = canonicalKey(message);
    if (!key) return;
    const sb = getSupabase();
    const now = Date.now();

    const { data: e, error: selErr } = await sb
      .from("intent_learning")
      .select("*")
      .eq("canonical_key", key)
      .maybeSingle();
    if (selErr || !e) return; // só pontuamos desfecho de frases já observadas

    const patch: Record<string, unknown> = { updated_at: now };
    if (positive) {
      patch.positive_outcomes = (e.positive_outcomes ?? 0) + 1;
    } else {
      patch.negative_outcomes = (e.negative_outcomes ?? 0) + 1;
    }

    // Decide o novo status com os contadores JÁ atualizados.
    const merged = {
      regex_hits: e.regex_hits ?? 0,
      positive_outcomes: (patch.positive_outcomes as number) ?? e.positive_outcomes ?? 0,
      negative_outcomes: (patch.negative_outcomes as number) ?? e.negative_outcomes ?? 0,
    };
    if (e.status === "candidate" && shouldPromote(merged)) {
      patch.status = "active";
    } else if (e.status === "active" && !positive) {
      patch.status = "candidate"; // negativo rebaixa: sai de circulação
    }

    const { error } = await sb
      .from("intent_learning")
      .update(patch)
      .eq("canonical_key", key);
    if (error) logger.warn({ error, key }, "learning: recordOutcome falhou");
  }

  /**
   * Consulta o cache pra uma mensagem ambígua. Carrega só entradas `active`
   * (conjunto pequeno) e roda o matching em JS. Retorna o intent aprendido ou
   * null. Em caso de acerto, incrementa cache_hits (best-effort, fire-and-forget).
   */
  async lookup(message: string): Promise<CacheableIntentKind | null> {
    const tokens = tokenSet(message);
    if (tokens.size === 0) return null;
    const sb = getSupabase();

    const { data, error } = await sb
      .from("intent_learning")
      .select("*")
      .eq("status", "active");
    if (error) {
      logger.warn({ error }, "learning: lookup select falhou");
      return null;
    }

    const entries = (data ?? []) as unknown as LearnedEntry[];
    const match = bestMatch(tokens, entries, MATCH_THRESHOLD);
    if (!match) return null;

    // Conta o acerto sem bloquear a resposta.
    void sb
      .from("intent_learning")
      .update({
        cache_hits: ((data as any[]).find((d) => d.canonical_key === match.entry.canonical_key)?.cache_hits ?? 0) + 1,
        updated_at: Date.now(),
      })
      .eq("canonical_key", match.entry.canonical_key)
      .then(({ error: e }) => {
        if (e) logger.warn({ error: e }, "learning: incremento cache_hits falhou");
      });

    logger.info(
      { intent: match.entry.intent_kind, score: match.score },
      "learning: cache hit (ask_llm evitado)"
    );
    return match.entry.intent_kind;
  }

  /** Agregados pro card do painel admin. */
  async metrics(): Promise<LearningMetrics> {
    const sb = getSupabase();
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const [{ count: active }, { count: candidate }, { data: rows }, { count: week }] =
      await Promise.all([
        sb.from("intent_learning").select("*", { count: "exact", head: true }).eq("status", "active"),
        sb.from("intent_learning").select("*", { count: "exact", head: true }).eq("status", "candidate"),
        sb.from("intent_learning").select("cache_hits"),
        sb.from("intent_learning").select("*", { count: "exact", head: true }).gte("created_at", weekAgo),
      ]);
    const totalCacheHits = (rows ?? []).reduce(
      (acc: number, r: any) => acc + (r.cache_hits ?? 0),
      0
    );
    return {
      activeIntents: active ?? 0,
      candidateIntents: candidate ?? 0,
      totalCacheHits,
      learnedThisWeek: week ?? 0,
    };
  }
}
