-- =====================================================================
-- STATUS DA SELETIVA por contato (inscrito / pendente).
--
--   inscrito → o telefone aparece numa planilha de inscrição da Seletiva
--   pendente → demonstrou interesse (falou de Seletiva ou recebeu o link)
--              e ainda não achamos a inscrição
--   agendada → "Seletivas agendadas": falou de Seletiva DEPOIS do fim das
--              inscrições (25/09/2026) e espera o agendamento do teste.
--              Sobe de vazio/pendente; a planilha ainda promove a inscrito.
--
-- Mora fora de `tag` porque `tag` é sobrescrita a cada mensagem: quem falou
-- de Seletiva e depois perguntou a mensalidade vira "matricula" e sumiria da
-- contagem. Este status só sobe (vazio → pendente → inscrito), nunca desce.
--
-- Quem escreve:
--   - webhook/orquestrador → pendente, na hora, quando surge o interesse
--   - scripts/seletiva-import.ts → inscrito, cruzando as planilhas
--     (e pendente retroativo de quem já demonstrou interesse)
--
-- Rode UMA VEZ no SQL Editor do Supabase. É idempotente.
-- =====================================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS seletiva_status TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS seletiva_at     BIGINT;

CREATE INDEX IF NOT EXISTS idx_contacts_seletiva_status ON contacts(seletiva_status);

-- Faz o PostgREST enxergar as colunas novas sem esperar o cache expirar.
NOTIFY pgrst, 'reload schema';
