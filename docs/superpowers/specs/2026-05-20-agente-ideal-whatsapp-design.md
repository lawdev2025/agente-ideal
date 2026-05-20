# Agente Ideal — WhatsApp Cloud API + Gemini

**Status:** Design aprovado, aguardando revisão final do autor.
**Data:** 2026-05-20
**Autor:** Joao (assistido por Claude Code)

## Objetivo

Construir um agente de IA, ativo 24h, que atende pais e responsáveis pelo WhatsApp durante o período de matrículas de uma instituição de ensino. O agente deve responder de forma humanizada e precisa, consultar uma base de conhecimento estruturada (mensalidades, calendário, materiais, contatos) e escalar para um humano quando necessário.

O esqueleto inicial deve operar com custo zero de software/LLM (apenas hospedagem). A arquitetura deve permitir, no futuro, trocar o modelo de geração de resposta sem reescrita ampla e expor um endpoint para envio de mensagens em massa (broadcast).

## Decisões fundamentais

| Decisão | Escolha | Motivo |
|---|---|---|
| Integração WhatsApp | **Cloud API (Meta oficial)** | Service conversations (resposta dentro de 24h) são gratuitas desde nov/2024. Zero risco de banimento. Suporte oficial para templates e broadcast futuro. |
| Escopo | **Bidirecional + ponte outbound** | Recebe, responde dentro da janela 24h, e expõe `POST /broadcast` para envio em massa via template (fase 2). |
| Linguagem | **Node.js + TypeScript** | Webhook do WhatsApp é HTTP puro; ecossistema Node tem SDKs maduros (`@google/generative-ai`, `@anthropic-ai/sdk`); deploy trivial em VPS. |
| LLM | **Gemini 2.0 Flash** (free tier) | 15 req/min, 1M tokens/dia gratuitos. Pluggable via interface `LLMProvider` — Claude entra como nova implementação sem mudar o orquestrador. |
| RAG | **JSON estruturado + function calling** | Volume pequeno e dados tabelados. Gemini decide quais "tools" chamar (`consultar_mensalidade`, etc.). Sem vector DB. |
| Persistência | **SQLite (better-sqlite3)** | Sem servidor de banco. Suficiente para fila + histórico + flags. |
| Orquestração | **Fila in-process + worker poll** | Webhook só enfileira (responde 200 em <500ms); worker processa async com retry/backoff. |
| Handoff | **Telegram Bot** | Setup em 5 minutos, gratuito, notificação em segundos para grupo da equipe comercial. |

## Custos esperados

| Componente | Custo |
|---|---|
| WhatsApp Cloud API — service conversations (responder em 24h) | **Grátis** |
| WhatsApp Cloud API — utility/marketing template (broadcast futuro) | ~US$ 0,008–0,0625 por conversa, Brasil |
| Gemini 2.0 Flash | **Grátis** (free tier: 15 RPM, 1M tokens/dia) |
| SQLite | Grátis (embutido) |
| Telegram Bot API | Grátis |
| VPS | Pago pelo usuário (fora do escopo) |

## Arquitetura

```
                ┌──────────────────────────────────────────┐
                │       Meta WhatsApp Cloud API            │
                └──────────────┬───────────────────────────┘
                               │ webhook HTTPS
                               ▼
   ┌──────────────────────────────────────────────────────┐
   │  Fastify (porta 3000)                                │
   │  POST /webhook/whatsapp   ←── verifica assinatura    │
   │     │                                                │
   │     ├─► INSERT em inbound_queue (SQLite)             │
   │     └─► responde 200 OK em <500ms                    │
   │                                                      │
   │  POST /broadcast    ←── auth por token (fase 2)      │
   │  GET  /healthz                                       │
   └──────────────────────────────────────────────────────┘
                               │
                               ▼ (worker poll a cada 1s)
   ┌──────────────────────────────────────────────────────┐
   │  Orchestrator (worker)                               │
   │  1. lê próxima mensagem pendente (claim atômico)     │
   │  2. carrega histórico (últimas 10 msgs do contato)   │
   │  3. chama LLMProvider.respond({msg, history, tools}) │
   │  4. executa tool calls (KB lookup, handoff)          │
   │  5. envia resposta via WhatsApp Cloud API            │
   │  6. marca mensagem como done / failed                │
   └──────────────────────────────────────────────────────┘
                               │
              ┌────────────────┼──────────────────┐
              ▼                ▼                  ▼
       ┌────────────┐   ┌────────────┐    ┌──────────────┐
       │  Gemini    │   │ KB JSON    │    │  Telegram    │
       │ 2.0 Flash  │   │ /kb/*.json │    │  Bot (handoff)│
       └────────────┘   └────────────┘    └──────────────┘
```

