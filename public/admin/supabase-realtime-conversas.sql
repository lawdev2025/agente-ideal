-- =====================================================================
-- Liga o Supabase REALTIME nas tabelas que a Central de Conversas escuta.
-- Sem isso, o painel cai no polling (mais lento) e a sensacao e de "bugado".
-- Rode UMA VEZ no SQL Editor do Supabase. E idempotente (pode rodar de novo).
-- =====================================================================

-- 1. Adiciona as tabelas a publicacao de realtime (so se ainda nao estiverem).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'contacts'
  ) then
    alter publication supabase_realtime add table public.contacts;
  end if;
end $$;

-- 2. REPLICA IDENTITY FULL em contacts: garante que updates (ex.: bot_paused,
--    last_seen_at) cheguem ao painel com a linha completa.
alter table public.contacts replica identity full;

-- Pronto. Recarregue o painel: o log do navegador deve mostrar
-- "[Realtime] status: SUBSCRIBED" e as mensagens passam a aparecer na hora.
