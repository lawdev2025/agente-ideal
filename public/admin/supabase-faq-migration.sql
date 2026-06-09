-- =============================================================
-- MIGRAÇÃO: Respostas Diretas (school_faq) + extra_info nas unidades
-- Cole TODO este conteúdo no Supabase SQL Editor e clique em Run.
-- Idempotente: pode rodar mais de uma vez sem quebrar.
--
-- O que isto faz (sem apagar seus dados atuais):
--   1. Cria a tabela school_faq (gatilho + resposta exata)
--   2. Adiciona a coluna extra_info em school_units
--   3. Insere 2 exemplos de Resposta Direta (uniforme e material)
-- =============================================================

-- 1. Tabela de Respostas Diretas
CREATE TABLE IF NOT EXISTS school_faq (
  id          BIGSERIAL PRIMARY KEY,
  gatilhos    TEXT    NOT NULL,   -- palavras/frases separadas por vírgula
  resposta    TEXT    NOT NULL,   -- texto EXATO que o bot envia
  unit_id     TEXT,               -- opcional, só referência
  ativo       BOOLEAN NOT NULL DEFAULT TRUE,
  prioridade  INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE school_faq ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_school_faq')
  THEN CREATE POLICY "allow_all_school_faq" ON school_faq FOR ALL USING (true) WITH CHECK (true); END IF;
END $$;

-- 2. Campo de observações livres por unidade
ALTER TABLE school_units ADD COLUMN IF NOT EXISTS extra_info TEXT;

-- 3. Exemplos de fábrica (prioridade -1 = "exemplo seed"; recriáveis sem
--    tocar nas linhas que você criar pelo painel)
DELETE FROM school_faq WHERE prioridade = -1;
INSERT INTO school_faq (gatilhos, resposta, unit_id, ativo, prioridade) VALUES
  (
    'uniforme, farda, malharia, fardamento',
    'O uniforme é obrigatório e você compra direto na *malharia* da unidade. 👕 Qualquer dúvida sobre tamanhos e peças, a secretaria te orienta!',
    NULL, TRUE, -1
  ),
  (
    'material didatico, material escolar, livros, livro, apostila, apostilas',
    'O material didático é do sistema *Poliedro* e comprado direto na escola — à vista, parcelado ou no Pix. 📚 Os valores o nosso time te passa presencialmente na secretaria.',
    NULL, TRUE, -1
  );

-- Verificação
SELECT id, gatilhos, ativo, prioridade FROM school_faq ORDER BY prioridade DESC, id;