## Componentes

Cada módulo expõe uma interface limitada e é testável isoladamente.

| Módulo | Responsabilidade | Interface principal |
|---|---|---|
| `webhook/` | Recebe WhatsApp, valida assinatura HMAC, enfileira | `POST /webhook/whatsapp` |
| `queue/` | Fila SQLite com retry + backoff exponencial | `enqueue()`, `claim()`, `complete()`, `fail()` |
| `worker/` | Orquestrador: consome fila, chama LLM, despacha resposta | `processOne(msg)` |
| `llm/` | Interface `LLMProvider` + implementação `GeminiProvider` | `respond(input): { text, toolCalls }` |
| `kb/` | Carrega JSONs + expõe tools para function calling | `tools[]`, `executeTool(name, args)` |
| `whatsapp/` | Envia mensagens (texto, template) via Graph API | `sendText()`, `sendTemplate()` |
| `handoff/` | Notifica Telegram + pausa bot para o contato | `escalate(reason, context)` |
| `state/` | Histórico de mensagens + flag `bot_paused` por contato | `getHistory()`, `pauseBot()`, `appendMessage()` |
| `config/` | Carrega `.env` validado com Zod | `config.gemini.apiKey`, etc. |

**Princípio de isolamento:** trocar Gemini por Claude = nova classe implementando `LLMProvider`. Trocar SQLite por Postgres = nova implementação de `queue/` e `state/`. Nenhum módulo conhece os internos de outro.

## Fluxo de dados (mensagem normal)

1. Pai envia "Quanto custa a mensalidade do 5º ano?"
2. WhatsApp Cloud API → `POST /webhook/whatsapp`
3. Webhook valida `X-Hub-Signature-256` (HMAC com app secret) → 401 se inválido
4. Insere em `inbound_queue (id, wa_id, wa_message_id, body, status='pending', attempts=0)` → 200 OK
5. Worker polla a cada 1s, executa `UPDATE ... SET status='processing' WHERE id=...` (claim atômico)
6. Worker chama `state.appendMessage(wa_id, 'user', body)` e busca as últimas 10 mensagens do contato
7. Worker chama `gemini.respond({ systemPrompt, history, tools: [consultar_mensalidade, consultar_cronograma, consultar_materiais, consultar_contatos, escalar_humano] })`
8. Gemini retorna `{ toolCalls: [{ name: 'consultar_mensalidade', args: { serie: '5_ano' } }] }`
9. Worker executa a tool (lê `kb/data/mensalidades.json`) → retorna ao Gemini → Gemini gera texto humanizado
10. Worker: `whatsapp.sendText(wa_id, response)` + `state.appendMessage(wa_id, 'assistant', response)` + `queue.complete(id)`

## Fluxo de handoff

Se Gemini chama `escalar_humano({ motivo })`:

1. `handoff.escalate()` envia mensagem no grupo Telegram com:
   - Nome/número do contato WhatsApp
   - Últimas 5 mensagens da conversa
   - Motivo do escalonamento informado pelo Gemini
   - Link `https://wa.me/<wa_id>` para a equipe responder direto
2. `state.pauseBot(wa_id)` → flag `bot_paused = TRUE` para o contato
3. Próximas mensagens desse contato continuam sendo enfileiradas e logadas no histórico, mas o worker **pula a geração de resposta** enquanto a flag estiver ativa
4. **Retomada (MVP):** o bot Telegram envia o link `POST /admin/resume/<wa_id>` junto da notificação de escalonamento. Esse endpoint exige header `X-Admin-Token` (env `ADMIN_TOKEN`) e chama `state.resumeBot(wa_id)`. Mantém o Telegram one-way no MVP; receptor bidirecional fica para fase 2.

**Gatilhos automáticos de handoff** (definidos no system prompt):
- Pai pede explicitamente falar com humano/coordenação
- Detecção de irritação ou insatisfação no tom
- Pergunta sobre caso individual (boleto vencido, transferência, bolsa)
- Gemini não tem confiança suficiente na resposta
- Falha técnica persistente (3 tentativas falhadas no worker)

## Tratamento de erros

