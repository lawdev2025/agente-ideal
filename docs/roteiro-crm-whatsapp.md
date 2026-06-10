# Roteiro de Desenvolvimento — CRM WhatsApp: Performance + Chat + Painel Analítico

> **Como usar:** cole as fases deste roteiro no Claude Code uma por vez, na ordem. Não pule a Fase 0. Cada fase termina com critérios de aceite — só avance quando todos estiverem cumpridos.
>
> **Esta versão é específica do projeto Agente Ideal.** A stack já foi mapeada (ver "Realidade do Projeto" abaixo). Onde o roteiro genérico assumia React/Recharts/Socket.io/Baileys, este aqui aponta os arquivos e tabelas reais. Se algo divergir do código no momento da execução, o código vence — atualize o roteiro.

> **Status (atualizado conforme a execução):**
> - ✅ **Fase 1 — Performance** (gargalos #1–#4): RPC de contatos, RPCs de stats, paginação do chat com scroll infinito, cache de 30s no /stats.
> - ✅ **Fase 3.1 — Assuntos persistidos**: tabela `conversation_topics`, classificação híbrida (regex + gancho LLM), 7ª categoria "Reclamações".
> - ✅ **Job LLM** (o "depois" do híbrido): `/api/jobs/classify-topics` via Vercel Cron diário, grava `source='llm'`.
> - ✅ **Fase 4 (parcial)**: donut por conversa + drill-down (clicar no assunto → conversas filtradas).
> - ⬜ **Fase 3.2 / resto da Fase 4**: seletor de período global, volume por hora, top contatos, KPIs extras.
> - ⬜ **Fase 2**: tags/anotações de CRM no chat. **Fase 5**: polimento, testes de analytics, README.
> - ⚠️ **Deploy**: rodar as migrations em `public/admin/*.sql` no Supabase e setar `CRON_SECRET` na Vercel pro cron autorizar.

---

## Contexto do Projeto

CRM/atendimento para WhatsApp de uma instituição de ensino (Colégio Ideal). O sistema **já funciona** e entrega as conversas, porém com lentidão perceptível que **piora conforme a tabela `messages` cresce**. Objetivos desta iteração:

1. **Diagnosticar e corrigir a lentidão** no carregamento das conversas (gargalo já identificado — ver Fase 0).
2. **Refinar a interface do chat** (UX fluida, estilo WhatsApp Web) nos dois frontends.
3. **Evoluir o painel analítico** com gráficos e métricas, incluindo classificação real dos assuntos das conversas.

**Regras gerais:**
- Não reescreva o projeto do zero. Trabalho incremental sobre o código existente.
- Commits pequenos e descritivos a cada etapa concluída (português, prefixo `fix:`/`feat:`/`perf:`).
- Mantenha compatibilidade com as conversas/contatos já armazenados e com o schema atual.
- Vocabulário voltado ao cliente usa **"time"**, nunca "equipe".

---

## Realidade do Projeto (já mapeada — confirme antes de cada fase)

**Stack**
- **Backend:** Node.js + TypeScript em **funções serverless da Vercel** (`api/**.ts`, padrão `VercelRequest/VercelResponse`). Não há servidor long-running — isso **invalida Socket.io/WebSocket próprio**.
- **Banco:** **Supabase (PostgreSQL)**. Acesso via `@supabase/supabase-js`. O bot usa a anon key com RLS `allow_all`.
- **Tempo real:** **Supabase Realtime já está em uso** em [public/app/app.js](../public/app/app.js) e [public/admin/admin.js](../public/admin/admin.js) (canais `postgres_changes`). Migração de polling para socket **não é necessária** — é só usar/ajustar o que existe.
- **LLM:** provider plugável Claude (Anthropic) **ou** Gemini (Google), selecionável no painel. Abstração em [src/llm/provider.ts](../src/llm/provider.ts).
- **Frontends (2):** HTML/CSS/JS **vanilla** (sem framework), **Chart.js** já incluído via CDN.
  - **Admin desktop** — [public/admin/](../public/admin/): sidebar dark + abas Dashboard / Conversas / Banco / Configurações.
  - **CRM mobile PWA** — [public/app/](../public/app/): estética WhatsApp, login por token, lista → chat, push notifications.

**Schema relevante** (ver [supabase_schema.sql](../supabase_schema.sql)):
- `messages(id, wa_id, role, content, created_at)` — **sem `conversation_id`, sem colunas de mídia, sem tags, sem flag de lida.** A "conversa" é identificada pelo `wa_id` (telefone do contato). `role` ∈ user|assistant|tool|system.
  - Índice já existe: `idx_messages_wa ON messages(wa_id, created_at DESC)`.
- `contacts(wa_id PK, bot_paused, paused_reason, paused_at, last_seen_at)`. **Pode não ter `name`/`phone`** em instâncias do schema antigo — não assuma essas colunas (o código usa `SELECT *` justamente por isso).
- `intent_learning(...)` — cache de intenções aprendidas (já alimenta o card "Intenções Aprendidas").

**Endpoints já existentes**
- `GET /api/admin/contacts` — lista de contatos + preview da última mensagem.
- `GET/POST /api/admin/contacts/[wa_id]/messages` — histórico / atendente humano responde (takeover + pausa bot).
- `GET /api/admin/stats` — métricas do dashboard + buckets de assunto por regex.

**Restrições da Vercel a respeitar**
- Funções têm timeout (webhook = 30s em [vercel.json](../vercel.json); demais no default). Job pesado de classificação **não pode** rodar dentro de um request — use **Vercel Cron** (declarar em `vercel.json`) processando em lotes pequenos.
- Sem estado entre invocações além de singletons "warm". Nada de fila in-process persistente.

---

## Fase 0 — Descoberta e Diagnóstico (confirme; não escreva código ainda)

A descoberta já foi feita e está acima. Sua tarefa nesta fase é **validar e medir**, não remapear do zero.

1. Crie `ARCHITECTURE.md` na raiz consolidando a seção "Realidade do Projeto", **mais o fluxo de uma mensagem** (WhatsApp → `POST /api/webhook` → `inbound_queue` → worker/orchestrator → LLM/tools → resposta → `messages`). Use os arquivos reais em `src/` e `api/` como fonte.
2. Crie `PERFORMANCE_DIAGNOSIS.md` com os gargalos **já identificados no código** (abaixo), confirmando cada um e **medindo o tempo atual** (lista de conversas e abertura de uma conversa) com dados reais.

### Gargalos confirmados no código (ordenados por impacto)

1. **`GET /api/admin/contacts` carrega a tabela `messages` INTEIRA.** Em [api/admin/contacts.ts](../api/admin/contacts.ts) o handler faz `from("messages").select("wa_id, role, content, created_at").order("created_at desc")` **sem `limit`**, só para montar o preview da última mensagem por contato em JS. Custo cresce linearmente com o histórico total → este é o **principal** gargalo da lista.
2. **`GET /api/admin/stats` carrega TODAS as mensagens de usuário.** Em [api/admin/stats.ts](../api/admin/stats.ts): `from("messages").select("content, created_at, wa_id").eq("role","user")` sem limite, e então conta usuários únicos/dia e classifica assunto por regex **no Node**. Recalcula tudo a cada abertura do dashboard.
3. **`GET .../[wa_id]/messages` sem paginação.** [messages.ts](../api/admin/contacts/[wa_id]/messages.ts) traz o histórico inteiro do contato (mitigado pelo índice `idx_messages_wa`, mas ainda cresce sem teto).
4. **Sem cache.** Stats e lista são recomputados do zero a cada request.

**Critério de aceite:** `ARCHITECTURE.md` e `PERFORMANCE_DIAGNOSIS.md` criados; os 4 gargalos confirmados no código com tempos medidos (antes).

---

## Fase 1 — Correção da Performance

Ataque na ordem de impacto. A meta é parar de trazer linhas cruas de `messages` para o Node.

1. **Preview da última mensagem sem varrer a tabela (gargalo #1).** Substitua o "puxa tudo e processa em JS" de `contacts.ts` por uma agregação no Postgres. Opções (escolha e justifique):
   - **RPC `DISTINCT ON`** (recomendado): função SQL `get_contacts_with_last_message()` usando `SELECT DISTINCT ON (wa_id) ... ORDER BY wa_id, created_at DESC` filtrando `role NOT IN ('tool','system')`, com JOIN em `contacts`. Uma query, índice-friendly.
   - **View materializada** `contact_inbox` atualizada por trigger/cron, se a contagem de contatos crescer muito.
   - Em qualquer caso: **paginação** (20–30 contatos por página, cursor por `last_seen_at`) e mantenha o `needs_reply` (última msg foi do `user`) calculado no SQL.
2. **Stats agregadas no banco (gargalo #2).** Reescreva [api/admin/stats.ts](../api/admin/stats.ts):
   - Contagens já usam `head: true, count: 'exact'` — bom, mantenha.
   - "Usuários únicos por dia (7d)" e "buckets de assunto": mova para SQL com `GROUP BY` sobre janela de data (`created_at >= now()-7d`), **não** carregue mensagens cruas. Os buckets de regex viram a base da Fase 3 (lá eles passam a ler de `conversation_topics`).
3. **Índices.** O índice de `messages(wa_id, created_at)` já existe. Adicione o que as novas queries exigirem: `messages(created_at)` para os recortes por período do dashboard, e `messages(role, created_at)` se a query de stats filtrar por role+data.
4. **Paginação do chat (gargalo #3).** Em [messages.ts](../api/admin/contacts/[wa_id]/messages.ts) e nos dois frontends: carregar as **50 mais recentes** (`ORDER BY created_at DESC LIMIT 50`, reordenar no cliente) e "carregar mais" ao rolar para cima (cursor por `id`/`created_at`).
5. **Tempo real já existe — não reinvente.** Confirme que os canais Supabase Realtime em `app.js`/`admin.js` cobrem novas mensagens. Se houver polling redundante, remova. **Não introduza Socket.io** (incompatível com serverless da Vercel).
6. **Cache leve (opcional).** Para `stats`, um cache de ~30–60s (em memória do singleton warm ou `Cache-Control` no response) corta recomputo repetido.
7. Meça antes/depois e registre no `PERFORMANCE_DIAGNOSIS.md`.

**Critério de aceite:** lista de conversas < 1s e conversa individual < 500ms com dados reais; nenhuma linha crua de `messages` carregada em JS para montar lista/stats; sem regressão (enviar/receber, takeover, pausar bot).

---

## Fase 2 — Interface do Chat (refinamento)

Referência: WhatsApp Web. Aplica-se aos **dois** frontends, respeitando o que cada um já tem.

1. **Lista de conversas** (esquerda no admin, tela `screen-list` no app):
   - Busca por nome/telefone/conteúdo (o app já tem `#search-input`; o admin tem `#contact-search`).
   - Avatar/inicial, nome (ou `wa_id` formatado quando não há `name`), prévia da última mensagem, horário, e **badge de "precisa responder"** usando o `needs_reply` já retornado pela API.
   - Filtros: todas / precisa responder / pausadas (bot off).
2. **Conversa ativa** (direita no admin, `screen-chat` no app):
   - Bolhas diferenciadas por `role` (`user` recebida / `assistant` enviada). Hoje o histórico não guarda status de entrega/leitura nem mídia — **não invente**; se for necessário, é mudança de schema (ver nota abaixo).
   - Scroll infinito do histórico (Fase 1, item 4).
   - Composer com Enter para enviar / Shift+Enter quebra linha (já existe parcialmente). Respeitar o fluxo de **takeover**: enviar pausa o bot (já implementado no `POST`), e tratar o **erro 422 da janela de 24h** com a mensagem amigável que a API já devolve.
3. **Recursos de CRM (incremental, exige schema novo):**
   - **Etiquetas/tags** e **anotações internas** por contato → nova tabela (`contact_tags`, `contact_notes`) ou colunas em `contacts`. Faça como migração `.sql` em `public/admin/` seguindo o padrão dos outros arquivos de migração. **Pergunte ao usuário** quais tags fazem sentido antes de fixar.
4. **Estados de carregamento:** skeletons em vez de tela branca; erro com retry. O app já tem `#toast` e `conn-banner` — reutilize.

> **Nota sobre mídia:** o roteiro genérico falava de imagem/áudio/documento em base64. Hoje `messages.content` é só texto e o webhook não persiste mídia. Suporte a mídia é um épico à parte (armazenar URL no Supabase Storage + nova coluna) — **não** está no escopo desta iteração salvo pedido explícito.

**Critério de aceite:** navegação fluida sem recarregar; badge de "precisa responder" correto; (se tags entrarem) tags e anotações persistindo; takeover e erro de 24h tratados na UI.

---

## Fase 3 — Backend do Painel Analítico

Antes dos gráficos, prepare os dados. **Hoje os "assuntos" já existem** como buckets de regex em [api/admin/stats.ts](../api/admin/stats.ts) (Mensalidades, Matrículas, Materiais, Contatos, Horários, Outras) — isso é a "Opção B" do roteiro genérico, já entregue. Esta fase **persiste e/ou melhora** essa classificação.

### 3.1 Extração de assuntos persistida

- **Tabela `conversation_topics`** (`wa_id`, `topic`, `confidence`, `source`, `processed_at`, com chave/único por `wa_id`+janela para não reprocessar). Migração `.sql` no padrão de `public/admin/`.
- **Opção A — classificação via LLM (Claude/Gemini, provider já abstraído):** job que processa conversas novas em **lote pequeno**, prompt: *"Classifique esta conversa em UMA categoria: [mensalidades, matrículas, materiais, contatos, horários, reclamação, outro]. Responda só com JSON `{categoria, confianca}`."* **Confirme as categorias com o usuário** antes de fixar (alinhe com os buckets atuais).
- **Opção B — manter regex** como fallback barato (zero custo de API), apenas movendo o resultado para `conversation_topics` em vez de recalcular a cada request.
- **Execução:** **Vercel Cron** declarado em [vercel.json](../vercel.json) chamando `GET /api/jobs/classify-topics` que processa N conversas pendentes por execução (respeitando o timeout). **Nunca** classifique dentro do fluxo do chat.

### 3.2 Métricas agregadas

Endpoints `GET /api/admin/analytics/*` (ou estenda `stats.ts`) com filtro de período (hoje / 7d / 30d / custom), **tudo via `GROUP BY` no Postgres**:
- Total de conversas e mensagens no período.
- Conversas novas vs. recorrentes (por `created_at` do primeiro contato).
- **Distribuição de assuntos** lendo de `conversation_topics` (gráfico principal).
- Volume por dia e **por hora do dia** (horários de pico).
- Tempo médio de 1ª resposta e de resolução (derivar de pares user→assistant por `wa_id`).
- Top 10 contatos mais ativos.
- **Conversas aguardando resposta** (reusar `needs_reply`) — métrica acionável.

**Critério de aceite:** endpoints < 500ms com filtro de período; cron de tópicos processando conversas novas automaticamente e populando `conversation_topics`.

---

## Fase 4 — Frontend do Dashboard

A aba **Dashboard** já existe no admin ([public/admin/index.html](../public/admin/index.html)) com cards de KPI e dois `<canvas>` Chart.js (`chart-conversations`, `chart-subjects`). **Evolua o que existe**, não crie do zero.

**Biblioteca de gráficos:** **Chart.js** (já carregado via CDN — não troque por Recharts; não há React).

**Layout (de cima para baixo):**
1. **Cards de KPI:** conversas no período, mensagens, tempo médio de 1ª resposta, **conversas aguardando resposta** (destaque em vermelho se > 0). Reaproveitar os `.metric-card.glass` já estilizados.
2. **Gráfico principal — Assuntos mais tratados:** barras horizontais ou donut a partir de `conversation_topics`. Clicar num assunto filtra/lista as conversas daquele tópico.
3. **Volume ao longo do tempo:** linha (mensagens/conversas por dia) — evolução do `chart-conversations` atual.
4. **Barras por hora do dia:** quando os clientes mais escrevem.
5. **Tabela: top contatos** (nome/`wa_id`, nº de mensagens, último contato, link que abre a conversa na aba Conversas).
6. **Seletor de período global** no topo (hoje / 7d / 30d / custom) que atualiza tudo.

**Diretrizes:**
- Loading skeleton por gráfico; estados vazios amigáveis ("Sem dados neste período").
- **Responsivo** — o dashboard também é visto no celular.
- Cores consistentes por categoria de assunto em todos os gráficos.
- Mantenha o tema dark/glass e as fontes Lato + Quicksand já em uso.

**Critério de aceite:** dashboard < 2s, todos os gráficos respondem ao filtro de período, e clicar num assunto leva às conversas correspondentes.

---

## Fase 5 — Polimento e Entrega

1. Tratamento de erros global (Supabase fora do ar, WhatsApp desconectado, 24h fechada) — reusar `#toast`/`conn-banner` no app e o `status-indicator` no admin.
2. Testes (Vitest, já configurado): endpoints de analytics e a query agregada de `contacts`. Há fixtures em [tests/](../tests/) para seguir o padrão.
3. Atualizar [README.md](../README.md) — **ele está desatualizado** (menciona SQLite/Fastify/Gemini-only de fases antigas). Corrigir para a stack real: Vercel + Supabase + Claude/Gemini, dois frontends, e como configurar o cron de tópicos (incluindo API key se Opção A).
4. Checklist de regressão: enviar/receber mensagem, abrir conversa antiga, takeover + pausar/retomar bot, erro de janela 24h, filtrar dashboard, classificação de tópicos rodando.

---

## Ordem de prioridade (se o tempo for curto)

1. **Fase 0 + Fase 1** (performance) — o gargalo #1 (`contacts.ts` varrendo `messages`) é o que mais dói e piora com o tempo. Sem isso, nada mais importa.
2. **Fase 3.1 + gráfico de assuntos persistido** — tirar a classificação do request quente e persistir.
3. Demais métricas, tags/anotações e polimento.

---

## Diferenças vs. roteiro genérico (por que esta versão muda coisas)

- **Sem WebSocket/Socket.io:** serverless na Vercel não comporta socket próprio; **Supabase Realtime já está integrado**.
- **Sem React/Recharts:** frontends são vanilla JS com **Chart.js já em uso**.
- **`conversation_id` não existe:** a conversa é o `wa_id`; o índice principal já existe.
- **Classificação de assunto já existe** (regex em `stats.ts`); a evolução é persistir em `conversation_topics` e, opcionalmente, usar o LLM já plugado.
- **Jobs assíncronos = Vercel Cron**, não fila/daemon in-process.
- **Mídia e tags exigem mudança de schema** — explicitados como incrementos opcionais, não como dado já existente.
