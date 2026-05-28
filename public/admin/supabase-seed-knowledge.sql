-- =============================================================
-- SEED DE CONHECIMENTO REAL — COLÉGIO IDEAL (versão defensiva)
-- Popula school_contacts e school_units com os dados oficiais
-- coletados em maio/2026 (ver docs/ROTEIRO-CONHECIMENTO-ESCOLA.md).
--
-- Rode no Supabase SQL Editor:
-- https://supabase.com/dashboard/project/<seu-projeto>/sql/new
--
-- Idempotente: pode rodar mais de uma vez sem duplicar.
-- Cria as tabelas se não existirem antes de popular.
-- =============================================================

-- ── Garante schema completo do bot ────────────────────────────
-- Cria todas as tabelas que o bot do colégio precisa, sem conflitar
-- com tabelas pré-existentes (ex: 'contatos' em português do app
-- cívico vs 'contacts' em inglês do bot).

CREATE TABLE IF NOT EXISTS school_contacts (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  role_title   TEXT NOT NULL,
  phone_number TEXT NOT NULL
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

-- Tabelas adicionais que o bot espera (mesmo sem dados ainda)
CREATE TABLE IF NOT EXISTS school_levels (
  id               TEXT PRIMARY KEY,
  nivel            TEXT NOT NULL,
  descricao        TEXT NOT NULL,
  preco_mensal     NUMERIC(10,2) NOT NULL DEFAULT 0,
  preco_semestral  NUMERIC(10,2) NOT NULL DEFAULT 0,
  preco_anual      NUMERIC(10,2) NOT NULL DEFAULT 0,
  incluso          TEXT NOT NULL DEFAULT ''
);

-- Se a tabela ja existia (schema legado sem DEFAULT), garante que as
-- colunas de preço aceitam 0 sem precisar do usuario informar valor.
ALTER TABLE school_levels ALTER COLUMN preco_mensal     SET DEFAULT 0;
ALTER TABLE school_levels ALTER COLUMN preco_semestral  SET DEFAULT 0;
ALTER TABLE school_levels ALTER COLUMN preco_anual      SET DEFAULT 0;
ALTER TABLE school_levels ALTER COLUMN incluso          SET DEFAULT '';

CREATE TABLE IF NOT EXISTS school_products (
  id           BIGSERIAL PRIMARY KEY,
  category     TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT,
  monthly_fee  NUMERIC(10,2),
  material_fee NUMERIC(10,2),
  schedule     TEXT,
  image_url    TEXT,
  unit_id      TEXT
);

CREATE TABLE IF NOT EXISTS school_materials (
  id           BIGSERIAL PRIMARY KEY,
  nivel        TEXT NOT NULL,
  subject      TEXT NOT NULL,
  title        TEXT NOT NULL,
  download_url TEXT NOT NULL,
  image_url    TEXT
);

ALTER TABLE school_contacts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_units     ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_levels    ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_products  ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_materials ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_school_contacts')  THEN CREATE POLICY "allow_all_school_contacts"  ON school_contacts  FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_school_units')     THEN CREATE POLICY "allow_all_school_units"     ON school_units     FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_school_levels')    THEN CREATE POLICY "allow_all_school_levels"    ON school_levels    FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_school_products')  THEN CREATE POLICY "allow_all_school_products"  ON school_products  FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_school_materials') THEN CREATE POLICY "allow_all_school_materials" ON school_materials FOR ALL USING (true) WITH CHECK (true); END IF;
END $$;

-- Seed nivel apenas com nomes — valores ficam 0 porque a política do
-- colégio é nunca expor R$ no atendimento automatizado. O bot já está
-- programado pra responder "valores na secretaria" quando o cliente
-- pergunta sobre preço.
INSERT INTO school_levels (id, nivel, descricao, preco_mensal, preco_semestral, preco_anual, incluso) VALUES
  ('inf',  'Educação Infantil', 'Maternal, Jardim I e II',  0, 0, 0, 'Material didático Poliedro'),
  ('ef1',  'Fundamental 1',     '1º ao 5º ano',             0, 0, 0, 'Material didático Poliedro, simulados, acompanhamento'),
  ('ef2',  'Fundamental 2',     '6º ao 9º ano',             0, 0, 0, 'Material didático Poliedro, simulados, preparação para EM'),
  ('em',   'Ensino Médio',      '1ª, 2ª e 3ª série',        0, 0, 0, 'Material didático Poliedro, simulados semanais, preparação ENEM'),
  ('eixo', 'Pré-Enem (Eixo)',   'Terceirão e cursinho',     0, 0, 0, 'Material especializado, simulados semanais, turno integral')
ON CONFLICT (id) DO NOTHING;

