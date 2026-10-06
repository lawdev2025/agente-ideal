-- =====================================================================
-- ENTREGA DO RESULTADO DA SELETIVA por contato.
--
--   recebeu     → "Resultado recebido": o aluno está na lista de quem
--                 recebeu o resultado (scripts/seletiva-resultado.ts)
--   nao_recebeu → "Resultado não recebido": fez a prova (realizou) e não
--                 está nessa lista
--
-- Coluna à parte de seletiva_status: não é degrau da escada, é uma marca
-- de quem já realizou. Vira filtro na fila e público de campanha.
--
-- Rode UMA VEZ no SQL Editor do Supabase. É idempotente.
-- =====================================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS seletiva_resultado TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_seletiva_resultado ON contacts(seletiva_resultado);

-- Faz o PostgREST enxergar a coluna nova sem esperar o cache expirar.
NOTIFY pgrst, 'reload schema';
