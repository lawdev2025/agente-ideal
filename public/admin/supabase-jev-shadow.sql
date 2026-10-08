-- ============================================================================
-- MIGRAÇÃO: Modo sombra do Jev (jev_shadow)
-- ----------------------------------------------------------------------------
-- Rode isto UMA VEZ no SQL Editor do Supabase. Seguro em produção: usa
-- IF NOT EXISTS e não toca em dados existentes.
--
-- O que faz: cria a tabela onde, a cada mensagem do cliente, o bot grava o que
-- o roteador por regex escolheu (legacy_route) ao lado do que o Jev escolheria
-- (jev_route). O cliente continua recebendo a resposta do regex — isto só mede.
-- Com 1-2 semanas de dados dá pra ver onde os dois discordam e calibrar o corte
-- de confiança antes de ligar JEV_MODE=live.
-- ============================================================================

CREATE TABLE IF NOT EXISTS jev_shadow (
  id BIGSERIAL PRIMARY KEY,
  created_at BIGINT NOT NULL,
  wa_id TEXT NOT NULL,
  message TEXT NOT NULL,
  legacy_route TEXT NOT NULL,
  jev_route TEXT,          -- ação final (já com as regras de continuação/humano)
  jev_raw_route TEXT,      -- opção bruta da pergunta `rota`
  jev_confidence REAL,
  jev_continuacao REAL,
  agree BOOLEAN,
  jev_top JSONB,
  legacy_unit TEXT,
  jev_unit TEXT,
  jev_unit_confidence REAL,
  legacy_nivel TEXT,
  jev_nivel TEXT,
  jev_nivel_confidence REAL,
  jev_humano REAL,
  latency_ms INTEGER,
  input_tokens INTEGER,
  model TEXT,
  -- Preenchido à mão na revisão: qual rota ERA a certa (pra medir acerto real).
  correct_route TEXT
);

CREATE INDEX IF NOT EXISTS idx_jev_shadow_created ON jev_shadow(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jev_shadow_agree ON jev_shadow(agree);

-- Mesmo padrão de RLS das outras tabelas do projeto (anon + allow_all).
ALTER TABLE jev_shadow ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'jev_shadow' AND policyname = 'allow_all'
  ) THEN
    CREATE POLICY allow_all ON jev_shadow FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Consultas úteis
-- ----------------------------------------------------------------------------
-- Taxa de concordância por faixa de confiança:
--   SELECT width_bucket(jev_confidence, 0, 1, 5) AS faixa,
--          count(*) AS n,
--          round(avg(CASE WHEN agree THEN 1 ELSE 0 END)::numeric, 2) AS concorda
--   FROM jev_shadow WHERE agree IS NOT NULL GROUP BY 1 ORDER BY 1;
--
-- Onde discordam (pra revisar e preencher correct_route):
--   SELECT id, message, legacy_route, jev_route, jev_confidence
--   FROM jev_shadow WHERE agree = false ORDER BY created_at DESC LIMIT 100;
