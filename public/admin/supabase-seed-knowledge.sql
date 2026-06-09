-- =============================================================
-- SEED COMPLETO DE CONHECIMENTO — COLÉGIO IDEAL
-- Popula school_contacts, school_units, school_levels e school_products
-- com TODOS os dados oficiais coletados no roteiro de maio/2026.
--
-- Rode no Supabase SQL Editor:
-- https://supabase.com/dashboard/project/<seu-projeto>/sql/new
--
-- Idempotente: pode rodar mais de uma vez sem duplicar nem quebrar.
-- =============================================================

-- ── 0. Garante schema completo do bot ─────────────────────────
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
  capacity         TEXT,
  visit_link       TEXT
);

-- Garante colunas novas em instâncias que já existiam antes desta versão
ALTER TABLE school_units ADD COLUMN IF NOT EXISTS visit_link TEXT;
-- extra_info: observações livres da unidade que o bot injeta no contexto do LLM
ALTER TABLE school_units ADD COLUMN IF NOT EXISTS extra_info TEXT;

-- RESPOSTAS DIRETAS: o dono cadastra gatilho + resposta exata pelo painel e o
-- bot responde VERBATIM, sem LLM. É como adicionar info nova sem precisar de
-- código. gatilhos = palavras/frases separadas por vírgula.
CREATE TABLE IF NOT EXISTS school_faq (
  id          BIGSERIAL PRIMARY KEY,
  gatilhos    TEXT    NOT NULL,
  resposta    TEXT    NOT NULL,
  unit_id     TEXT,
  ativo       BOOLEAN NOT NULL DEFAULT TRUE,
  prioridade  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS school_levels (
  id               TEXT PRIMARY KEY,
  nivel            TEXT NOT NULL,
  descricao        TEXT NOT NULL,
  preco_mensal     NUMERIC(10,2) NOT NULL DEFAULT 0,
  preco_semestral  NUMERIC(10,2) NOT NULL DEFAULT 0,
  preco_anual      NUMERIC(10,2) NOT NULL DEFAULT 0,
  incluso          TEXT NOT NULL DEFAULT ''
);

-- Schema legado pode ter colunas NOT NULL sem default. Garante DEFAULT.
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
ALTER TABLE school_faq       ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_school_contacts')  THEN CREATE POLICY "allow_all_school_contacts"  ON school_contacts  FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_school_units')     THEN CREATE POLICY "allow_all_school_units"     ON school_units     FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_school_levels')    THEN CREATE POLICY "allow_all_school_levels"    ON school_levels    FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_school_products')  THEN CREATE POLICY "allow_all_school_products"  ON school_products  FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_school_materials') THEN CREATE POLICY "allow_all_school_materials" ON school_materials FOR ALL USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_school_faq')       THEN CREATE POLICY "allow_all_school_faq"       ON school_faq       FOR ALL USING (true) WITH CHECK (true); END IF;
END $$;


-- ── 1. CONTATOS OFICIAIS ──────────────────────────────────────
-- Limpa entradas antigas (fakes legados) e insere os 4 reais.
DELETE FROM school_contacts;

-- WhatsApp central removido de propósito: o cliente JÁ fala com o bot pelo
-- WhatsApp, então não faz sentido o bot devolver um número de WhatsApp. Só os
-- telefones fixos das unidades/secretaria.
INSERT INTO school_contacts (name, role_title, phone_number) VALUES
  ('Atendimento Sede',                'Telefone fixo Sede (Batista Campos)',           '559133235000'),
  ('Atendimento Augusto Montenegro',  'Telefone fixo unidade Augusto Montenegro',      '559132730667'),
  ('Atendimento Cidade Nova',         'Telefone fixo unidade Cidade Nova (Ananindeua)', '559132730222');


-- ── 2. UNIDADES ───────────────────────────────────────────────
-- Limpa fakes legados e insere as 3 reais com endereço, horário,
-- níveis, sistema, infraestrutura e atividades.
DELETE FROM school_units;

