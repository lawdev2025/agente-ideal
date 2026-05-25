-- =============================================================
-- WIPE DE CONVERSAS — COLÉGIO IDEAL
-- Apaga TODAS as mensagens e contatos do WhatsApp.
-- NÃO toca na base de conhecimento (cursos, unidades, materiais).
--
-- Rode no Supabase SQL Editor:
-- https://supabase.com/dashboard/project/<seu-projeto>/sql/new
-- =============================================================

TRUNCATE TABLE messages RESTART IDENTITY;
TRUNCATE TABLE contacts RESTART IDENTITY;

-- Confirme zero linhas:
SELECT 'messages' AS tabela, COUNT(*) AS linhas FROM messages
UNION ALL
SELECT 'contacts',           COUNT(*)           FROM contacts;
