-- =====================================================================
-- CRM IDEAL — tabela de inscricoes de Web Push (notificacoes do celular).
-- Guarda as subscriptions do navegador/PWA pra mandar push quando um cliente
-- escreve e o bot esta em atendimento manual (ou acabou de passar pra humano).
-- Rode UMA VEZ no SQL Editor do Supabase. E idempotente (pode rodar de novo).
-- Migracao MANUAL — o deploy da Vercel NAO roda isto (ver wiki: vercel/supabase).
-- =====================================================================

create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);

-- RLS: padrao permissivo allow_all (mesmo padrao das outras tabelas do projeto).
-- Idempotente via pg_policies.
alter table public.push_subscriptions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'push_subscriptions'
      and policyname = 'allow_all_push_subscriptions'
  ) then
    create policy allow_all_push_subscriptions
      on public.push_subscriptions
      for all using (true) with check (true);
  end if;
end $$;
