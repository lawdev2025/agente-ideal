-- ============================================================================
-- MIGRAÇÃO: Modo live do Jev (coluna final_route em jev_shadow)
-- ----------------------------------------------------------------------------
-- Rode isto UMA VEZ no SQL Editor do Supabase. Seguro em produção: usa
-- IF NOT EXISTS e não toca em dados existentes.
--
-- Com JEV_MODE=live o Jev veta o bloco fixo que o regex escolheu errado. A
-- linha continua guardando a escolha do regex em legacy_route; final_route é o
-- caminho que REALMENTE respondeu o cliente. Sem esta coluna o bot grava a
-- linha sem ela (não quebra), só perde essa informação.
-- ============================================================================

ALTER TABLE jev_shadow ADD COLUMN IF NOT EXISTS final_route TEXT;

-- ----------------------------------------------------------------------------
-- Consultas úteis
-- ----------------------------------------------------------------------------
-- Onde o Jev mudou a resposta (pra revisar):
--   SELECT id, message, legacy_route, final_route, jev_route, jev_confidence
--   FROM jev_shadow
--   WHERE final_route IS NOT NULL AND final_route <> legacy_route
--   ORDER BY created_at DESC LIMIT 100;
--
-- Quanto o Jev intervém por dia:
--   SELECT to_timestamp(created_at / 1000)::date AS dia, count(*) AS msgs,
--          count(*) FILTER (WHERE final_route <> legacy_route) AS vetos
--   FROM jev_shadow WHERE final_route IS NOT NULL GROUP BY 1 ORDER BY 1 DESC;
