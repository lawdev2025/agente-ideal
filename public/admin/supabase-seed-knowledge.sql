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

-- ── Garante schema ────────────────────────────────────────────
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

ALTER TABLE school_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_units    ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_school_contacts') THEN
    CREATE POLICY "allow_all_school_contacts" ON school_contacts FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_school_units') THEN
    CREATE POLICY "allow_all_school_units" ON school_units FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

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
SELECT 'school_contacts' AS tabela, COUNT(*) AS linhas FROM school_contacts
UNION ALL
SELECT 'school_units',              COUNT(*)            FROM school_units;
