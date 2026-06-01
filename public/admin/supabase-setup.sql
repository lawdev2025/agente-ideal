-- =============================================================
-- SETUP DO SUPABASE PARA O AGENTE IDEAL - COLÉGIO IDEAL
-- Execute este script no SQL Editor do seu projeto Supabase:
-- https://supabase.com/dashboard/project/<seu-projeto>/sql
-- =============================================================

-- ---------------------------------------------------------------
-- TABELAS SINCRONIZADAS PELO BOT (contacts e messages)
-- O backend Node.js escreve nestas tabelas em tempo real.
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS contacts (
  wa_id        TEXT PRIMARY KEY,
  name         TEXT,
  phone        TEXT,
  bot_paused   BOOLEAN NOT NULL DEFAULT false,
  paused_reason TEXT,
  paused_at    BIGINT,
  last_seen_at BIGINT
);

CREATE TABLE IF NOT EXISTS messages (
  id         BIGSERIAL PRIMARY KEY,
  wa_id      TEXT NOT NULL,
  role       TEXT NOT NULL,         -- 'user' | 'assistant' | 'tool' | 'system'
  content    TEXT NOT NULL,
  created_at BIGINT NOT NULL        -- timestamp em ms (Date.now())
);

CREATE INDEX IF NOT EXISTS idx_messages_wa_id ON messages (wa_id, created_at DESC);

