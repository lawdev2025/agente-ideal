-- =====================================================================
-- JEV: SATISFAÇÃO (0 a 5) + TEMPERATURA LIDA PELA CONVERSA
--
-- Rode UMA VEZ no SQL Editor do Supabase, DEPOIS de
-- supabase-contact-temperature.sql. É idempotente.
--
-- 1. satisfaction: nota de 0 a 5 (ex.: 4,3) que o Jev lê a cada mensagem do
--    cliente. É média móvel: a mensagem nova vale metade, o histórico a outra
--    metade (src/worker/jev-router.ts → nextSatisfaction).
--
-- 2. jev_temperature: quente/morno/frio que o Jev lê da conversa INTEIRA
--    quando ela fica em silêncio (job /api/jobs/temperature). Quando existe e
--    é mais nova que a última mensagem, ela VENCE a regra antiga (silêncio +
--    link). Se o cliente voltar a falar, a leitura fica velha e o job lê de
--    novo na próxima rodada.
--
-- As colunas novas chegam no app sozinhas: get_contacts_inbox() usa
-- to_jsonb(c), que leva todas as colunas de contacts.
-- =====================================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS satisfaction        REAL;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS satisfaction_at     BIGINT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS jev_temperature     TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS jev_temperature_conf REAL;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS jev_temperature_at  BIGINT;

-- ── RPC: recalcula a temperatura (agora com a leitura do Jev) ─────────
--
-- Mesma SEQUÊNCIA de antes, com um degrau novo antes da regra:
--   0. última mensagem é do CLIENTE  → NULL (fila de atendimento).
--   1. silêncio < cold_after_ms      → NULL (conversa viva).
--   2. NOVO: leitura do Jev mais nova que a última mensagem → ela.
--   3. só 1 mensagem do cliente      → 'frio'.
--   4. o bot já mandou algum link    → 'quente'.
--   5. resto                         → 'morno'.
-- Espelha classifyTemperature() em src/kb/contact-temperature.ts.
create or replace function recompute_contact_temperature(cold_after_ms bigint default 3600000)
returns TABLE (quente int, morno int, frio int, limpos int)
language plpgsql
as $$
declare
  agora bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  with stats as (
    select
      m.wa_id,
      count(*) filter (where m.role = 'user') as user_msgs,
      count(*) filter (where m.role = 'assistant' and m.content ~ 'https?://') as link_msgs,
      max(m.created_at) as last_at,
      (array_agg(m.role order by m.created_at desc))[1] as last_role
    from messages m
    where m.role in ('user', 'assistant')
    group by m.wa_id
  ),
  calc as (
    select
      s.wa_id,
      case
        when s.last_role = 'user'                    then null
        when (agora - s.last_at) < cold_after_ms     then null
        when c2.jev_temperature is not null
         and c2.jev_temperature_at >= s.last_at      then c2.jev_temperature
        when s.user_msgs <= 1                        then 'frio'
        when s.link_msgs > 0                         then 'quente'
        else                                              'morno'
      end as temp
    from stats s
    join contacts c2 on c2.wa_id = s.wa_id
  )
  update contacts c
     set temperature    = calc.temp,
         temperature_at = case when calc.temp is null then null else agora end
    from calc
   where c.wa_id = calc.wa_id
     and c.temperature is distinct from calc.temp;

  return query
    select
      count(*) filter (where temperature = 'quente')::int,
      count(*) filter (where temperature = 'morno')::int,
      count(*) filter (where temperature = 'frio')::int,
      count(*) filter (where temperature is null)::int
    from contacts;
end;
$$;

-- ── RPC: quem o Jev precisa (re)ler ───────────────────────────────────
--
-- Contatos já com temperatura (conversa em silêncio) cuja leitura do Jev não
-- existe ou ficou velha (chegou mensagem depois dela). Mais recentes primeiro.
create or replace function jev_temperature_candidates(max_rows int default 60)
returns TABLE (wa_id text, last_at bigint)
language sql
stable
as $$
  select c.wa_id, s.last_at
  from contacts c
  join lateral (
    select max(m.created_at) as last_at
    from messages m
    where m.wa_id = c.wa_id
      and m.role in ('user', 'assistant')
  ) s on true
  where c.temperature is not null
    and (c.jev_temperature_at is null or c.jev_temperature_at < s.last_at)
  order by s.last_at desc
  limit max_rows;
$$;
