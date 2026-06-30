-- =====================================================================
-- Usuários do sistema (login multi-usuário) + coluna de "quem respondeu".
-- Rode UMA VEZ no SQL Editor do Supabase. É idempotente.
-- O SEED dos usuários NÃO é feito aqui (os hashes de senha precisam ser
-- gerados pelo Node/scrypt) — rode `npx tsx scripts/seed-users.ts` depois.
-- =====================================================================

ALTER TABLE messages ADD COLUMN IF NOT EXISTS agent_name TEXT;

CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,
  email TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'unit',
  unit TEXT,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_users_login ON app_users(login);

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='app_users' AND policyname='allow_all_app_users')
  THEN CREATE POLICY "allow_all_app_users" ON app_users FOR ALL USING (true) WITH CHECK (true); END IF;
END $$;
