-- Criar tabelas para o projeto Agente Ideal no Supabase (PostgreSQL)

-- 1. Fila de mensagens recebidas (inbound_queue)
CREATE TABLE IF NOT EXISTS inbound_queue (
  id BIGSERIAL PRIMARY KEY,
  wa_message_id TEXT NOT NULL UNIQUE,
  wa_id TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at BIGINT,
  last_error TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inbound_pending ON inbound_queue(status, next_attempt_at);

-- 2. Histórico de conversas (messages)
CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  wa_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_wa ON messages(wa_id, created_at DESC);

-- 3. Status de contatos (contacts)
CREATE TABLE IF NOT EXISTS contacts (
  wa_id TEXT PRIMARY KEY,
  bot_paused BOOLEAN NOT NULL DEFAULT FALSE,
  paused_reason TEXT,
  paused_at BIGINT,
  last_seen_at BIGINT
);

-- 4. Registro de erros graves (dead_letter)
CREATE TABLE IF NOT EXISTS dead_letter (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  payload TEXT NOT NULL,
  error TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

-- 5. Mensalidades dos Níveis Escolares (school_levels)
CREATE TABLE IF NOT EXISTS school_levels (
  id TEXT PRIMARY KEY,
  nivel TEXT NOT NULL,
  descricao TEXT NOT NULL,
  preco_mensal NUMERIC(10, 2) NOT NULL,
  preco_semestral NUMERIC(10, 2) NOT NULL,
  preco_anual NUMERIC(10, 2) NOT NULL,
  incluso TEXT[] NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Cronograma de Aulas (school_schedule)
CREATE TABLE IF NOT EXISTS school_schedule (
  id BIGSERIAL PRIMARY KEY,
  student_id TEXT NOT NULL,
  day_of_week TEXT NOT NULL, -- 'Segunda', 'Terça', etc.
  class_time TEXT NOT NULL, -- '07:30 - 08:20', etc.
  subject TEXT NOT NULL, -- 'Matemática', etc.
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Contatos de Suporte do Colégio (school_contacts)
CREATE TABLE IF NOT EXISTS school_contacts (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  role_title TEXT NOT NULL, -- 'Secretaria', 'Financeiro', etc.
  phone_number TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Materiais de Estudo (school_materials)
CREATE TABLE IF NOT EXISTS school_materials (
  id BIGSERIAL PRIMARY KEY,
  nivel TEXT NOT NULL, -- 'Ensino Fundamental', 'Ensino Médio'
  subject TEXT NOT NULL, -- 'Matemática', 'Física'
  title TEXT NOT NULL,
  download_url TEXT NOT NULL,
  image_url TEXT, -- Coluna para salvar a URL da foto anexada
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Inserir alguns dados padrão de exemplo para o Colégio Ideal
INSERT INTO school_levels (id, nivel, descricao, preco_mensal, preco_semestral, preco_anual, incluso) VALUES
('ef1', 'Ensino Fundamental 1', '1º ao 5º ano', 1200.00, 7200.00, 14400.00, ARRAY['Material didático atualizado', 'Acompanhamento pedagógico individualizado', 'Simulados periódicos', 'Aulas em turno matutino ou vespertino']),
('ef2', 'Ensino Fundamental 2', '6º ao 9º ano', 1400.00, 8400.00, 16800.00, ARRAY['Material didático atualizado', 'Acompanhamento pedagógico individualizado', 'Simulados periódicos', 'Preparação para transição ao Ensino Médio', 'Aulas em turno matutino']),
('em', 'Ensino Médio', '1º e 2º série', 1700.00, 10200.00, 20400.00, ARRAY['Material didático atualizado', 'Acompanhamento pedagógico individualizado', 'Simulados periódicos', 'Preparação para Enem e vestibulares', 'Aulas em turno matutino']),
('pre-enem', 'Pró-Enem (Eixo)', 'Terceirão e Cursinho', 1900.00, 11400.00, 22800.00, ARRAY['Material didático especializado para Enem', 'Acompanhamento pedagógico intensivo', 'Simulados mensais tipo Enem', 'Aulas de aprofundamento à tarde', 'Foco total em aprovação nas melhores universidades', 'Turno integral (matutino + tarde)'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO school_schedule (student_id, day_of_week, class_time, subject) VALUES
('STU001', 'Segunda', '07:30 - 08:20', 'Matemática'),
('STU001', 'Segunda', '08:20 - 09:10', 'Física'),
('STU001', 'Quarta', '07:30 - 08:20', 'Português'),
('STU002', 'Segunda', '13:15 - 14:05', 'História'),
('STU002', 'Quinta', '14:05 - 14:55', 'Redação')
ON CONFLICT DO NOTHING;

INSERT INTO school_contacts (name, role_title, phone_number) VALUES
('Atendimento Sede',                'Telefone fixo Sede (Batista Campos)',           '559133235000'),
('Atendimento WhatsApp',            'WhatsApp central (atende as 3 unidades)',       '5591993898000'),
('Atendimento Augusto Montenegro',  'Telefone fixo unidade Augusto Montenegro',      '559132730667'),
('Atendimento Cidade Nova',         'Telefone fixo unidade Cidade Nova (Ananindeua)', '559132730222')
ON CONFLICT DO NOTHING;

INSERT INTO school_materials (nivel, subject, title, download_url, image_url) VALUES
('Ensino Médio', 'Física', 'Fórmula da Termodinâmica', 'https://example.com/pdf/termo.pdf', NULL),
('Ensino Fundamental', 'Português', 'Exercício de Análise Sintática', 'https://example.com/pdf/sintaxe.pdf', NULL)
ON CONFLICT DO NOTHING;
