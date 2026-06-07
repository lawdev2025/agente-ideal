-- ============================================================================
-- MIGRAÇÃO: Cache aprendido de intenções (intent_learning)
-- ----------------------------------------------------------------------------
-- Rode isto UMA VEZ no SQL Editor do Supabase para habilitar o aprendizado de
-- intenções. Seguro rodar em produção: usa IF NOT EXISTS e não toca em dados.
--
-- O que faz: cria a tabela onde o bot acumula mapeamentos frase→intenção.
--   - O roteador determinístico (regex) grava entradas 'candidate' quando
--     roteia com confiança.
--   - Desfechos positivos (sem deflexão/escalação) promovem 'candidate'→'active'.
--   - Mensagens ambíguas consultam só as 'active' antes de chamar o LLM,
--     economizando tokens e deixando o roteamento mais consistente com o tempo.
-- ============================================================================

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

-- SEGURANÇA: Row Level Security (mesmo padrão das outras tabelas do projeto).
-- O bot usa a anon key, então habilitamos RLS e criamos uma policy permissiva
-- allow_all — isto silencia o aviso do Supabase e mantém a convenção. (Nota:
-- como a policy libera anon, ela não restringe de fato quem tem a chave pública;
-- restrição real exigiria migrar o backend pra service_role key.) O bloco DO
-- abaixo é idempotente: pode rodar de novo sem erro de policy duplicada.
ALTER TABLE intent_learning ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'intent_learning' AND policyname = 'allow_all_intent_learning'
  )
  THEN CREATE POLICY "allow_all_intent_learning" ON intent_learning
    FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Conferir:
-- SELECT canonical_key, intent_kind, status, regex_hits, positive_outcomes,
--        negative_outcomes, cache_hits
-- FROM intent_learning
-- ORDER BY cache_hits DESC, regex_hits DESC;
