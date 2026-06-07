# Cache Aprendido de Intenções — Design

Data: 2026-06-06
Branch: `feat/intent-learning`

## Problema

O roteador de intenção ([src/worker/intent-router.ts](../../../src/worker/intent-router.ts))
é determinístico (regex). Mensagens que nenhum padrão cobre caem em `ask_llm` e
vão pro LLM. Não existe memória: a mesma frase ambígua continua custando uma
chamada de LLM toda vez, e nada melhora com o tempo.

## Objetivo

Um cache que **aprende sozinho** mapeamentos `frase → intenção` e os consulta
**antes de cair no LLM**, reduzindo chamadas de LLM e tornando o roteamento mais
consistente conforme as conversas se repetem.

## Princípio de segurança (inegociável)

O cache **só preenche o buraco do `ask_llm`**. Ele é **puramente aditivo**:

- NUNCA sobrepõe: guard de preço (`isPriceOrMaterialQuestion`), bot pausado,
  respostas diretas (`matchDirectResponse`), escalação humana (`escalate`), nem
  um match de regex confiante.
- Só atua quando `routeIntent` devolveu `ask_llm` (o fallback ambíguo), depois do
  check de primeira interação.
- Intents elegíveis ao cache: `enrollment_info` (com nível), `enrollment_contact`,
  `unit_info`, `document_request`, `visit_request`.
- `escalate` e `soft_redirect` NUNCA entram no cache (sensíveis demais).

Resultado: todo comportamento atual continua idêntico; a única diferença é que
mensagens ambíguas que *parecem* algo já aprendido passam a ser roteadas em vez
de irem ao LLM.

## Componentes

Subsistema isolado em `src/learning/`.

### `src/learning/normalize.ts` (puro, sem DB)

- `canonicalKey(msg): string` — lowercase → NFD strip acento → remove pontuação →
  tokeniza → remove stopwords → dedupe + ordena → junta com espaço.
- `tokenSet(msg): Set<string>` — tokens significativos (sem stopwords).
- `jaccard(a: Set, b: Set): number` — |∩| / |∪|.
- `bestMatch(tokens, entries, threshold): { entry, score } | null` — match exato
  por `canonical_key` (score 1) OU melhor Jaccard ≥ `threshold` (default 0.7).
- `shouldPromote(entry): boolean` — `regex_hits >= 3 && positive_outcomes >= 2 &&
  negative_outcomes === 0`.

### `src/learning/repository.ts`

`LearningRepository` (acesso à tabela `intent_learning`):

- `recordObservation({ canonicalKey, tokens, sampleMessage, intentKind })` —
  upsert; `regex_hits++`; cria/atualiza como `candidate`. Se a chave já existe com
  intent_kind diferente, mantém o de maior `regex_hits` (anti-ruído).
- `recordOutcome(canonicalKey, positive: boolean)` — `positive_outcomes++` ou
  `negative_outcomes++`. Roda `shouldPromote` → `candidate` vira `active`. Outcome
  negativo numa `active` a rebaixa pra `candidate`.
- `lookup(tokens): { intentKind } | null` — carrega só entradas `active` (conjunto
  pequeno), roda `bestMatch` em JS. Incrementa `cache_hits` no acerto. Sem API
  externa, zero token de LLM.
- `metrics(): { activeIntents, candidateIntents, totalCacheHits, learnedThisWeek }`.

Toda chamada de DB com try/catch — falha de aprendizado nunca derruba o turno.

## Tabela `intent_learning` (Supabase / PostgreSQL)

```sql
CREATE TABLE IF NOT EXISTS intent_learning (
  id BIGSERIAL PRIMARY KEY,
  canonical_key TEXT NOT NULL UNIQUE,
  tokens TEXT[] NOT NULL,
  intent_kind TEXT NOT NULL,
  sample_message TEXT,
  regex_hits INTEGER NOT NULL DEFAULT 0,
  positive_outcomes INTEGER NOT NULL DEFAULT 0,
  negative_outcomes INTEGER NOT NULL DEFAULT 0,
  cache_hits INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'candidate',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intent_learning_status ON intent_learning(status);
```

Vai no `supabase_schema.sql` + arquivo de migração em
`public/admin/supabase-intent-learning-migration.sql`.

## Integração no orchestrator

Em [src/worker/orchestrator.ts](../../../src/worker/orchestrator.ts),
`MessageOrchestrator` recebe um `LearningRepository` no construtor.

1. **Aprender:** quando `routeIntent` devolve um intent concreto elegível
   (com sinal confiante), chama `learning.recordObservation(...)`.
2. **Aplicar:** no ramo `ask_llm`, após o check de primeira interação, chama
   `learning.lookup(tokens)`. Se houver `active` que casa, roteia pra aquele
   intent reusando os handlers existentes (em vez de `runLLMFlow`).
3. **Desfecho:** ao fim do turno, `recordOutcome(key, positive)` —
   `positive = !deflexão && !escalação`.

Todas as chamadas de learning são best-effort (try/catch, log, segue o fluxo).

## Métricas no painel

`api/admin/stats.ts` ganha `learning: { activeIntents, candidateIntents,
totalCacheHits, learnedThisWeek }`. O admin (`public/admin/index.html` +
`admin.js`) ganha um card "Aprendizado de Intenções" lendo esses números.
Sem CRUD — gerenciamento manual via Supabase se necessário.

## Testes (TDD)

`tests/learning.test.ts` cobre as funções puras de `normalize.ts`:
`canonicalKey`, `jaccard`, `bestMatch` (exato, overlap acima/abaixo do limiar),
`shouldPromote` (limiares de promoção). Sem DB.

## Deploy

Branch `feat/intent-learning` → merge em `master` e `main` → push das duas →
Vercel auto-deploya (`origin/main` é o HEAD). SQL de migração entregue pra rodar
no Supabase manualmente.

## Decisões fixadas

- Limiar Jaccard: 0.7
- Promoção: 3 regex_hits + 2 positive_outcomes + 0 negative_outcomes
- Sem aba de CRUD no painel (só métricas)
- `escalate`/`soft_redirect` fora do cache
- Matching local (normalização + Jaccard), sem embeddings/API externa
