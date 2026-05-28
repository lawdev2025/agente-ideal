-- =============================================================
-- WIPE DE CONVERSAS — COLÉGIO IDEAL (versão defensiva)
-- Apaga TODAS as mensagens e contatos do WhatsApp, SE as tabelas
-- existirem. Caso não existam, cria-as vazias (idempotente).
-- NÃO toca na base de conhecimento (cursos, unidades, materiais).
--
-- Rode no Supabase SQL Editor:
-- https://supabase.com/dashboard/project/<seu-projeto>/sql/new
-- =============================================================

-- Garante que as tabelas existem (sem afetar se já existirem)
CREATE TABLE IF NOT EXISTS contacts (
  wa_id         TEXT PRIMARY KEY,
  name          TEXT,
  phone         TEXT,
  bot_paused    BOOLEAN NOT NULL DEFAULT false,
  paused_reason TEXT,
  paused_at     BIGINT,
  last_seen_at  BIGINT
);

CREATE TABLE IF NOT EXISTS messages (
  id         BIGSERIAL PRIMARY KEY,
  wa_id      TEXT   NOT NULL,
  role       TEXT   NOT NULL,
  content    TEXT   NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_wa_id ON messages (wa_id, created_at DESC);

-- Habilita RLS e políticas (idempotente)
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_contacts') THEN
    CREATE POLICY "allow_all_contacts" ON contacts FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_messages') THEN
    CREATE POLICY "allow_all_messages" ON messages FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Limpa o conteúdo
TRUNCATE TABLE messages RESTART IDENTITY;
TRUNCATE TABLE contacts RESTART IDENTITY;

-- Confirme zero linhas:
SELECT 'messages' AS tabela, COUNT(*) AS linhas FROM messages
UNION ALL
SELECT 'contacts',           COUNT(*)           FROM contacts;
