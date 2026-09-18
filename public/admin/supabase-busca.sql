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
-- unaccent: "volei" tem que achar "vôlei". Sem a extensão a busca ainda
-- funciona (a API cai no LIKE simples), só fica sensível a acento.
--
-- Rode UMA VEZ no SQL Editor do Supabase. É idempotente.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS unaccent;

-- IMMUTABLE: unaccent() é STABLE por padrão (depende do dicionário), o que
-- impede o índice abaixo. O wrapper promete que não muda, que é verdade pro
-- dicionário padrão e é o jeito recomendado de indexar texto sem acento.
CREATE OR REPLACE FUNCTION sem_acento(texto TEXT)
RETURNS TEXT AS $$
  SELECT unaccent('unaccent', texto)
$$ LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE;

-- Índice de trigrama: sem ele o LIKE '%termo%' varre as 15 mil mensagens a
-- cada tecla digitada.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_messages_busca
  ON messages USING gin (sem_acento(lower(content)) gin_trgm_ops);

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
    AND sem_acento(lower(m.content)) LIKE '%' || sem_acento(lower(termo)) || '%'
$$ LANGUAGE sql STABLE;