INSERT INTO school_units (id, name, address, phone, whatsapp, hours, levels, system, infrastructure, activities, capacity, visit_link) VALUES
  (
    'sede',
    'Sede (Batista Campos)',
    'Rua dos Mundurucus, 1412 — Batista Campos, Belém — PA',
    '(91) 3323-5000',
    NULL,
    'Segunda a sexta, entrada 07:30 com 30 min de tolerância',
    'Maternal, Jardim I e II, Fundamental 1, Fundamental 2, Ensino Médio, Pré-Enem (Eixo)',
    'Poliedro',
    'Quadra coberta, ginásio, campo, piscina, laboratórios de ciências e informática, biblioteca, auditório, refeitório, parquinho, brinquedoteca, sala de robótica/maker, sala de música/artes',
    'Cursos específicos, Escolinhas de Esporte e NAE (Núcleo de Artes e Empreendedorismo) a partir de 2027 — turno vespertino',
    'A confirmar',
    'https://grupoideal.com.br?quillbooking_calendar=agendamento-ideal-batista-campos&event=visita-ideal-batista-campos'
  ),
  (
    'augusto-montenegro',
    'Augusto Montenegro',
    'Rodovia Augusto Montenegro, 130 — Parque Verde, Belém — PA',
    '(91) 3273-0667',
    NULL,
    'Segunda a sexta, entrada 07:30 com 30 min de tolerância',
    'Maternal, Jardim I e II, Fundamental 1, Fundamental 2, Ensino Médio, Pré-Enem (Eixo)',
    'Poliedro',
    'Quadra coberta, ginásio, campo, piscina, laboratórios de ciências e informática, biblioteca, auditório, refeitório, parquinho, brinquedoteca, sala de robótica/maker, sala de música/artes',
    'Cursos específicos, Escolinhas de Esporte e NAE (Núcleo de Artes e Empreendedorismo) a partir de 2027 — turno vespertino',
    'A confirmar',
    'https://grupoideal.com.br?quillbooking_calendar=agendamento-ideal-augusto-montenegro&event=visita-ideal-augusto-montenegro'
  ),
  (
    'cidade-nova',
    'Cidade Nova (Ananindeua)',
    'Conjunto Cidade Nova II, Av. SN-3, nº 3277 (esquina com a WE-21) — Coqueiro, Ananindeua — PA',
    '(91) 3273-0222',
    NULL,
    'Segunda a sexta, entrada 07:30 com 30 min de tolerância',
    'Maternal, Jardim I e II, Fundamental 1, Fundamental 2, Ensino Médio, Pré-Enem (Eixo)',
    'Poliedro',
    'Quadra coberta, ginásio, campo, piscina, laboratórios de ciências e informática, biblioteca, auditório, refeitório, parquinho, brinquedoteca, sala de robótica/maker, sala de música/artes',
    'Cursos específicos, Escolinhas de Esporte e NAE (Núcleo de Artes e Empreendedorismo) a partir de 2027 — turno vespertino',
    'A confirmar',
    'https://grupoideal.com.br?quillbooking_calendar=agendamento-ideal-cidade-nova&event=visita-ideal-cidade-nova'
  );


-- ── 3. NÍVEIS DE ENSINO ───────────────────────────────────────
-- Valores ficam 0 — política do colégio: valores informados só na
-- secretaria. O bot já trata isso na resposta.
DELETE FROM school_levels;

INSERT INTO school_levels (id, nivel, descricao, preco_mensal, preco_semestral, preco_anual, incluso) VALUES
  ('inf',  'Educação Infantil', 'Maternal, Jardim I e II',  0, 0, 0, 'Material didático Poliedro, acompanhamento pedagógico'),
  ('ef1',  'Fundamental 1',     '1º ao 5º ano',             0, 0, 0, 'Material didático Poliedro, simulados, acompanhamento individual'),
  ('ef2',  'Fundamental 2',     '6º ao 9º ano',             0, 0, 0, 'Material didático Poliedro, simulados periódicos, preparação para EM'),
  ('em',   'Ensino Médio',      '1ª, 2ª e 3ª série',        0, 0, 0, 'Material didático Poliedro, simulados semanais, preparação ENEM'),
  ('eixo', 'Pré-Enem (Eixo)',   'Terceirão e cursinho',     0, 0, 0, 'Material especializado, simulados semanais, turno integral, foco em ENEM e vestibulares');


-- ── 4. PRODUTOS (turmas por unidade) ──────────────────────────
-- Cria todas as turmas/cursos oficiais em cada unidade. Sem valores
-- (política do colégio). Bot vai responder "valores na secretaria".
DELETE FROM school_products;

-- Macro pra inserir os mesmos produtos em todas as 3 unidades
DO $$
DECLARE
  unit_ids TEXT[] := ARRAY['sede', 'augusto-montenegro', 'cidade-nova'];
  u TEXT;
