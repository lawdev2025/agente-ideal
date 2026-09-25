-- =====================================================================
-- CAMPANHAS DE TEMPLATE (disparo em massa pelo /admin).
--
-- Por que tabela e não um laço no servidor: a Vercel derruba a função em
-- 60s e o WhatsApp limita as conversas iniciadas por 24h. O estado
-- precisa viver no banco pra a campanha andar em lotes, sobreviver a
-- falha/fechar a aba e nunca mandar duas vezes pra mesma pessoa.
--
-- Rode UMA VEZ no SQL Editor do Supabase. É idempotente.
-- =====================================================================

CREATE TABLE IF NOT EXISTS campanhas (
  id          BIGSERIAL PRIMARY KEY,
  criada_em   BIGINT NOT NULL,
  criada_por  TEXT,
  template    TEXT   NOT NULL,
  idioma      TEXT   NOT NULL,
  publico     TEXT   NOT NULL,   -- rótulo do público escolhido (ex.: seletiva-pendentes)
  corpo       TEXT,                -- texto do template no disparo (vai pro histórico)
  total       INT    NOT NULL DEFAULT 0,
  status      TEXT   NOT NULL DEFAULT 'ativa'  -- ativa | concluida | cancelada
);

-- Modelo com cabeçalho de imagem: cada mensagem precisa mandar a URL pública
-- da foto de novo (a que a Meta aprovou é só exemplo). Fica na campanha, e não
-- resolvida a cada lote, porque o disparo pode durar dias.
ALTER TABLE campanhas ADD COLUMN IF NOT EXISTS imagem_url TEXT;

-- Uma linha por destinatário: é o que dá retomada, relatório e a trava de
-- não enviar duas vezes (UNIQUE campanha_id + wa_id).
CREATE TABLE IF NOT EXISTS campanha_envios (
  id           BIGSERIAL PRIMARY KEY,
  campanha_id  BIGINT NOT NULL REFERENCES campanhas(id) ON DELETE CASCADE,
  wa_id        TEXT   NOT NULL,
  status       TEXT   NOT NULL DEFAULT 'pendente',  -- pendente | enviado | falhou
  erro         TEXT,
  message_id   TEXT,
  enviado_em   BIGINT,
  UNIQUE (campanha_id, wa_id)
);

CREATE INDEX IF NOT EXISTS idx_campanha_envios_fila
  ON campanha_envios(campanha_id, status);

-- Descadastro de marketing: quem responder SAIR/PARAR nunca mais entra em
-- campanha. Protege a qualidade do número (bloqueio derruba o limite diário).
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS optout_marketing BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_contacts_optout ON contacts(optout_marketing);

-- RLS: mesmo padrao das outras tabelas (app_users, contacts, messages...).
-- Sem isto o INSERT da campanha volta 42501 e o /admin mostra "rode esta
-- migracao" — o SELECT, esse, devolve lista vazia calada, o que faz parecer
-- que a tabela nao existe. O controle de acesso real e o login de admin da
-- rota; a chave anon e a mesma do resto do app.
ALTER TABLE campanhas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE campanha_envios ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='campanhas' AND policyname='allow_all_campanhas')
  THEN CREATE POLICY "allow_all_campanhas" ON campanhas FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='campanha_envios' AND policyname='allow_all_campanha_envios')
  THEN CREATE POLICY "allow_all_campanha_envios" ON campanha_envios FOR ALL USING (true) WITH CHECK (true); END IF;
END $$;

NOTIFY pgrst, 'reload schema';
