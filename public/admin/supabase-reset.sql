-- =============================================================
-- RESET COMPLETO — COLÉGIO IDEAL
-- Cole TODO o conteúdo deste arquivo no SQL Editor do Supabase:
-- https://supabase.com/dashboard/project/<seu-projeto>/sql/new
-- Clique em "Run". Pode rodar mais de uma vez sem problema.
-- =============================================================

-- ── Tabelas de conhecimento ──────────────────────────────────

CREATE TABLE IF NOT EXISTS school_products (
  id              BIGSERIAL PRIMARY KEY,
  category        TEXT          NOT NULL,
  name            TEXT          NOT NULL,
  description     TEXT,
  monthly_fee     NUMERIC(10,2),
  material_fee    NUMERIC(10,2),
  schedule        TEXT,
  image_url       TEXT,
  unit_id         TEXT
);

-- Migration: add unit_id to existing school_products (idempotent)
ALTER TABLE school_products ADD COLUMN IF NOT EXISTS unit_id TEXT;
CREATE INDEX IF NOT EXISTS idx_school_products_unit ON school_products (unit_id);

CREATE TABLE IF NOT EXISTS school_levels (
  id               TEXT PRIMARY KEY,
  nivel            TEXT          NOT NULL,
  descricao        TEXT          NOT NULL,
  preco_mensal     NUMERIC(10,2) NOT NULL,
  preco_semestral  NUMERIC(10,2) NOT NULL,
  preco_anual      NUMERIC(10,2) NOT NULL,
  incluso          TEXT          NOT NULL
);

CREATE TABLE IF NOT EXISTS school_contacts (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  role_title   TEXT NOT NULL,
  phone_number TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS school_materials (
  id           BIGSERIAL PRIMARY KEY,
  nivel        TEXT NOT NULL,
  subject      TEXT NOT NULL,
  title        TEXT NOT NULL,
  download_url TEXT NOT NULL,
  image_url    TEXT
);

CREATE TABLE IF NOT EXISTS school_units (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  address          TEXT NOT NULL,
  phone            TEXT,
  whatsapp         TEXT,
  hours            TEXT,
  levels           TEXT,
  system           TEXT,
  enrollment_fee   NUMERIC(10,2),
  monthly_fee      NUMERIC(10,2),
  material_annual  NUMERIC(10,2),
  infrastructure   TEXT,
  activities       TEXT,
  capacity         TEXT
);

-- ── Tabelas do bot (WhatsApp) ────────────────────────────────

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

-- ── Segurança (RLS) ───────────────────────────────────────────

ALTER TABLE school_products  ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_levels    ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_contacts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_units     ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages         ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_school_products')  THEN CREATE POLICY "allow_all_school_products"  ON school_products  FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_school_levels')    THEN CREATE POLICY "allow_all_school_levels"    ON school_levels    FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_school_contacts')  THEN CREATE POLICY "allow_all_school_contacts"  ON school_contacts  FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_school_materials') THEN CREATE POLICY "allow_all_school_materials" ON school_materials  FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_school_units')     THEN CREATE POLICY "allow_all_school_units"     ON school_units      FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_contacts')         THEN CREATE POLICY "allow_all_contacts"         ON contacts          FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_messages')         THEN CREATE POLICY "allow_all_messages"         ON messages          FOR ALL USING (true) WITH CHECK (true); END IF;
END $$;

-- ── Dados iniciais ────────────────────────────────────────────

-- Mensalidades por nível
INSERT INTO school_levels (id, nivel, descricao, preco_mensal, preco_semestral, preco_anual, incluso) VALUES
  ('ef1',      'Ensino Fundamental 1', '1º ao 5º ano',         1200, 7200,  14400, 'Material didático,Acompanhamento pedagógico,Simulados periódicos'),
  ('ef2',      'Ensino Fundamental 2', '6º ao 9º ano',         1400, 8400,  16800, 'Material didático,Acompanhamento pedagógico,Simulados periódicos,Preparação EM'),
  ('em',       'Ensino Médio',         '1ª e 2ª série',        1700, 10200, 20400, 'Material didático,Acompanhamento pedagógico,Simulados,Preparação ENEM'),
  ('pre-enem', 'Pré-Enem (Eixo)',      'Terceirão e Cursinho', 1900, 11400, 22800, 'Material especializado,Acompanhamento intensivo,Simulados mensais,Turno integral')