| Cenário | Tratamento |
|---|---|
| Webhook lento/inacessível | Meta reenvia. Idempotência via `inbound_queue UNIQUE(wa_message_id)` evita processar 2x. |
| Gemini timeout/erro 5xx | Retry com backoff exponencial (10s, 60s, 300s). Após 3 falhas → handoff automático com motivo "falha técnica". |
| Free tier estourado (15 req/min) | A fila naturalmente serializa. Se ainda assim estourar (HTTP 429), pausa o worker por 60s e loga. |
| WhatsApp send falha (token expirado, número bloqueado) | Mensagem vai para tabela `dead_letter` + alerta Telegram para a equipe. |
| Janela 24h expirou (Graph API erro 131047) | Handoff automático. Humano pode mandar template aprovado a partir do `wa.me/`. |
| Assinatura HMAC inválida no webhook | Retorna 401 sem enfileirar. Loga IP e payload truncado. |

## Persistência (SQLite — `data/agente.db`)

```sql
-- Fila de mensagens recebidas
CREATE TABLE inbound_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_message_id TEXT NOT NULL UNIQUE,
  wa_id TEXT NOT NULL,                  -- número do contato
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|processing|done|failed
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,              -- epoch ms para backoff
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_inbound_pending ON inbound_queue(status, next_attempt_at);

-- Histórico de conversa
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_id TEXT NOT NULL,
  role TEXT NOT NULL,                   -- user|assistant|system|tool
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_messages_wa ON messages(wa_id, created_at DESC);

-- Estado por contato
CREATE TABLE contacts (
  wa_id TEXT PRIMARY KEY,
  bot_paused INTEGER NOT NULL DEFAULT 0,
  paused_reason TEXT,
  paused_at INTEGER,
  last_seen_at INTEGER
);

-- Mensagens que falharam permanentemente
CREATE TABLE dead_letter (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,                 -- inbound|outbound
  payload TEXT NOT NULL,
  error TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

## Estrutura de pastas

```
agente-ideal/
├── src/
│   ├── webhook/
│   │   ├── server.ts           # Fastify + rotas
│   │   └── signature.ts        # HMAC validation
│   ├── queue/
│   │   ├── schema.sql
│   │   └── sqlite-queue.ts
│   ├── worker/
│   │   ├── orchestrator.ts     # processOne()
│   │   └── poller.ts           # setInterval loop
│   ├── llm/
│   │   ├── provider.ts         # interface LLMProvider
│   │   ├── gemini.ts           # implementação atual
│   │   └── prompts/
│   │       └── system-prompt.ts
│   ├── kb/
│   │   ├── loader.ts
│   │   ├── tools.ts            # function declarations p/ Gemini
│   │   └── data/
│   │       ├── mensalidades.json
│   │       ├── calendario.json
│   │       ├── materiais.json
│   │       └── contatos.json
│   ├── whatsapp/
│   │   └── client.ts           # sendText, sendTemplate
│   ├── handoff/
│   │   └── telegram.ts
│   ├── state/
│   │   ├── schema.sql
│   │   └── repository.ts
│   ├── config/
│   │   └── env.ts              # validação Zod
│   └── index.ts                # bootstrap
├── tests/
│   ├── webhook.test.ts
│   ├── orchestrator.test.ts
│   └── fixtures/
├── docs/
│   └── superpowers/specs/
│       └── 2026-05-20-agente-ideal-whatsapp-design.md
├── data/                       # SQLite (ignorar no git)
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

## Dependências

```json
{
  "dependencies": {
    "@google/generative-ai": "^0.21.0",
    "@anthropic-ai/sdk": "^0.30.0",
    "better-sqlite3": "^11.0.0",
    "fastify": "^5.0.0",
    "zod": "^3.23.0",
    "pino": "^9.0.0",
    "pino-pretty": "^11.0.0",
    "dotenv": "^16.0.0",
    "undici": "^6.0.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "tsx": "^4.0.0",
    "@types/node": "^22.0.0",
    "@types/better-sqlite3": "^7.6.0"
  }
}
```

`@anthropic-ai/sdk` fica instalado mas não importado — sinaliza intenção de swap futuro e evita uma migração de dependências mais tarde.

## Variáveis de ambiente

