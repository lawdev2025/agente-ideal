# Migração para Vercel — Design

**Data:** 2026-05-24
**Status:** Design aprovado, aguardando revisão final antes do plano executável
**Escopo:** Adaptar o projeto Agente Ideal (atualmente Fastify + SQLite + worker poller) para rodar 100% no Vercel sem perda de funcionalidade.

---

## 1. Contexto e motivação

O projeto hoje roda como servidor Node.js de longa duração (Fastify na porta 3000) com:
- Banco SQLite local (`better-sqlite3`) como primário, Supabase como espelho
- Worker poller (`MessagePoller`) que consome fila SQLite a cada 500ms
- In-memory state pra dedupe de mensagens e cutoff de start (`PROCESSED_IDS`, `BOT_STARTED_AT_MS`)
- Polling de 2s no painel admin pra atualizar Dashboard e Conversas

Quatro incompatibilidades com Vercel:
1. **Long-running poller** — serverless não suporta processos contínuos
2. **`better-sqlite3`** — binário nativo + filesystem persistente quebram em serverless
3. **In-memory state** — não sobrevive entre invocações
4. **Fastify long-running** — precisa ser quebrado em handlers serverless individuais

Objetivo: rodar tudo no Vercel Hobby (free) sem perder funcionalidade nem mudar UX percebida.

## 2. Decisões arquiteturais (tomadas em brainstorming)

| Decisão | Escolha | Por quê |
|---|---|---|
| Atualizações painel | **Supabase Realtime** (WebSocket direto) | Zero invocações no Vercel; UX instantânea; cabe no free tier do Supabase |
| Processamento de msg | **Síncrono no webhook** | Claude Haiku responde em 2-5s, cabe em 10s do Hobby (30s configurado); sem fila/worker |
| Dedupe & cutoff | **Tabela Supabase `processed_messages` + `bot_state`** | Persiste entre invocações; sem dependência externa |
| SQLite local | **Remover de vez** | Código mais simples; uma fonte de verdade (Supabase); sem `better-sqlite3` |

## 3. Arquitetura alvo

### 3.1 Estrutura de arquivos

```
agente-ideal/
├── api/                          # Vercel serverless functions
│   ├── webhook.ts                # GET (verify Meta) + POST (receber msg)
│   ├── config.ts                 # GET — credenciais pro painel (não-secretas)
│   └── admin/
│       ├── stats.ts              # GET — dashboard stats
│       ├── contacts.ts           # GET — lista de contatos
│       └── contacts/[wa_id]/
│           ├── messages.ts       # GET — histórico de um contato
│           └── pause.ts          # PATCH — pausar/retomar bot
├── public/                       # Servido estático pelo CDN do Vercel
│   ├── admin/
│   │   ├── index.html
│   │   ├── admin.js
│   │   ├── admin.css
│   │   └── csv-examples/
│   └── chat-test.html
├── src/                          # Lógica compartilhada (importada pelas functions)
│   ├── llm/{claude,gemini,provider}.ts
│   ├── kb/{tools,loader}.ts
│   ├── worker/{orchestrator,intent-router}.ts
│   ├── whatsapp/client.ts
│   ├── handoff/telegram.ts
│   ├── state/repository.ts       # Reescrito 100% Supabase
│   ├── webhook/signature.ts
│   ├── logger.ts
│   └── config/{env,index}.ts
├── docs/                         # Specs e planos
├── vercel.json
├── package.json
└── tsconfig.json
```

### 3.2 Arquivos removidos

- `src/db/` (init.ts, connection.ts, supabase.ts substituído por client inline)
- `src/queue/` (db.ts, sqlite-queue.ts)
- `src/state/db.ts` (legacy)
- `src/worker/poller.ts`
- `src/index.ts` (bootstrap Fastify)
- `src/webhook/server.ts` (vira `api/webhook.ts`)

### 3.3 Dependências removidas

`better-sqlite3`, `@types/better-sqlite3`, `fastify`, `@fastify/cors`, `@fastify/static`, `pino-pretty`

### 3.4 Dependências adicionadas

`@vercel/node` (tipos `VercelRequest`/`VercelResponse`)

## 4. Camada de dados

### 4.1 Tabelas existentes (sem mudança)

`school_units`, `school_products`, `school_levels`, `school_contacts`, `school_materials`, `contacts`, `messages`.

### 4.2 Tabela nova: `processed_messages`

```sql
CREATE TABLE IF NOT EXISTS processed_messages (
  message_id   TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_processed_messages_at
  ON processed_messages (processed_at);
ALTER TABLE processed_messages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_processed_messages')
  THEN CREATE POLICY "allow_all_processed_messages" ON processed_messages
    FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
```

**Política de limpeza:** a cada `INSERT`, faz `DELETE FROM processed_messages WHERE processed_at < NOW() - INTERVAL '7 days'`. Sem cron job, custo desprezível (~5ms).

### 4.3 Tabela nova: `bot_state`

```sql
CREATE TABLE IF NOT EXISTS bot_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO bot_state (key, value) VALUES ('cutoff_ms', '0')
  ON CONFLICT (key) DO NOTHING;
ALTER TABLE bot_state ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_bot_state')
  THEN CREATE POLICY "allow_all_bot_state" ON bot_state
    FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
```

