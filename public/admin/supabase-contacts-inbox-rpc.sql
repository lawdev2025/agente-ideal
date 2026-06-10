-- =====================================================================
-- RPC get_contacts_inbox() — monta a lista de contatos da Central de
-- Conversas COM o preview da última mensagem, tudo no Postgres.
--
-- Por quê: o endpoint GET /api/admin/contacts carregava a tabela `messages`
-- INTEIRA pro Node só pra achar a última mensagem de cada contato. Custo
-- crescia linearmente com o histórico → era o principal gargalo da lista.
-- Aqui usamos um LATERAL com LIMIT 1 por contato, que casa com o índice
-- idx_messages_wa(wa_id, created_at DESC): um index seek por contato.
--
-- Rode UMA VEZ no SQL Editor do Supabase. É idempotente.
-- =====================================================================

create or replace function get_contacts_inbox()
returns setof jsonb
language plpgsql
as $$
begin
  -- 1. Backfill de órfãos: wa_ids que existem em `messages` mas não têm linha
  --    em `contacts` (usuários antigos, antes do auto-create no webhook).
  --    Set-based, roda no banco — só insere quando há órfãos de fato.
  insert into contacts (wa_id, bot_paused, last_seen_at)
  select m.wa_id, false, max(m.created_at)
  from messages m
  where not exists (select 1 from contacts c where c.wa_id = m.wa_id)
  group by m.wa_id
  on conflict (wa_id) do nothing;

  -- 2. Cada contato + sua última mensagem VISÍVEL (ignora tool/system).
  --    to_jsonb(c) preserva quaisquer colunas de contacts (tolera schema sem
  --    name/phone). needs_reply = última mensagem foi do cliente.
  return query
  select
    to_jsonb(c)
    || jsonb_build_object(
         'last_message',      lm.content,
         'last_message_role', lm.role,
         'last_message_at',   coalesce(lm.created_at, c.last_seen_at),
         'needs_reply',       coalesce(lm.role = 'user', false)
       )
  from contacts c
  left join lateral (
    select m.role, m.content, m.created_at
    from messages m
    where m.wa_id = c.wa_id
      and m.role not in ('tool', 'system')
    order by m.created_at desc
    limit 1
  ) lm on true
  order by coalesce(lm.created_at, c.last_seen_at) desc nulls last;
end;
$$;
