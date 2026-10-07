-- =====================================================================
-- MIGRAÇÃO: Responder mensagem (citação estilo WhatsApp) no /app
-- ---------------------------------------------------------------------
-- Rode UMA VEZ no SQL Editor do Supabase. É idempotente (IF NOT EXISTS).
--
--   wa_message_id → id da mensagem no WhatsApp (wamid). A Meta só mostra
--                   "respondendo a" pro cliente se a gente mandar esse id no
--                   campo context.message_id. Gravado nas mensagens recebidas
--                   e nas que o atendente manda pelo painel.
--   reply_to_id   → messages.id da mensagem citada (pra desenhar a citação
--                   no painel). Vale nos dois sentidos: atendente respondendo
--                   o cliente e cliente respondendo uma mensagem nossa.
--
-- Antes desta migração tudo segue funcionando, só sem o botão de responder.
-- Mensagens antigas (sem wa_message_id) não podem ser citadas.
-- =====================================================================
ALTER TABLE messages ADD COLUMN IF NOT EXISTS wa_message_id TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id   BIGINT;
CREATE INDEX IF NOT EXISTS idx_messages_wa_message_id ON messages(wa_message_id);