-- ── Contatos oficiais ─────────────────────────────────────────
-- Limpa entradas anteriores que possam ter sido cadastradas com
-- números genéricos (ex: (11) 99999-XXXX). Mantém estrutura.
DELETE FROM school_contacts;

INSERT INTO school_contacts (name, role_title, phone_number) VALUES
  ('Atendimento Sede',                'Telefone fixo Sede (Batista Campos)',           '559133235000'),
  ('Atendimento WhatsApp',            'WhatsApp central (atende as 3 unidades)',       '5591993898000'),
  ('Atendimento Augusto Montenegro',  'Telefone fixo unidade Augusto Montenegro',      '559132730667'),
  ('Atendimento Cidade Nova',         'Telefone fixo unidade Cidade Nova (Ananindeua)', '559132730222');

-- ── Unidades ──────────────────────────────────────────────────
-- UPSERT por id. Atualiza endereço, telefones, horário e níveis
-- com base no roteiro oficial.
INSERT INTO school_units (
  id, name, address, phone, whatsapp, hours, levels,
  system, infrastructure, activities, capacity
) VALUES
  (
    'sede',
    'Sede (Batista Campos)',
    'Bairro de Batista Campos, Belém — PA',
    '(91) 3323-5000',
    '(91) 99389-8000',
    'Seg-Sex: entrada 07:30 com 30 min de tolerância',
    'Maternal, Jardim I e II, Fundamental 1, Fundamental 2, Ensino Médio, Pré-Enem (Eixo)',
    'Poliedro',
    'Quadra coberta, ginásio, campo, piscina, laboratórios de ciências e informática, biblioteca, auditório, refeitório, parquinho, brinquedoteca, sala de robótica/maker, sala de música/artes',
    'Cursos específicos, Escolinhas de Esporte e NAE (Núcleo de Artes e Empreendedorismo) a partir de 2027 — turno vespertino',
    'A confirmar'
  ),
  (
    'augusto-montenegro',
    'Augusto Montenegro',
    'Rod. Augusto Montenegro, nº 130 — Parque Verde, Belém — PA',
    '(91) 3273-0667',
    '(91) 99389-8000',
    'Seg-Sex: entrada 07:30 com 30 min de tolerância',
    'Maternal, Jardim I e II, Fundamental 1, Fundamental 2, Ensino Médio, Pré-Enem (Eixo)',
    'Poliedro',
    'Quadra coberta, ginásio, campo, piscina, laboratórios de ciências e informática, biblioteca, auditório, refeitório, parquinho, brinquedoteca, sala de robótica/maker, sala de música/artes',
    'Cursos específicos, Escolinhas de Esporte e NAE (Núcleo de Artes e Empreendedorismo) a partir de 2027 — turno vespertino',
    'A confirmar'
  ),
  (
    'cidade-nova',
    'Cidade Nova (Ananindeua)',
    'Conj. Cidade Nova II, Av. SN-3 esq. WE-21, nº 3277 — Ananindeua — PA',
    '(91) 3273-0222',
    '(91) 99389-8000',
    'Seg-Sex: entrada 07:30 com 30 min de tolerância',
    'Maternal, Jardim I e II, Fundamental 1, Fundamental 2, Ensino Médio, Pré-Enem (Eixo)',
    'Poliedro',
    'Quadra coberta, ginásio, campo, piscina, laboratórios de ciências e informática, biblioteca, auditório, refeitório, parquinho, brinquedoteca, sala de robótica/maker, sala de música/artes',
    'Cursos específicos, Escolinhas de Esporte e NAE (Núcleo de Artes e Empreendedorismo) a partir de 2027 — turno vespertino',
    'A confirmar'
  )
ON CONFLICT (id) DO UPDATE SET
  name           = EXCLUDED.name,
  address        = EXCLUDED.address,
  phone          = EXCLUDED.phone,
  whatsapp       = EXCLUDED.whatsapp,
  hours          = EXCLUDED.hours,
  levels         = EXCLUDED.levels,
  system         = EXCLUDED.system,
  infrastructure = EXCLUDED.infrastructure,
  activities     = EXCLUDED.activities,
  capacity       = EXCLUDED.capacity;

-- ── Verificação ───────────────────────────────────────────────
SELECT 'school_contacts'  AS tabela, COUNT(*) AS linhas FROM school_contacts
UNION ALL
SELECT 'school_units',               COUNT(*)            FROM school_units
UNION ALL
SELECT 'school_levels',              COUNT(*)            FROM school_levels
UNION ALL
SELECT 'school_products',            COUNT(*)            FROM school_products
UNION ALL
SELECT 'school_materials',           COUNT(*)            FROM school_materials;
