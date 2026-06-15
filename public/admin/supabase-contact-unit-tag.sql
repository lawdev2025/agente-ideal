-- =====================================================================
-- Tag de UNIDADE de interesse por contato (AM / BC / CN).
-- O webhook detecta a unidade citada na mensagem e grava aqui; o app e o
-- painel mostram um selo ao lado do nome (junto da tag de intenção).
--   AM = Augusto Montenegro · BC = Batista Campos · CN = Cidade Nova
--
-- Rode UMA VEZ no SQL Editor do Supabase. É idempotente.
-- =====================================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS unit_tag TEXT;
CREATE INDEX IF NOT EXISTS idx_contacts_unit_tag ON contacts(unit_tag);