BEGIN
  FOREACH u IN ARRAY unit_ids LOOP
    INSERT INTO school_products (category, name, description, unit_id) VALUES
      -- Educação Infantil
      ('Educação Infantil', 'Maternal',  'Turma para crianças de 2 a 3 anos. Estimulação sensorial, psicomotricidade e socialização.', u),
      ('Educação Infantil', 'Jardim I',  'Turma para crianças de 3 a 4 anos. Iniciação à linguagem oral e leitura de mundo.',          u),
      ('Educação Infantil', 'Jardim II', 'Turma para crianças de 4 a 5 anos. Preparação lúdica e pedagógica para a alfabetização.',    u),
      -- Fundamental 1 (Anos Iniciais)
      ('Ensino Fundamental — Anos Iniciais', '1º Ano', 'Alfabetização e letramento com metodologia Poliedro.',                              u),
      ('Ensino Fundamental — Anos Iniciais', '2º Ano', 'Consolidação da leitura, escrita e operações matemáticas básicas.',                  u),
      ('Ensino Fundamental — Anos Iniciais', '3º Ano', 'Língua portuguesa, matemática e ciências naturais aprofundados.',                    u),
      ('Ensino Fundamental — Anos Iniciais', '4º Ano', 'Expansão do raciocínio lógico-matemático. Início de história e geografia.',          u),
      ('Ensino Fundamental — Anos Iniciais', '5º Ano', 'Conclusão dos anos iniciais. Preparação para a transição ao 6º ano.',                u),
      -- Fundamental 2 (Anos Finais)
      ('Ensino Fundamental — Anos Finais', '6º Ano', 'Professores especialistas por disciplina. Inglês e robótica incluídos.',               u),
      ('Ensino Fundamental — Anos Finais', '7º Ano', 'Ciências humanas e exatas aprofundadas. Simulados bimestrais.',                        u),
      ('Ensino Fundamental — Anos Finais', '8º Ano', 'Foco em raciocínio crítico e produção textual. Pré-iniciação ao EM.',                  u),
      ('Ensino Fundamental — Anos Finais', '9º Ano', 'Conclusão do EF. Preparação para o SAEB, simulados semanais e transição ao EM.',       u),
      -- Ensino Médio
      ('Ensino Médio', '1ª Série EM', 'Início do EM com sistema Poliedro. Simulados semanais e acompanhamento individual.',                  u),
      ('Ensino Médio', '2ª Série EM', 'Aprofundamento para ENEM e vestibulares. Redação semanal e projetos interdisciplinares.',             u),
      ('Ensino Médio', '3ª Série EM', 'Foco total em aprovação no ENEM e melhores universidades. Simulados semanais.',                       u),
      -- Pré-Vestibular (Eixo)
      ('Pré-Vestibular (Eixo)', 'Eixo Pré-Vestibular',      'Preparatório intensivo para ENEM e vestibulares. Turno integral, simulados semanais.', u),
      ('Pré-Vestibular (Eixo)', 'Terceirão (Eixo)',         '3º Ano do EM integrado com preparatório ENEM no mesmo turno.',                          u),
      ('Pré-Vestibular (Eixo)', 'Militares',                'Preparação específica para EsPCEx, AFA, IME, EFOMM e outros concursos militares.',      u),
      -- Escolinhas de Esporte (vespertino)
      ('Escolinhas de Esporte', 'Futsal',           'Iniciação esportiva e treinamento técnico. Turno vespertino.',                      u),
      ('Escolinhas de Esporte', 'Natação',          'Aulas de natação para todas as idades em estrutura conveniada. Turno vespertino.',  u),
      ('Escolinhas de Esporte', 'Dança',            'Ballet, dança contemporânea e ritmos. Formação artística. Turno vespertino.',       u),
      ('Escolinhas de Esporte', 'Robótica Junior',  'Robótica educacional e programação básica para crianças do EF. Turno vespertino.', u),
      -- Cursos Específicos (vespertino)
      ('Cursos Específicos', 'Inglês',                'Do básico ao avançado com professores bilíngues. Turno vespertino.',              u),
      ('Cursos Específicos', 'Espanhol',              'Espanhol conversacional e para provas. DELE e ENEM. Turno vespertino.',           u),
      ('Cursos Específicos', 'Reforço Escolar',       'Atendimento individualizado para alunos com dificuldades. Turno vespertino.',     u),
      ('Cursos Específicos', 'Educação Financeira',   'Finanças pessoais e empreendedorismo para jovens. Turno vespertino.',             u),
      -- NAE (novo em 2027)
      ('NAE — Núcleo de Artes e Empreendedorismo', 'NAE 2027', 'Projeto novo para 2027 com foco em artes, criatividade e empreendedorismo. Turno vespertino.', u);
  END LOOP;
END $$;


-- ── 5. RESPOSTAS DIRETAS (exemplos reais) ─────────────────────
-- Recria os exemplos de fábrica. NÃO apaga linhas que o dono criou pelo painel
-- (só remove as que têm prioridade negativa = marcadas como "exemplo seed").
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


-- ── 6. VERIFICAÇÃO ────────────────────────────────────────────
SELECT 'school_contacts'  AS tabela, COUNT(*) AS linhas FROM school_contacts
UNION ALL
SELECT 'school_units',               COUNT(*)            FROM school_units
UNION ALL
SELECT 'school_levels',              COUNT(*)            FROM school_levels
UNION ALL
SELECT 'school_products',            COUNT(*)            FROM school_products
UNION ALL
SELECT 'school_materials',           COUNT(*)            FROM school_materials
UNION ALL
SELECT 'school_faq',                 COUNT(*)            FROM school_faq
ORDER BY tabela;
