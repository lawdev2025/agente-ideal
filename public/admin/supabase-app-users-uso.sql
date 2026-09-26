-- =====================================================================
-- REGISTRO DE USO dos usuários do CRM (aba Usuários do /admin).
--
--   last_login_at → gravado no login (/api/auth/login)
--   last_seen_at  → gravado no login e a cada /api/auth/me, que o app e o
--                   painel chamam ao abrir e a cada 5 min com a tela visível.
--                   Recente (< 10 min) = "online agora".
--
-- Atendimentos e mensagens enviadas NÃO dependem disto: vêm de
-- messages.agent_name.
--
-- Rode UMA VEZ no SQL Editor do Supabase. É idempotente.
-- =====================================================================

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS last_login_at BIGINT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS last_seen_at  BIGINT;

-- Faz o PostgREST enxergar as colunas novas sem esperar o cache expirar.
NOTIFY pgrst, 'reload schema';