`cutoff_ms` armazena o timestamp (epoch ms) a partir do qual mensagens são processadas. Valor `0` = aceita tudo. Usuário ajusta manualmente via SQL Editor quando quiser "começar do zero" (ex: `UPDATE bot_state SET value = '${Date.now()}' WHERE key = 'cutoff_ms'`).

### 4.4 Realtime

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE contacts;
```

(Roda 1x. Idempotente: se já está, dá warning mas não falha.)

### 4.5 Repository (`src/state/repository.ts`)

Reescrito com a mesma API pública atual (`appendMessage`, `getOrCreateContact`, `pauseBot`, `resumeBot`, `isBotPaused`, `updateLastSeen`, `getHistory`). Todas viram funções `async` que retornam Promise (eram síncronas em SQLite). Importadores são atualizados pra usar `await`.

Pra reduzir latência em chamadas paralelas dentro do mesmo handler (ex: `getOrCreateContact` + `updateLastSeen` + `appendMessage`), usa `Promise.all`.

## 5. Endpoints (Vercel Functions)

Cada arquivo em `api/` exporta `export default async function handler(req: VercelRequest, res: VercelResponse)`. Lógica compartilhada vem de `src/`.

### 5.1 `api/webhook.ts`

| Método | Comportamento |
|---|---|
| `GET` | Verificação Meta. Lê query `hub.mode`, `hub.verify_token`, `hub.challenge`. Se token bate com `WHATSAPP_VERIFY_TOKEN`, ecoa challenge com 200. Senão, 403. |
| `POST` | (1) Valida assinatura HMAC com `WHATSAPP_APP_SECRET`. (2) Pra cada mensagem do payload: checa cutoff em `bot_state`, checa dedupe em `processed_messages`, insere em `processed_messages`, chama `orchestrator.processMessage`. (3) Retorna 200 sempre que assinatura é válida (mesmo se descartou todas). |

**Configuração de timeout** em `vercel.json`:
```json
"functions": { "api/webhook.ts": { "maxDuration": 30 } }
```

### 5.2 `api/config.ts`

`GET` retorna JSON:
```json
{
  "SUPABASE_URL": "...",
  "SUPABASE_ANON_KEY": "...",
  "ADMIN_TOKEN": "..."
}
```

`ADMIN_TOKEN` é exposto porque o painel precisa dele pra chamar `/api/admin/*`. Quem tem acesso ao painel tem acesso ao token. Pra restringir mais no futuro: adicionar auth via Vercel Edge Middleware.

### 5.3 `api/admin/*`

Todas autenticadas via header `Authorization: Bearer <ADMIN_TOKEN>`. Comparação contra `process.env.ADMIN_TOKEN`. Falha → 401.

| Rota | Função |
|---|---|
| `GET /api/admin/stats` | Calcula total messages, contacts, active (24h), inactive, escalations, last 7 days msg counts, topic buckets |
| `GET /api/admin/contacts` | Lista contatos ordenados por `last_seen_at desc`, faz backfill de wa_ids presentes em `messages` mas não em `contacts` |
| `GET /api/admin/contacts/[wa_id]/messages` | Histórico ordenado `created_at asc` |
| `PATCH /api/admin/contacts/[wa_id]/pause` | Body `{paused: boolean}`. Chama `pauseBot` ou `resumeBot` |

### 5.4 Estático (`public/`)

`public/admin/*` é servido como CDN. `/admin/index.html`, `/admin/admin.js` etc. funcionam sem rewrites.

Rewrite cosmético em `vercel.json` pra suportar `/admin` (sem `/index.html`):
```json
"rewrites": [
  { "source": "/admin", "destination": "/admin/index.html" }
]
```

## 6. Painel admin com Realtime

### 6.1 Subscriptions

No boot do `admin.js`, após `initConnection` carregar credenciais:

```js
_sb.channel('admin-conversations')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload) => onNewMessage(payload.new))
  .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts' },
      (payload) => onContactChange(payload.new))
  .subscribe();
```

### 6.2 Handlers por tab ativa

| Tab | Reação |
|---|---|
| Dashboard | `INSERT messages` → incrementa contador "Total"; adiciona barra no gráfico do dia. `UPDATE contacts (bot_paused=true)` → incrementa "Atendimentos Humanos". |
| Conversas | `INSERT messages` da conversa ativa → append bubble. De outra conversa → reposiciona contato no topo da lista, mostra badge. `INSERT contacts` → adiciona à lista. `UPDATE contacts (bot_paused)` → atualiza botão. |
| Banco / Config | Ignora. |

### 6.3 Carga inicial

Continua via `fetch('/api/admin/contacts')` ao trocar pra tab Conversas, e `fetch('/api/admin/stats')` ao trocar pra Dashboard. Realtime cuida só dos *deltas* depois.

### 6.4 Fallback

Se a subscription Realtime não chegar ao estado `SUBSCRIBED` em 10s após `subscribe()`, ativa polling de 30s automático. Sem alarme — log no console. Quando a conexão Realtime se recuperar, desativa o polling.

### 6.5 Custo de invocações Vercel (painel aberto diariamente)

Antes: polling de 2s = ~1800 invocações/hora × 8h = ~14.400/dia ≈ **432k/mês** (estoura free tier de 100k).

Depois: ~10 fetches no boot da sessão (config, stats, contacts iniciais) + ~5 fetches por troca de tab. Uso típico (1 sessão/dia, ~10 trocas de tab) = ~60/dia ≈ **1.800/mês (1.8% do free tier)**.

## 7. Variáveis de ambiente Vercel

Configuradas em Settings → Environment Variables, escopo Production + Preview + Development:

| Variável | Valor |
|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | (existente) |
| `WHATSAPP_ACCESS_TOKEN` | gerar permanente antes de promover prod |
| `WHATSAPP_APP_SECRET` | (existente) |
| `WHATSAPP_VERIFY_TOKEN` | (existente) |
| `WHATSAPP_DRY_RUN` | `0` |
| `LLM_PROVIDER` | `claude` |
| `ANTHROPIC_API_KEY` | (existente) |
| `CLAUDE_MODEL` | `claude-haiku-4-5-20251001` |
| `TELEGRAM_BOT_TOKEN` | (existente, rotacionar antes de prod) |
| `TELEGRAM_CHAT_ID` | (existente) |
| `INSTITUTION_NAME` | `Colégio Ideal` |
| `ENROLLMENT_PERIOD_END` | `2026-12-15` |
| `SUPABASE_URL` | (existente) |
| `SUPABASE_ANON_KEY` | (existente) |
| `ADMIN_TOKEN` | gerar novo forte (~32 chars) |
| `STARTUP_GRACE_SECONDS` | `10` |

Removidos: `DATABASE_PROVIDER`, `DB_PATH`, `PORT`, `NODE_ENV`, `LOG_LEVEL`. `GEMINI_API_KEY` continua opcional (mantém só se quiser fallback).

## 8. Tratamento de erros

- **Assinatura HMAC inválida no webhook** → 403, sem processar
- **Cutoff bloqueia** → 200 (Meta não reenviar), warn no log
- **Dedupe bate** → 200, warn no log
- **Claude erro/timeout** → tenta `escalateToSpecialist` (Telegram), retorna 200
- **Supabase indisponível em endpoint admin** → 503, painel mostra banner offline
- **Realtime cai no painel** → fallback automático pra polling 30s

## 9. Testes de fumaça pós-deploy

| Caso | Critério |
|---|---|
| `GET /api/config` | Retorna JSON com `SUPABASE_URL` |
| `GET /admin` | Carrega painel, conecta, mostra Dashboard |
| `GET /webhook?hub.mode=subscribe&...` | Ecoa challenge se token bate |
| `POST /webhook` msg nova válida | Bot responde no WhatsApp em <8s |
| `POST /webhook` msg duplicada | Descarta, 200 |
| `POST /webhook` msg antes do cutoff | Descarta, 200 |
| Mandar msg WhatsApp | Aparece em Conversas <2s (Realtime) |
| Dashboard aberto | Contadores sobem sem refresh |
| Pausar bot | `bot_paused = 1`, bot ignora próximas msgs |
| Escalação | Telegram recebe alerta |

## 10. Plano de migração (alto nível)

1. Backup: branch `main-legacy`
2. SQL: criar `processed_messages` + `bot_state` + habilitar Realtime
3. Reescrever `src/state/repository.ts` (Supabase, mesma API)
4. Remover SQLite e queue (deletar arquivos, atualizar package.json)
5. Adaptar `src/worker/orchestrator.ts` (dedupe/cutoff via Supabase)
6. Mover `admin-panel/` → `public/admin/`
7. Criar `api/webhook.ts` extraindo de `webhook/server.ts`
8. Criar `api/config.ts`
9. Criar `api/admin/*.ts` (4 arquivos)
10. Reescrever polling admin.js → Realtime + fallback
11. Criar `vercel.json`, remover `src/index.ts`
12. Deploy preview Vercel → testar com URL preview → promover prod

Detalhamento passo-a-passo será gerado pelo `writing-plans` skill.

## 11. Pontos não-cobertos (fora de escopo)

- **App Review da Meta** (libera bot pra qualquer cliente, não só testadores) — independente do Vercel
- **Domínio próprio** (`bot.colegioideal.com.br`) — configuração DNS posterior
- **Storage de imagens de produtos** — já usa Supabase Storage, sem mudança
- **Backup periódico do Supabase** — config futura, sem bloquear migração
- **Métricas/monitoramento** — Vercel Analytics no free tier é suficiente pra começar

## 12. Critérios de sucesso

Migração concluída quando:
- Servidor original (`npm start`) pode ser desligado sem perda
- Webhook Meta aponta pra URL Vercel
- Mensagem nova no WhatsApp gera resposta do bot em <8s
- Painel atualiza em tempo real via Realtime
- Telegram recebe escalações
- Nenhum erro 500 em produção em 24h de uso real
- Custos: $0 Vercel, $0 Supabase, $0 Meta. Apenas Anthropic conforme uso.