```dotenv
# WhatsApp Cloud API
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_APP_SECRET=             # para validar HMAC do webhook
WHATSAPP_VERIFY_TOKEN=           # string que você escolhe; Meta usa no setup do webhook
WHATSAPP_DRY_RUN=0               # se 1, loga em vez de enviar (smoke test)

# Gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash

# Telegram (handoff)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=                # grupo da equipe comercial

# Persona e instituição
INSTITUTION_NAME=                # ex.: "Colégio Exemplo"
PERSONA_NAME=Ana                 # nome do agente
ENROLLMENT_PERIOD_END=2026-12-15 # informativo, usado no prompt

# Operacional
PORT=3000
NODE_ENV=production
LOG_LEVEL=info
DB_PATH=./data/agente.db
ADMIN_TOKEN=                     # protege POST /admin/resume/:wa_id e POST /broadcast
```

## System prompt do Gemini

Localização: `src/llm/prompts/system-prompt.ts`. Renderizado com substituição de `{{INSTITUTION_NAME}}` e `{{PERSONA_NAME}}` em runtime.

```
Você é {{PERSONA_NAME}}, consultora educacional do {{INSTITUTION_NAME}}.
Atende pais e responsáveis no período de matrículas, exclusivamente por WhatsApp.

TOM: acolhedor, calmo, em português brasileiro natural. Trate por "você", nunca
"senhor(a)" — a instituição é próxima da família.

FORMATO: respostas curtas (1-3 parágrafos), sem listas com marcadores, sem
markdown, sem emojis em excesso (no máximo 1 por mensagem, e só quando soar
natural).

PRECISÃO: você SÓ pode informar dados que vierem das tools (consultar_mensalidade,
consultar_cronograma, consultar_materiais, consultar_contatos). Nunca invente
valor, data ou contato. Se o dado não está nas tools, peça desculpa e use
escalar_humano.

ESCALAÇÃO: chame escalar_humano quando:
  (a) o pai pedir falar com humano/coordenação;
  (b) você detectar irritação ou insatisfação no tom;
  (c) a pergunta for sobre caso individual (boleto vencido, transferência, bolsa,
      situação específica do filho);
  (d) você não tiver confiança suficiente para responder.

PROIBIÇÕES: nunca prometa matrícula garantida, nunca negocie valor, nunca fale
de outras instituições, nunca dê conselho médico ou psicológico.
```

## Function declarations (KB tools)

Resumo das tools que o Gemini terá disponível. Schema completo será gerado em `src/kb/tools.ts`.

| Tool | Args | Retorno |
|---|---|---|
| `consultar_mensalidade` | `{ serie: string }` | `{ valor, vencimento, observacoes }` ou erro |
| `consultar_cronograma` | `{ tipo: 'aulas' \| 'provas' \| 'matricula', serie?: string }` | lista de eventos com data e descrição |
| `consultar_materiais` | `{ serie: string }` | lista de itens da lista de material didático |
| `consultar_contatos` | `{ cargo: string }` | nome, função, telefone, email |
| `escalar_humano` | `{ motivo: string }` | confirmação |

## Testes

| Tipo | Escopo |
|---|---|
| **Unit** | `kb/loader.ts` (carga e validação dos JSONs), `webhook/signature.ts` (HMAC), `queue/sqlite-queue.ts` (claim atômico, retry/backoff), `llm/gemini.ts` (com SDK mockado). |
| **Integration** | `orchestrator.test.ts` faz fluxo end-to-end usando KB fixture + Gemini real, gated por `RUN_E2E=1`. |
| **Smoke manual** | Script `npm run smoke` simula um payload de webhook e checa se a mensagem aparece em log (`WHATSAPP_DRY_RUN=1` impede envio real). |

## Roadmap pós-MVP

1. Endpoint `POST /broadcast` com auth por token, lendo de uma lista de contatos e disparando template aprovado em lote (com rate limit).
2. Implementação `ClaudeProvider` ao lado de `GeminiProvider` (config decide qual usa).
3. Dashboard web simples para a equipe ver fila, conversas pausadas e métricas.
4. Migrar `data/agente.db` para Postgres se concorrência exigir.

## Pendências de configuração (não bloqueiam o início da implementação)

- Nome da instituição e da persona — a serem definidos via `.env` antes do deploy.
- Conteúdo real dos JSONs da base de conhecimento — preenchido pela equipe pedagógica.
- Criação do bot Telegram via BotFather + obtenção do `chat_id` do grupo da equipe comercial — feito antes do primeiro teste end-to-end.
- Cadastro do número WhatsApp Business + verificação do Business Manager na Meta — pré-requisito de deploy, não de desenvolvimento.