ON CONFLICT (id) DO NOTHING;

-- Unidades (restauradas)
INSERT INTO school_units (id, name, address, phone, whatsapp, hours, levels, system, infrastructure, activities, capacity) VALUES
  ('sede',              'Sede (Batista Campos)',     'Batista Campos, Belém — PA',                                     '(91) 3323-5000', '(91) 99389-8000', 'Seg-Sex: entrada 07:30 com 30 min de tolerância', 'Maternal, Jardim I e II, Fundamental 1, Fundamental 2, Ensino Médio, Pré-Enem (Eixo)', 'Poliedro', 'Quadra coberta, ginásio, campo, piscina, laboratórios, biblioteca, auditório, refeitório, parquinho, brinquedoteca, sala de robótica/maker, sala de música/artes', 'Cursos específicos, Escolinhas de Esporte, NAE a partir de 2027', 'A confirmar'),
  ('augusto-montenegro','Augusto Montenegro',        'Rod. Augusto Montenegro, 130 — Parque Verde, Belém',             '(91) 3273-0667', '(91) 99389-8000', 'Seg-Sex: entrada 07:30 com 30 min de tolerância', 'Maternal, Jardim I e II, Fundamental 1, Fundamental 2, Ensino Médio, Pré-Enem (Eixo)', 'Poliedro', 'Quadra coberta, ginásio, campo, piscina, laboratórios, biblioteca, auditório, refeitório, parquinho, brinquedoteca, sala de robótica/maker, sala de música/artes', 'Cursos específicos, Escolinhas de Esporte, NAE a partir de 2027', 'A confirmar'),
  ('cidade-nova',       'Cidade Nova (Ananindeua)',  'Conj. Cidade Nova II, Av. SN-3 esq. WE-21, 3277 — Ananindeua',   '(91) 3273-0222', '(91) 99389-8000', 'Seg-Sex: entrada 07:30 com 30 min de tolerância', 'Maternal, Jardim I e II, Fundamental 1, Fundamental 2, Ensino Médio, Pré-Enem (Eixo)', 'Poliedro', 'Quadra coberta, ginásio, campo, piscina, laboratórios, biblioteca, auditório, refeitório, parquinho, brinquedoteca, sala de robótica/maker, sala de música/artes', 'Cursos específicos, Escolinhas de Esporte, NAE a partir de 2027', 'A confirmar')
ON CONFLICT (id) DO NOTHING;