-- ---------------------------------------------------------------
-- TABELAS DA BASE DE CONHECIMENTO (gerenciadas pelo painel admin)
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS school_levels (
  id               TEXT PRIMARY KEY,
  nivel            TEXT NOT NULL,
  descricao        TEXT NOT NULL,
  preco_mensal     NUMERIC(10,2) NOT NULL,
  preco_semestral  NUMERIC(10,2) NOT NULL,
  preco_anual      NUMERIC(10,2) NOT NULL,
  incluso          TEXT NOT NULL   -- itens separados por vírgula
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

-- Produtos, turmas e programas do colégio (gerenciados pelo painel admin)
CREATE TABLE IF NOT EXISTS school_products (
  id              BIGSERIAL PRIMARY KEY,
  category        TEXT NOT NULL,         -- grupo: 'Educação Infantil', 'Anos Iniciais', etc.
  name            TEXT NOT NULL,         -- ex: 'Maternal', '1º Ano EF', 'Eixo Pré-Vestibular'
  description     TEXT,                  -- descrição livre
  monthly_fee     NUMERIC(10,2),         -- mensalidade em R$
  material_fee    NUMERIC(10,2),         -- material didático em R$
  schedule        TEXT,                  -- horário das aulas
  image_url       TEXT                   -- URL da imagem/foto
);

-- Unidades / campi do colégio (gerenciadas pelo painel admin)
CREATE TABLE IF NOT EXISTS school_units (
  id               TEXT PRIMARY KEY,           -- ex: 'sede', 'augusto-montenegro'
  name             TEXT NOT NULL,              -- nome exibido da unidade
  address          TEXT NOT NULL,              -- endereço completo
  phone            TEXT,                       -- telefone fixo
  whatsapp         TEXT,                       -- número WhatsApp
  hours            TEXT,                       -- horário de funcionamento
  levels           TEXT,                       -- níveis de ensino oferecidos
  system           TEXT,                       -- sistema de ensino (ex: Poliedro)
  enrollment_fee   NUMERIC(10,2),              -- valor de matrícula
  monthly_fee      NUMERIC(10,2),              -- mensalidade base
  material_annual  NUMERIC(10,2),              -- material didático anual
  infrastructure   TEXT,                       -- infraestrutura disponível
  activities       TEXT,                       -- atividades extracurriculares
  capacity         TEXT                        -- capacidade estimada
);

-- ---------------------------------------------------------------
-- DADOS INICIAIS DA BASE DE CONHECIMENTO
-- (copiados dos JSONs locais em src/kb/data/)
-- ---------------------------------------------------------------

INSERT INTO school_levels (id, nivel, descricao, preco_mensal, preco_semestral, preco_anual, incluso)
VALUES
  ('ef1',      'Ensino Fundamental 1', '1º ao 5º ano',           1200, 7200,  14400, 'Material didático atualizado,Acompanhamento pedagógico individualizado,Simulados periódicos,Aulas em turno matutino ou vespertino'),
  ('ef2',      'Ensino Fundamental 2', '6º ao 9º ano',           1400, 8400,  16800, 'Material didático atualizado,Acompanhamento pedagógico individualizado,Simulados periódicos,Preparação para transição ao Ensino Médio,Aulas em turno matutino'),
  ('em',       'Ensino Médio',         '1ª e 2ª série',          1700, 10200, 20400, 'Material didático atualizado,Acompanhamento pedagógico individualizado,Simulados periódicos,Preparação para Enem e vestibulares,Aulas em turno matutino'),
  ('pre-enem', 'Pré-Enem (Eixo)',      'Terceirão e Cursinho',   1900, 11400, 22800, 'Material didático especializado para Enem,Acompanhamento pedagógico intensivo,Simulados mensais tipo Enem,Aulas de aprofundamento à tarde,Foco total em aprovação nas melhores universidades,Turno integral (matutino + tarde)')
ON CONFLICT (id) DO NOTHING;

-- Produtos iniciais (valores de mensalidade/material/horário para preencher via painel)
INSERT INTO school_products (category, name, description, monthly_fee, material_fee, schedule, image_url) VALUES

  -- Educação Infantil
  ('Educação Infantil', 'Maternal',  'Turma para crianças de 2 a 3 anos. Foco em estimulação sensorial, psicomotricidade e socialização.', NULL, NULL, NULL, NULL),
  ('Educação Infantil', 'Jardim I',  'Turma para crianças de 3 a 4 anos. Iniciação à linguagem oral, leitura de mundo e coordenação motora.', NULL, NULL, NULL, NULL),
  ('Educação Infantil', 'Jardim II', 'Turma para crianças de 4 a 5 anos. Preparação para a alfabetização com atividades lúdicas e pedagógicas.', NULL, NULL, NULL, NULL),

  -- Ensino Fundamental — Anos Iniciais
  ('Ensino Fundamental — Anos Iniciais', '1º Ano',  'Primeiro ano do Ensino Fundamental. Alfabetização e letramento com metodologia Poliedro.', NULL, NULL, NULL, NULL),
  ('Ensino Fundamental — Anos Iniciais', '2º Ano',  'Consolidação da leitura e escrita. Introdução às operações matemáticas básicas.', NULL, NULL, NULL, NULL),
  ('Ensino Fundamental — Anos Iniciais', '3º Ano',  'Aprofundamento da língua portuguesa, matemática e ciências naturais.', NULL, NULL, NULL, NULL),
  ('Ensino Fundamental — Anos Iniciais', '4º Ano',  'Expansão do raciocínio lógico-matemático. Início de história e geografia.', NULL, NULL, NULL, NULL),
  ('Ensino Fundamental — Anos Iniciais', '5º Ano',  'Conclusão dos anos iniciais. Preparação para a transição ao 6º ano.', NULL, NULL, NULL, NULL),

  -- Ensino Fundamental — Anos Finais
  ('Ensino Fundamental — Anos Finais', '6º Ano',  'Início dos anos finais. Disciplinas por professor especialista. Inglês e robótica incluídos.', NULL, NULL, NULL, NULL),
  ('Ensino Fundamental — Anos Finais', '7º Ano',  'Aprofundamento das ciências humanas e exatas. Simulados bimestrais.', NULL, NULL, NULL, NULL),
  ('Ensino Fundamental — Anos Finais', '8º Ano',  'Pré-iniciação ao Ensino Médio. Foco em raciocínio crítico e produção textual.', NULL, NULL, NULL, NULL),
  ('Ensino Fundamental — Anos Finais', '9º Ano',  'Conclusão do EF. Preparação para o SAEB e transição ao Ensino Médio.', NULL, NULL, NULL, NULL),

  -- Ensino Médio
  ('Ensino Médio', '1ª Série EM',            'Início do Ensino Médio com sistema Poliedro. Simulados mensais e acompanhamento individual.', NULL, NULL, NULL, NULL),
  ('Ensino Médio', '2ª Série EM',            'Aprofundamento das bases para ENEM e vestibulares. Redação semanal e projetos interdisciplinares.', NULL, NULL, NULL, NULL),
  ('Ensino Médio', '3ª Série EM (Convênio)', 'Última série do EM com convênio diferenciado. Foco total em aprovação no ENEM e universidades.', NULL, NULL, NULL, NULL),

  -- Pré-Vestibular (Eixo)
  ('Pré-Vestibular (Eixo)', 'Eixo Pré-Vestibular', 'Curso preparatório intensivo para ENEM e principais vestibulares do Brasil. Turno integral.', NULL, NULL, NULL, NULL),
  ('Pré-Vestibular (Eixo)', 'Terceirão (Eixo)',     'Terceiro ano integrado com preparatório. Aluno cursa o 3º EM e já prepara para o ENEM no mesmo turno.', NULL, NULL, NULL, NULL),
  ('Pré-Vestibular (Eixo)', 'Militares',             'Preparação específica para concursos militares: EsPCEx, AFA, IME, EFOMM e outros.', NULL, NULL, NULL, NULL),

  -- Escolinhas de Esporte
  ('Escolinhas de Esporte', 'Futsal',         'Iniciação esportiva e treinamento técnico. Aberto a alunos matriculados e comunidade.', NULL, NULL, NULL, NULL),
  ('Escolinhas de Esporte', 'Natação',        'Aulas de natação para todas as idades em parceria com estrutura conveniada.', NULL, NULL, NULL, NULL),
  ('Escolinhas de Esporte', 'Dança',          'Ballet, dança contemporânea e ritmos. Formação artística e expressão corporal.', NULL, NULL, NULL, NULL),
  ('Escolinhas de Esporte', 'Robótica Junior','Robótica educacional e programação básica para crianças do EF. Kits LEGO Mindstorms.', NULL, NULL, NULL, NULL),
  ('Escolinhas de Esporte', 'Educação Física Avançada', 'Treinamento físico e esportivo além da grade curricular. Foco em saúde e performance.', NULL, NULL, NULL, NULL),

  -- Cursos Específicos
  ('Cursos Específicos', 'Inglês',           'Curso de inglês integrado. Do básico ao avançado, com professores nativos/bilíngues.', NULL, NULL, NULL, NULL),
  ('Cursos Específicos', 'Espanhol',         'Espanhol conversacional e para provas. DELE e ENEM preparatório incluídos.', NULL, NULL, NULL, NULL),
  ('Cursos Específicos', 'Reforço Escolar',  'Atendimento individualizado para alunos com dificuldades em disciplinas específicas.', NULL, NULL, NULL, NULL),
  ('Cursos Específicos', 'Educação Financeira', 'Curso prático de finanças pessoais e empreendedorismo para jovens do EM e EF final.', NULL, NULL, NULL, NULL)
;

INSERT INTO school_units (id, name, address, phone, whatsapp, hours, levels, system, enrollment_fee, monthly_fee, material_annual, infrastructure, activities, capacity)
VALUES
  (
    'sede',
    'Sede (Batista Campos)',
    'Batista Campos, Belém — PA',
    '(91) 3323-5000',
    NULL,
    'Seg-Sex: entrada 07:30 com 30 min de tolerância',
    'Maternal, Jardim I e II, Fundamental 1, Fundamental 2, Ensino Médio, Pré-Enem (Eixo)',
    'Poliedro',
    NULL, NULL, NULL,
    'Quadra coberta, ginásio, campo, piscina, laboratórios, biblioteca, auditório, refeitório, parquinho, brinquedoteca, sala de robótica/maker, sala de música/artes',
    'Cursos específicos, Escolinhas de Esporte, NAE a partir de 2027',
    'A confirmar'
  ),
  (
    'augusto-montenegro',
    'Augusto Montenegro',
    'Rod. Augusto Montenegro, 130 — Parque Verde, Belém',
    '(91) 3273-0667',
    NULL,
    'Seg-Sex: entrada 07:30 com 30 min de tolerância',
    'Maternal, Jardim I e II, Fundamental 1, Fundamental 2, Ensino Médio, Pré-Enem (Eixo)',
    'Poliedro',
    NULL, NULL, NULL,
    'Quadra coberta, ginásio, campo, piscina, laboratórios, biblioteca, auditório, refeitório, parquinho, brinquedoteca, sala de robótica/maker, sala de música/artes',
    'Cursos específicos, Escolinhas de Esporte, NAE a partir de 2027',
    'A confirmar'
  ),
  (
    'cidade-nova',
    'Cidade Nova (Ananindeua)',
    'Conj. Cidade Nova II, Av. SN-3 esq. WE-21, 3277 — Ananindeua',
    '(91) 3273-0222',
    NULL,
    'Seg-Sex: entrada 07:30 com 30 min de tolerância',
    'Maternal, Jardim I e II, Fundamental 1, Fundamental 2, Ensino Médio, Pré-Enem (Eixo)',
    'Poliedro',
    NULL, NULL, NULL,
    'Quadra coberta, ginásio, campo, piscina, laboratórios, biblioteca, auditório, refeitório, parquinho, brinquedoteca, sala de robótica/maker, sala de música/artes',
    'Cursos específicos, Escolinhas de Esporte, NAE a partir de 2027',
    'A confirmar'
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------
-- SEGURANÇA: Row Level Security (RLS)
-- Habilite RLS e crie uma política de acesso aberto para anon
-- apenas se você não tiver autenticação configurada.
-- ATENÇÃO: Em produção, restrinja o acesso conforme necessário.
-- ---------------------------------------------------------------

ALTER TABLE contacts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_levels  ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_units    ENABLE ROW LEVEL SECURITY;

-- Política permissiva para a chave anon (ajuste em produção!)
CREATE POLICY "allow_all_contacts"        ON contacts        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_messages"        ON messages        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_school_levels"   ON school_levels   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_school_contacts" ON school_contacts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_school_materials" ON school_materials FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_school_products" ON school_products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_school_units"    ON school_units    FOR ALL USING (true) WITH CHECK (true);
