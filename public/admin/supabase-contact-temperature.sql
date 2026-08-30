-- =====================================================================
-- TEMPERATURA do contato (quente / morno / frio) + controle de follow-up
-- + tag de SEGMENTO por contato.
--
-- Temperatura é PRIORIDADE de atendimento, não intenção — por isso mora
-- fora de `tag` (matrícula/rematrícula/…) e não entra no donut. Ela é
-- derivada do histórico, então não dá pra gravar no webhook: quem define é
-- o SILÊNCIO, e silêncio não gera evento. Quem carimba é o job
-- /api/jobs/temperature, chamado de hora em hora.
--
-- Rode UMA VEZ no SQL Editor do Supabase. É idempotente.
-- =====================================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS temperature      TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS temperature_at   BIGINT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS followup_stage   SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS followup_at      BIGINT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS segment_tag      TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_temperature ON contacts(temperature);
CREATE INDEX IF NOT EXISTS idx_contacts_segment_tag ON contacts(segment_tag);

-- ── RPC: recalcula a temperatura de todo mundo, set-based ─────────────
--
-- Espelha classifyTemperature() em src/kb/contact-temperature.ts. Se mexer
-- em um, mexa no outro (o TS é o que os testes cobrem; este é o que roda).
--
-- SEQUÊNCIA (a ordem é a regra):
--   0. última mensagem é do CLIENTE  → NULL. Quem deve resposta somos nós;
--      isso é fila de atendimento (needs_reply), não lead esfriando.
--   1. silêncio < cold_after_ms      → NULL. Conversa ainda viva.
--   2. só 1 mensagem do cliente      → 'frio'. Mandou e sumiu, nunca engajou.
--   3. o bot já mandou algum link    → 'quente'. Conversou, foi qualificado e
--      parou justo no passo da conversão: é quem vale ligar.
--   4. caso restante                 → 'morno'. Engajou mas travou antes do link.
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
      -- Link enviado PELO BOT: é o marcador de "lead qualificado" — visita,
      -- calendário, seletiva. Só conta em mensagem nossa, não do cliente.
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
        when s.user_msgs <= 1                        then 'frio'
        when s.link_msgs > 0                         then 'quente'
        else                                              'morno'
      end as temp
    from stats s
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

-- ── RPC: candidatos a follow-up ───────────────────────────────────────
--
-- Devolve, set-based, tudo que nextFollowupStage() em
-- src/kb/contact-temperature.ts precisa pra decidir. A decisão em si NÃO
-- é tomada aqui de propósito: ela envolve a janela de 24h da Meta e o texto
-- da mensagem, e isso mora no TS, coberto por teste.
--
-- Já filtra o que nunca poderia receber empurrão (não-frio, bot pausado,
-- estágio esgotado) pra não trazer a tabela inteira pro Node.
create or replace function followup_candidates(max_rows int default 50)
returns TABLE (
  wa_id           text,
  bot_paused      boolean,
  followup_stage  smallint,
  followup_at     bigint,
  last_at         bigint,
  last_user_at    bigint
)
language sql
stable
as $$
  select
    c.wa_id,
    c.bot_paused,
    c.followup_stage,
    c.followup_at,
    s.last_at,
    s.last_user_at
  from contacts c
  join lateral (
    select
      max(m.created_at)                                   as last_at,
      max(m.created_at) filter (where m.role = 'user')    as last_user_at
    from messages m
    where m.wa_id = c.wa_id
      and m.role in ('user', 'assistant')
  ) s on true
  where c.temperature = 'frio'
    and c.bot_paused = false
    and c.followup_stage < 2
    and s.last_user_at is not null
  order by s.last_at desc
  limit max_rows;
$$;
