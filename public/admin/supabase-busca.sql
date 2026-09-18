-- =====================================================================
-- BUSCA NO HISTÓRICO DAS CONVERSAS (caixa de pesquisa do app e do /admin).
--
-- POR QUE EXISTE: a busca só olhava a ÚLTIMA mensagem de cada conversa —
-- o único texto que a lista carrega. Quem perguntou "aulas de vôlei" e
-- depois recebeu a saudação do bot ficava invisível. Medido no banco real:
-- de 777 conversas que citaram "bolsa", a busca antiga achava 342.
--
-- Roda no banco, e não no navegador, porque são 15 mil mensagens: mandar
-- tudo pro celular da atendente a cada tecla não se sustenta.
--
-- Rode UMA VEZ no SQL Editor do Supabase. É idempotente.
-- =====================================================================

-- Tira o acento com translate(), e NÃO com a extensão unaccent.
--
-- A primeira versão deste arquivo usava unaccent e falhava no Supabase com
-- "function unaccent(unknown, text) does not exist": a extensão fica no schema
-- `extensions`, e a forma de dois argumentos ainda exige cast pra regdictionary.
-- translate() é built-in, IMMUTABLE por definição e não depende de schema nem
-- de dicionário. Português tem um conjunto pequeno e fechado de acentos, então
-- não se perde nada — e some uma dependência que só dava dor de cabeça.
--
-- As duas listas precisam ter o MESMO número de caracteres (24 aqui).
CREATE OR REPLACE FUNCTION sem_acento(texto TEXT)
RETURNS TEXT AS $$
  SELECT translate(
    lower(texto),
    'áàâãäéèêëíìîïóòôõöúùûüçñ',
    'aaaaaeeeeiiiiooooouuuucn'
  )
$$ LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE;

-- Devolve só os wa_id — a lista de contatos já está carregada na tela, que
-- cruza com esse conjunto. Mandar as mensagens de volta seria trafegar
-- conversa inteira à toa.
--
-- role = 'user': procura no que o CLIENTE escreveu, não no que o bot respondeu.
-- Medido neste banco: "escolinha" aparece em 528 conversas, mas em apenas 3 foi
-- o cliente quem falou — as outras 525 são texto padrão do bot. Buscar tudo
-- devolveria 528 resultados e enterraria os 3 leads de verdade.
CREATE OR REPLACE FUNCTION buscar_conversas(termo TEXT)
RETURNS TABLE(wa_id TEXT) AS $$
  SELECT DISTINCT m.wa_id
  FROM messages m
  WHERE m.role = 'user'
    AND sem_acento(m.content) LIKE '%' || sem_acento(termo) || '%'
$$ LANGUAGE sql STABLE;

-- Sem índice de propósito: são ~7 mil mensagens de cliente, que o Postgres
-- varre em poucos milissegundos, e a tela ainda espera 250ms depois da última
-- tecla. Índice de trigrama (pg_trgm) só vale a pena se a tabela crescer uma
-- ordem de grandeza — aí é só criar, sem mexer em código:
--   CREATE EXTENSION IF NOT EXISTS pg_trgm;
--   CREATE INDEX idx_messages_busca
--     ON messages USING gin (sem_acento(content) gin_trgm_ops);

-- O PostgREST guarda um cache do schema: sem isto, a função recém-criada pode
-- demorar a aparecer e a API cai no LIKE sensível a acento sem motivo.
NOTIFY pgrst, 'reload schema';
