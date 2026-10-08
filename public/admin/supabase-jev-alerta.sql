-- =====================================================================
-- JEV: ALERTA DE CLIENTE INSATISFEITO (faixa "Assumir conversa" no CRM)
--
-- Rode UMA VEZ no SQL Editor do Supabase, DEPOIS de
-- supabase-jev-satisfacao-temperatura.sql. É idempotente.
--
-- O Jev lê cada mensagem do cliente (satisfação, emoção, motivo). Quando a
-- conversa vira problema — mensagem muito negativa, insatisfação sustentada
-- ou a mesma pergunta 3× (regras em src/worker/jev-alert.ts) — o contato
-- ganha um alerta aberto:
--   alert_title  → "Cliente irritado", "Cliente frustrado", …
--   alert_reason → "repetiu a pergunta 3× sem resposta útil", …
--   alert_at     → quando o alerta ABRIU (o "há 12 min" do CRM)
-- Fecha quando alguém assume (pausa o bot / responde pelo painel) ou quando o
-- cliente se acalma. Chega no app sozinho via to_jsonb(c) do
-- get_contacts_inbox().
-- =====================================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS alert_title      TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS alert_reason     TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS alert_at         BIGINT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS alert_updated_at BIGINT;

CREATE INDEX IF NOT EXISTS idx_contacts_alert_at ON contacts(alert_at) WHERE alert_at IS NOT NULL;
