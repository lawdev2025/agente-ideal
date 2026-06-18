-- =============================================================
-- ATUALIZAÇÃO: telefones (Augusto Montenegro + Cidade Nova) + Portal do Aluno
-- Cole TODO este conteúdo no Supabase SQL Editor e clique em Run.
-- Idempotente: pode rodar mais de uma vez sem duplicar nem quebrar.
--
-- O que isto faz:
--   1. Corrige o telefone da Augusto Montenegro → (91) 3120-3188
--   2. Corrige o telefone da Cidade Nova        → (91) 3346-0011
--   3. Cadastra a Resposta Direta do "Portal do Aluno" (boletim + taxas)
--
-- Observação: as demais mudanças deste ciclo (correção do bug do "nome
-- aleatório", "Ideal Júnior/jr = Educação Infantil" e o fluxo de "falar com
-- atendente" que desativa o bot com aviso de horário) são em CÓDIGO — vão pro
-- ar com o deploy, NÃO precisam de SQL.
-- =============================================================

-- ── 1. CONTATOS (tabela school_contacts — usada por get_enrollment_contact) ──
-- phone_number fica no formato 55 + DDD + número (sem máscara).
UPDATE school_contacts
   SET phone_number = '559131203188'
 WHERE name = 'Atendimento Augusto Montenegro';

UPDATE school_contacts
   SET phone_number = '559133460011'
 WHERE name = 'Atendimento Cidade Nova';

-- ── 2. UNIDADES (tabela school_units — usada por get_unit_info) ──────────────
-- phone fica com máscara "(91) XXXX-XXXX".
UPDATE school_units
   SET phone = '(91) 3120-3188'
 WHERE id = 'augusto-montenegro';

UPDATE school_units
   SET phone = '(91) 3346-0011'
 WHERE id = 'cidade-nova';

-- ── 3. PORTAL DO ALUNO (Resposta Direta school_faq, verbatim, sem LLM) ───────
-- Remove primeiro qualquer versão anterior do portal (idempotência) e reinsere.
DELETE FROM school_faq WHERE resposta LIKE '%PortalEducacional%';

INSERT INTO school_faq (gatilhos, resposta, unit_id, ativo, prioridade) VALUES
  (
    'portal do aluno, portal do estudante, portal educacional, portal, area do aluno, área do aluno, boletim, ver boletim, acessar boletim, ver nota, ver notas',
    '📲 *Portal do Aluno* — é por ele que você acessa o *boletim*, acompanha as notas e ainda paga *algumas taxas específicas do aluno*.

👉 Acesse aqui:
https://grupoeducacional136937.rm.cloudtotvs.com.br/FrameHTML/Web/App/Edu/PortalEducacional/login/

É só entrar com seu login e senha. Qualquer dúvida no acesso, a secretaria te orienta! 😊',
    NULL, TRUE, -1
  );

-- ── 4. VERIFICAÇÃO ──────────────────────────────────────────────────────────
SELECT name, phone_number FROM school_contacts WHERE name IN
  ('Atendimento Augusto Montenegro', 'Atendimento Cidade Nova');
SELECT id, phone FROM school_units WHERE id IN ('augusto-montenegro', 'cidade-nova');
SELECT id, gatilhos, ativo, prioridade FROM school_faq WHERE resposta LIKE '%PortalEducacional%';
