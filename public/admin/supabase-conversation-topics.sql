-- =====================================================================
-- Fase 3.1 — Classificação de assunto POR CONVERSA, persistida.
--
-- Tabela conversation_topics: um assunto dominante por contato (wa_id), pra
-- o gráfico "Assuntos mais tratados" e o drill-down (clicar num assunto →
-- listar as conversas daquele tópico) sem reprocessar mensagens a cada load.
--
-- Abordagem HÍBRIDA: classificação por regex agora (zero custo), com gancho
-- pronto pro LLM depois — quando o job LLM gravar source='llm', o reclassify
-- por regex NÃO sobrescreve essas linhas (ver ON CONFLICT ... WHERE).
--
-- Categorias (7): as 6 originais + Reclamações.
--
-- Rode UMA VEZ no SQL Editor do Supabase. É idempotente.
-- =====================================================================

create table if not exists conversation_topics (
  wa_id           text primary key,
  topic           text not null,
  confidence      numeric(4, 2),          -- fração do bucket dominante (0..1)
  source          text not null default 'regex',  -- 'regex' | 'llm'
  processed_at    bigint,                 -- epoch ms da última classificação
  last_message_at bigint                  -- epoch ms da última msg considerada
);

create index if not exists idx_conversation_topics_topic on conversation_topics(topic);

alter table conversation_topics enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'conversation_topics' and policyname = 'allow_all_conversation_topics'
  ) then
    create policy "allow_all_conversation_topics" on conversation_topics
      for all using (true) with check (true);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Classificador por regex (full recompute, set-based, idempotente).
-- Pra cada wa_id escolhe o bucket com mais mensagens de usuário (dominante).
-- confidence = msgs do bucket dominante / total de msgs do contato.
-- NÃO toca conversas já classificadas por LLM (source='llm').
-- ---------------------------------------------------------------------
create or replace function classify_conversations_regex()
returns void
language plpgsql
as $$
begin
  insert into conversation_topics (wa_id, topic, confidence, source, processed_at, last_message_at)
  select
    dom.wa_id,
    dom.topic,
    round(dom.cnt::numeric / nullif(dom.total, 0), 2),
    'regex',
    (extract(epoch from now()) * 1000)::bigint,
    dom.overall_last
  from (
    select distinct on (g.wa_id)
      g.wa_id, g.topic, g.cnt, g.total, g.overall_last
    from (
      select
        wa_id,
        case
          when content ~* 'reclama|insatisf|p[ée]ssim|horr[íi]vel|absurd|descaso|decep|n[ãa]o gostei|vergonha|pior atend' then 'Reclamações'
          when content ~* 'mensal|pre[çc]o|valor|pagamento|custo'        then 'Mensalidades / Valores'
          when content ~* 'matr[íi]cula|vaga|inscri[çc][ãa]o|inscrever'   then 'Matrículas & Vagas'
          when content ~* 'material|livro|apostila|caderno'               then 'Materiais / Livros'
          when content ~* 'contato|telefone|whatsapp|secretaria|falar com' then 'Contatos / Secretaria'
          when content ~* 'hor[áa]rio|aula|grade|calend[áa]rio'           then 'Horários & Grade'
          else 'Outras dúvidas'
        end as topic,
        count(*) as cnt,
        sum(count(*)) over (partition by wa_id) as total,
        max(max(created_at)) over (partition by wa_id) as overall_last
      from messages
      where role = 'user'
      group by wa_id, 2
    ) g
    order by g.wa_id, g.cnt desc
  ) dom
  on conflict (wa_id) do update set
    topic           = excluded.topic,
    confidence      = excluded.confidence,
    source          = excluded.source,
    processed_at    = excluded.processed_at,
    last_message_at = excluded.last_message_at
  where conversation_topics.source <> 'llm';  -- preserva classificações do LLM
end;
$$;

-- ---------------------------------------------------------------------
-- Distribuição pro gráfico: nº de CONVERSAS por assunto.
-- ---------------------------------------------------------------------
create or replace function topics_distribution()
returns table(topic text, conversations bigint)
language sql
stable
as $$
  select topic, count(*) as conversations
  from conversation_topics
  group by topic;
$$;

-- ---------------------------------------------------------------------
-- Drill-down: conversas de um assunto (mais recentes primeiro).
-- ---------------------------------------------------------------------
create or replace function conversations_by_topic(p_topic text)
returns setof jsonb
language sql
stable
as $$
  select to_jsonb(t)
  from conversation_topics t
  where t.topic = p_topic
  order by t.last_message_at desc nulls last;
$$;
