-- =============================================================
-- MIGRACAO PARA VERCEL — COLEGIO IDEAL
-- Cole TODO este arquivo no SQL Editor do Supabase e rode.
-- Idempotente (pode rodar mais de 1 vez).
-- =============================================================

-- Tabela de dedupe de mensagens (evita reprocessar a mesma msg)
CREATE TABLE IF NOT EXISTS processed_messages (
  message_id   TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_processed_messages_at
  ON processed_messages (processed_at);

ALTER TABLE processed_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_processed_messages'
  )
  THEN CREATE POLICY "allow_all_processed_messages" ON processed_messages
    FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Tabela de estado global do bot (cutoff de start, futuros toggles)
CREATE TABLE IF NOT EXISTS bot_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO bot_state (key, value) VALUES ('cutoff_ms', '0')
  ON CONFLICT (key) DO NOTHING;

ALTER TABLE bot_state ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_bot_state'
  )
  THEN CREATE POLICY "allow_all_bot_state" ON bot_state
    FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Habilita Realtime nas tabelas que o painel observa
DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE contacts;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
