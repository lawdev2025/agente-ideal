-- =====================================================================
-- Tag de INTENÇÃO por contato (matrícula / rematrícula / eixo / esporte).
-- O webhook classifica a mensagem que chega e grava a tag aqui; o app e o
-- painel mostram um selo discreto ao lado do nome.
--
-- Rode UMA VEZ no SQL Editor do Supabase. É idempotente.
-- =====================================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS tag TEXT;

-- (opcional) índice pra filtrar por tag no futuro
CREATE INDEX IF NOT EXISTS idx_contacts_tag ON contacts(tag);