-- Produtos e turmas (26 itens — preencha mensalidade/material/horário pelo painel)
INSERT INTO school_products (category, name, description) VALUES
  -- Educação Infantil
  ('Educação Infantil','Maternal',  'Turma para crianças de 2 a 3 anos. Estimulação sensorial, psicomotricidade e socialização.'),
  ('Educação Infantil','Jardim I',  'Turma para crianças de 3 a 4 anos. Iniciação à linguagem oral e leitura de mundo.'),
  ('Educação Infantil','Jardim II', 'Turma para crianças de 4 a 5 anos. Preparação lúdica e pedagógica para a alfabetização.'),
  -- Ensino Fundamental — Anos Iniciais
  ('Ensino Fundamental — Anos Iniciais','1º Ano','Alfabetização e letramento com metodologia Poliedro.'),
  ('Ensino Fundamental — Anos Iniciais','2º Ano','Consolidação da leitura, escrita e operações matemáticas básicas.'),
  ('Ensino Fundamental — Anos Iniciais','3º Ano','Língua portuguesa, matemática e ciências naturais aprofundados.'),
  ('Ensino Fundamental — Anos Iniciais','4º Ano','Expansão do raciocínio lógico-matemático. Início de história e geografia.'),
  ('Ensino Fundamental — Anos Iniciais','5º Ano','Conclusão dos anos iniciais. Preparação para a transição ao 6º ano.'),
  -- Ensino Fundamental — Anos Finais
  ('Ensino Fundamental — Anos Finais','6º Ano','Professores especialistas por disciplina. Inglês e robótica incluídos.'),
  ('Ensino Fundamental — Anos Finais','7º Ano','Ciências humanas e exatas aprofundadas. Simulados bimestrais.'),
  ('Ensino Fundamental — Anos Finais','8º Ano','Foco em raciocínio crítico e produção textual. Pré-iniciação ao EM.'),
  ('Ensino Fundamental — Anos Finais','9º Ano','Conclusão do EF. Preparação para o SAEB e transição ao Ensino Médio.'),
  -- Ensino Médio
  ('Ensino Médio','1ª Série EM',           'Início do Ensino Médio com sistema Poliedro. Simulados mensais e acompanhamento individual.'),
  ('Ensino Médio','2ª Série EM',           'Aprofundamento para ENEM e vestibulares. Redação semanal e projetos interdisciplinares.'),
  ('Ensino Médio','3ª Série EM (Convênio)','Convênio especial. Foco total em aprovação no ENEM e melhores universidades.'),
  -- Pré-Vestibular (Eixo)
  ('Pré-Vestibular (Eixo)','Eixo Pré-Vestibular','Preparatório intensivo para ENEM e principais vestibulares do Brasil. Turno integral.'),
  ('Pré-Vestibular (Eixo)','Terceirão (Eixo)',    '3º Ano do EM integrado com preparatório ENEM no mesmo turno.'),
  ('Pré-Vestibular (Eixo)','Militares',            'Preparação específica para EsPCEx, AFA, IME, EFOMM e outros concursos militares.'),
  -- Escolinhas de Esporte
  ('Escolinhas de Esporte','Futsal',                  'Iniciação esportiva e treinamento técnico. Aberto a alunos e comunidade.'),
  ('Escolinhas de Esporte','Natação',                 'Aulas de natação para todas as idades em estrutura conveniada.'),
  ('Escolinhas de Esporte','Dança',                   'Ballet, dança contemporânea e ritmos. Formação artística e expressão corporal.'),
  ('Escolinhas de Esporte','Robótica Junior',         'Robótica educacional e programação básica para crianças do EF.'),
  ('Escolinhas de Esporte','Educação Física Avançada','Treinamento físico e esportivo além da grade curricular.'),
  -- Cursos Específicos
  ('Cursos Específicos','Inglês',              'Do básico ao avançado com professores bilíngues. Preparação para exames internacionais.'),
  ('Cursos Específicos','Espanhol',            'Espanhol conversacional e para provas. DELE e ENEM preparatório incluídos.'),
  ('Cursos Específicos','Reforço Escolar',     'Atendimento individualizado para alunos com dificuldades em disciplinas específicas.'),
  ('Cursos Específicos','Educação Financeira', 'Finanças pessoais e empreendedorismo para jovens do EM e EF final.')
;

-- ── Replicação por unidade (idempotente) ─────────────────────
-- Cria 1 cópia de cada produto NULL em cada unidade existente,
-- depois apaga os originais sem unit_id. Roda 1x na primeira migração.
DO $$
DECLARE
  null_count INT;
BEGIN
  SELECT COUNT(*) INTO null_count FROM school_products WHERE unit_id IS NULL;
  IF null_count > 0 THEN
    INSERT INTO school_products (category, name, description, monthly_fee, material_fee, schedule, image_url, unit_id)
    SELECT p.category, p.name, p.description, p.monthly_fee, p.material_fee, p.schedule, p.image_url, u.id
    FROM school_products p
    CROSS JOIN school_units u
    WHERE p.unit_id IS NULL;

    DELETE FROM school_products WHERE unit_id IS NULL;
  END IF;
END $$;
