# Design — Admin completo no app mobile + nomes dos contatos

Data: 2026-06-10
Status: aprovado (brainstorming)

## Contexto

O CRM IDEAL tem dois front-ends que compartilham o mesmo backend (Supabase + `/api`):

- **`/app`** — PWA mobile instalável, focado em atendimento (login, lista de conversas com swipe, chat). Fonte: `public/app/`.
- **`/admin`** — painel desktop completo: Dashboard (KPIs + 2 gráficos Chart.js), Conversas, Gerenciar Banco (tabelas + CSV + edição) e Configurações (chaves de API). Fonte: `public/admin/`.

O usuário pediu três coisas em cima do app instalado:

1. **Fotos de perfil dos contatos do WhatsApp.**
2. **Aba lateral (drawer) no app** com acesso a Dashboard, Configurações etc. — "igual a do painel principal".
3. **Nome do contato** no atendimento (hoje aparece o número, ex.: `559193898000`).

## Decisões de escopo

### Fotos de perfil — FORA DE ESCOPO (limitação da plataforma)
A **WhatsApp Cloud API (oficial, Meta)** não expõe a foto de perfil de clientes. O webhook entrega apenas `wa_id` (número) e `profile.name` (nome de exibição). Não há endpoint para baixar a foto — é restrição de privacidade da Meta. APIs não-oficiais conseguem, mas implicam risco de banimento, que o projeto evita por design (ver `PLANO-AUXILIAR.md`). Mantemos os **avatares de iniciais** — que passam a mostrar iniciais reais assim que a Parte A entra.

### Drawer no app — Abordagem escolhida: "1" (admin responsivo + drawer aponta pra ele)
Avaliadas três abordagens:

1. **(ESCOLHIDA) Tornar `/admin` responsivo e o drawer do app navegar para suas abas.** Reaproveita 100% da lógica existente (Dashboard/Banco/Config já funcionam), zero reimplementação, uma fonte de verdade, baixo risco. Custo: ao tocar num item do drawer há troca de página `/app → /admin` (não é um SPA único).
2. Recriar cada aba como tela nativa no `app.js` — esforço enorme, duplica `admin.js`, alto risco. Rejeitada.
3. Fundir app + admin num único PWA responsivo — maior refactor, mexe em tudo. Rejeitada (futuro).

## Arquitetura da solução

Três frentes independentes, implementáveis e testáveis em separado.

### Parte A — Nome do contato a partir do WhatsApp (backend)

**Arquivos:** `api/webhook.ts` (e formato legado Messenger, se aplicável).

`getOrCreateContact(waId, name?)` **já existe** e aceita nome (`src/state/repository.ts:58`), gravando o nome apenas quando o contato ainda não tem um (`if (name && !existing.name)`).

Mudança: no loop do webhook (formato Cloud API), montar um mapa `wa_id → profile.name` a partir de `change.value.contacts[]` e, ao processar cada mensagem, chamar `getOrCreateContact(senderId, nameMap[senderId])`.

```
const contactsArr = change.value?.contacts || [];
const nameByWaId = {};
for (const c of contactsArr) if (c?.wa_id) nameByWaId[c.wa_id] = c?.profile?.name || null;
// ...
await stateRepo.getOrCreateContact(senderId, nameByWaId[senderId] || undefined);
```

**Efeito:**
- Lista (`app.js` `displayName = name || wa_id`), header do chat e iniciais do avatar passam a usar o nome real — sem mudança no front.
- O painel `/admin` (que também usa `name`) idem.

**Consequência aceita:** com `name` preenchido na 1ª mensagem, a captura conversacional do orquestrador (`src/worker/orchestrator.ts:178`, `if (!contact.name) … "como posso te chamar?"`) deixa de disparar. É o comportamento desejado (menos atrito). Caso se queira manter o bot perguntando, a alternativa seria um campo separado (`wa_name`) com prioridade `name > wa_name > wa_id` — **não** adotada agora.

**Sem migração de schema.** Coluna `name` já existe.

### Parte B — `/admin` responsivo

**Arquivos:** `public/admin/admin.css` (media queries), `public/admin/admin.js` (toggle do drawer + leitura de hash), `public/admin/index.html` (botão hambúrguer + overlay).

