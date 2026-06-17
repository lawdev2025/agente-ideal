-- Adiciona o coordenador do Eixo/Pré-Vestibular na tabela school_contacts.
-- Este número é único e independente da unidade — qualquer dúvida sobre Eixo,
-- cursinho ou pré-vestibular deve ser direcionada a este contato.
--
-- Execute este script no SQL Editor do Supabase.

INSERT INTO school_contacts (name, role_title, phone_number)
VALUES (
  'Coordenação Eixo',
  'Coordenador de Pré-Vestibular / Cursinho (Eixo) — todas as unidades',
  '(91) 99334-4387'
)
ON CONFLICT DO NOTHING;
