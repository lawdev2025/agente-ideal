-- =====================================================================
-- RPCs de métricas do Dashboard — agregam no Postgres em vez de trazer
-- TODAS as mensagens de usuário pro Node.
--
-- Por quê: GET /api/admin/stats fazia select de content/created_at/wa_id de
-- todas as mensagens role='user' e calculava em JS (1) usuários únicos por dia
-- nos últimos 7 dias e (2) buckets de assunto por regex. Recalculava tudo a
-- cada abertura do dashboard. Aqui o banco devolve só os agregados.
--
-- Obs.: created_at é BIGINT (epoch ms). Convertemos com to_timestamp(ms/1000).
-- A timezone usada é a do servidor; ajuste 'America/Belem' se precisar fixar.
--
-- Rode UMA VEZ no SQL Editor do Supabase. É idempotente.
-- =====================================================================

-- 1. Usuários únicos por dia nos últimos 7 dias (inclui hoje).
--    Retorna uma linha por dia com o nº de wa_ids distintos que escreveram.
create or replace function stats_unique_users_7d()
returns table(day date, unique_users bigint)
language sql
stable
as $$
  with days as (
    select (current_date - g)::date as day
    from generate_series(0, 6) g
  )
  select d.day,
         count(distinct m.wa_id) as unique_users
  from days d
  left join messages m
    on m.role = 'user'
   and to_timestamp(m.created_at / 1000.0)::date = d.day
  group by d.day
  order by d.day;
$$;

-- 2. Distribuição de assuntos por regex (mesmos buckets do stats.ts), agregada
--    no banco. Considera só mensagens de usuário. A ordem dos WHEN replica a
--    prioridade da cadeia if/else original.
create or replace function stats_subjects()
returns table(subject text, total bigint)
language sql
stable
as $$
  select
    case
      when content ~* 'mensal|pre[çc]o|valor|pagamento|custo'        then 'Mensalidades / Valores'
      when content ~* 'matr[íi]cula|vaga|inscri[çc][ãa]o|inscrever'   then 'Matrículas & Vagas'
      when content ~* 'material|livro|apostila|caderno'               then 'Materiais / Livros'
      when content ~* 'contato|telefone|whatsapp|secretaria|falar com' then 'Contatos / Secretaria'
      when content ~* 'hor[áa]rio|aula|grade|calend[áa]rio'           then 'Horários & Grade'
      else 'Outras dúvidas'
    end as subject,
    count(*) as total
  from messages
  where role = 'user'
  group by subject;
$$;