No breakpoint mobile (≤ ~768px, reutilizando os `@media` já existentes em `admin.css`):

- **Sidebar → drawer off-canvas:** escondida via `transform: translateX(-100%)`, aberta por um botão **hambúrguer** no header; **overlay** escurece o conteúdo e fecha ao toque. Estado controlado por classe no `.admin-container` (ex.: `.nav-open`), com toggle em `admin.js`.
- **Grids empilham:** `.metrics-grid` e `.config-grid` → 1 coluna; `.charts-grid` já cai pra 1 coluna em 900px.
- **Gerenciar Banco:** `.database-table-container` com `overflow-x: auto`; barra de navegação de tabelas com wrap/scroll.
- **Conversas:** alterna lista⇄chat numa coluna (o botão voltar `#btn-chat-back` já existe); a lista ocupa a largura total e, ao abrir um contato, mostra o chat.
- **Modais** (CSV, add/editar): quase full-width com margens pequenas.

### Parte C — Drawer no app + ligação com o admin

**Arquivos:** `public/app/index.html` (markup do drawer + botão menu), `public/app/app.css` (estilo do drawer/overlay), `public/app/app.js` (toggle), `public/app/manifest.webmanifest` (escopo), `public/app/sw.js` (cache + shell), `public/admin/admin.js` (leitura de hash).

- **Botão menu (hambúrguer)** no header vermelho (`red-head`) da lista, junto dos botões redondos existentes.
- **Drawer** desliza da esquerda com overlay; **estética escura igual à do admin** (`.adm-side`: fundo `#221518`, badge "id", "ideal CRM"). Itens:
  - **Conversas** — fecha o drawer (home atual do app).
  - **Dashboard** → `/admin#dashboard`
  - **Gerenciar Banco** → `/admin#banco`
  - **Configurações** → `/admin#config`
  - Rodapé com usuário (e, opcionalmente, atalho de tema).
- **`admin.js` lê `location.hash` no load** e chama `activateTab(hash)` para abrir a aba certa (hoje não lê hash).
- **`manifest.webmanifest`:** `scope` de `/app/` → `/` (mantendo `start_url: /app/`) para que `/admin` abra **dentro do app instalado**; `theme_color`/ícones inalterados.
- **`sw.js`:** bump de cache (v8 → v9) porque `index.html`/`app.css`/`manifest` mudam. O SW continua interceptando só `/app`; `/admin` carrega da rede (já tem `must-revalidate`).

## Fluxo de dados

- Webhook recebe mensagem → extrai `profile.name` → `getOrCreateContact` grava `name` → Supabase → Realtime/refresh atualizam app e admin.
- Drawer do app → navegação para `/admin#aba` → `admin.js` ativa a aba via hash → admin (responsivo) renderiza no app instalado (escopo `/`).

## Erros e bordas

- Webhook sem `contacts[]` (ex.: formato legado/edge): `nameByWaId[senderId]` fica `undefined` → `getOrCreateContact` mantém comportamento atual (sem nome). Não quebra.
- `profile.name` vazio/emoji: salvo como veio; `displayName` cai pro número se `name` for falsy.
- Hash inválido em `/admin`: `activateTab` faz fallback pra `dashboard`.
- Drawer e gestos: o toggle do drawer não pode conflitar com o swipe dos cards (o botão menu fica no header, fora da área de swipe).

## Verificação

- **A (nomes):** payload de webhook simulado com `contacts[0].profile.name` → contato criado com `name`; conferir lista/header/iniciais. Os testes de handoff existentes não devem regredir.
- **B (admin responsivo):** screenshots headless em viewport mobile (≈390×844) de Dashboard, Conversas, Banco e Config, claro e escuro — drawer abre/fecha, grids empilham, tabela rola.
- **C (drawer app):** screenshot do app com drawer aberto; conferir navegação `/app → /admin#config` abrindo a aba certa; `manifest` com `scope:"/"`; cache do SW bumpado.

## Fora de escopo (explícito)

- Fotos de perfil de clientes.
- Fusão app+admin num único SPA.
- Campo separado `wa_name` / bot continuar perguntando o nome.
