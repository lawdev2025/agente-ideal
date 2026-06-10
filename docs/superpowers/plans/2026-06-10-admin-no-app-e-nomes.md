# Admin no app mobile + nomes dos contatos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar o nome real do contato do WhatsApp no CRM e dar ao app mobile um drawer lateral que acessa o painel `/admin` (tornado responsivo) dentro do app instalado.

**Architecture:** Três frentes independentes. (A) backend: o webhook extrai `profile.name` e grava no contato. (B) `/admin` ganha layout responsivo (sidebar→drawer, grids empilham, tabela rola) e lê `location.hash` pra abrir abas. (C) `/app` ganha um drawer escuro cujos itens navegam pra `/admin#aba`; o escopo do PWA vira `/` pra abrir tudo dentro do app instalado.

**Tech Stack:** TypeScript (Vercel functions em `api/`, lógica em `src/`), Vitest (testes backend), HTML/CSS/JS vanilla nos front-ends (`public/app`, `public/admin`), PWA (service worker + manifest). Verificação de front-end por screenshot headless (Chrome).

**Spec:** `docs/superpowers/specs/2026-06-10-admin-no-app-e-nomes-design.md`

---

## Convenção de verificação de front-end

Tarefas de UI (B e C) não têm teste automatizado de DOM no projeto — a verificação é por screenshot headless. Helper de servidor estático (usado nos passos de verificação):

```bash
# inicia (uma vez por sessão de verificação)
cd "C:/Users/joaov/Desktop/Agente Ideal/public" && (python -m http.server 8799 >/tmp/srv.log 2>&1 &) ; sleep 2
# screenshot: $URL = caminho relativo (ex.: app/index.html), $OUT = arquivo .png em Desktop p/ Read
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=390,844 --virtual-time-budget=3000 --screenshot=/tmp/shot.png "http://localhost:8799/$URL" 2>/dev/null
cp /tmp/shot.png "C:/Users/joaov/Desktop/Agente Ideal/_v.png"   # depois: Read _v.png e, ao final, rm
# encerrar servidor ao final:
#   PowerShell: (Get-NetTCPConnection -LocalPort 8799 -State Listen).OwningProcess | % { Stop-Process -Id $_ -Force }
```

Ao final de B e C, **remover** quaisquer `_v*.png` e arquivos `_preview`/`_mock`/`_inject` temporários.

---

## Task 1: Parte A — nome do contato a partir do `profile.name` do webhook

**Files:**
- Create: `src/webhook/contacts.ts`
- Test: `tests/webhook-contacts.test.ts`
- Modify: `api/webhook.ts` (loop do formato Cloud API, ~linhas 117-152)

- [ ] **Step 1: Write the failing test**

`tests/webhook-contacts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildProfileNameMap } from "../src/webhook/contacts";

describe("buildProfileNameMap", () => {
  it("mapeia wa_id para profile.name", () => {
    const value = {
      contacts: [{ wa_id: "5511999990001", profile: { name: "Maria Souza" } }],
      messages: [],
    };
    expect(buildProfileNameMap(value)).toEqual({ "5511999990001": "Maria Souza" });
  });

  it("ignora contato sem nome", () => {
    const value = { contacts: [{ wa_id: "5511999990001", profile: {} }] };
    expect(buildProfileNameMap(value)).toEqual({});
  });

  it("faz trim no nome", () => {
    const value = { contacts: [{ wa_id: "1", profile: { name: "  João  " } }] };
    expect(buildProfileNameMap(value)).toEqual({ "1": "João" });
  });

  it("retorna objeto vazio quando não há contacts", () => {
    expect(buildProfileNameMap({})).toEqual({});
    expect(buildProfileNameMap(undefined)).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/webhook-contacts.test.ts`
Expected: FAIL — `Failed to resolve import "../src/webhook/contacts"` (módulo ainda não existe).

- [ ] **Step 3: Write minimal implementation**

`src/webhook/contacts.ts`:

```ts
/**
 * Monta o mapa `wa_id -> profile.name` a partir do `value` de um change do
 * webhook (formato WhatsApp Cloud API). Nomes vazios são ignorados.
 */
export function buildProfileNameMap(value: any): Record<string, string> {
  const map: Record<string, string> = {};
  const contacts = (value && value.contacts) || [];
  for (const c of contacts) {
    const waId = c && c.wa_id;
    const name = c && c.profile && c.profile.name;
    if (waId && typeof name === "string" && name.trim()) {
      map[waId] = name.trim();
    }
  }
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/webhook-contacts.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Wire no handler do webhook**

Em `api/webhook.ts`, adicionar o import junto aos outros (após a linha 6, `import { shouldProcessMessage } ...`):

```ts
import { buildProfileNameMap } from "../src/webhook/contacts";
```

No loop do formato Cloud API, computar o mapa por `change` e passar o nome ao criar o contato. Trocar o trecho atual:

```ts
        for (const change of entry.changes || []) {
          const messages = change.value?.messages || [];
          for (const msg of messages) {
```

por:

```ts
        for (const change of entry.changes || []) {
          const nameByWaId = buildProfileNameMap(change.value);
          const messages = change.value?.messages || [];
          for (const msg of messages) {
```

E trocar a criação do contato:

```ts
              await stateRepo.getOrCreateContact(senderId);
```

por:

```ts
              await stateRepo.getOrCreateContact(senderId, nameByWaId[senderId]);
```

(`getOrCreateContact(waId, name?)` já existe em `src/state/repository.ts:58` e só grava o nome quando o contato ainda não tem um.)

- [ ] **Step 6: Rodar a suíte e o typecheck**

Run: `npx vitest run tests/webhook-contacts.test.ts && npx tsc --noEmit`
Expected: testes PASS; `tsc` sem erros novos em `api/webhook.ts`/`src/webhook/contacts.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/webhook/contacts.ts tests/webhook-contacts.test.ts api/webhook.ts
git commit -m "feat(webhook): salva nome do WhatsApp (profile.name) no contato"
```

---

## Task 2: Parte B — `/admin` responsivo + leitura de `location.hash`

**Files:**
- Modify: `public/admin/index.html` (botão hambúrguer + overlay)
- Modify: `public/admin/admin.css` (bloco responsivo mobile)
- Modify: `public/admin/admin.js` (toggle do drawer + leitura de hash)

- [ ] **Step 1: Markup do hambúrguer + overlay**

Em `public/admin/index.html`, dentro de `<header class="content-header">`, ANTES de `<div class="header-title">`, inserir:

```html
                <button class="nav-toggle" id="nav-toggle-btn" aria-label="Abrir menu" title="Menu">
                    <i class="fa-solid fa-bars"></i>
                </button>
```

E logo após a abertura de `<div class="admin-container">` (antes de `<aside class="sidebar">`), inserir o overlay:

```html
        <div class="sidebar-overlay" id="sidebar-overlay" hidden></div>
```

- [ ] **Step 2: CSS responsivo**

Em `public/admin/admin.css`, ao FINAL do arquivo, adicionar:

```css
/* ==========================================================================
   RESPONSIVO MOBILE — sidebar vira drawer, grids empilham, tabela rola
   ========================================================================== */
.nav-toggle { display: none; }
.sidebar-overlay { display: none; }

@media (max-width: 768px) {
    /* Hambúrguer visível no header */
    .nav-toggle {
        display: inline-flex; align-items: center; justify-content: center;
        width: 40px; height: 40px; margin-right: 12px; flex-shrink: 0;
        border: none; border-radius: 11px; cursor: pointer;
        background: var(--bg-secondary); color: var(--text-primary);
        font-size: 18px;
    }

    /* Sidebar off-canvas */
    .sidebar {
        position: fixed; top: 0; left: 0; bottom: 0; z-index: 60;
        transform: translateX(-100%);
        transition: transform .28s cubic-bezier(.4,0,.2,1);
        box-shadow: 0 0 40px rgba(0,0,0,.5);
    }
    .admin-container.nav-open .sidebar { transform: translateX(0); }

    .sidebar-overlay {
        display: block; position: fixed; inset: 0; z-index: 50;
        background: rgba(0,0,0,.5); opacity: 0; pointer-events: none;
        transition: opacity .28s ease;
    }
    .admin-container.nav-open .sidebar-overlay { opacity: 1; pointer-events: auto; }

    /* Header e conteúdo */
    .content-header { padding: 0 16px; height: 64px; }
    .header-title h1 { font-size: 18px; }
    .header-title p { display: none; }
    .tab-container { padding: 16px; }

    /* Grids empilham */
    .metrics-grid { grid-template-columns: 1fr; gap: 12px; }
    .charts-grid { grid-template-columns: 1fr; }
    .config-grid { grid-template-columns: 1fr !important; }

    /* Conversas: lista OU chat ocupando a largura toda */
    .conversations-wrapper { flex-direction: column; height: calc(100vh - 96px); }
    .contacts-sidebar { width: 100%; }

    /* Gerenciar Banco: tabela com scroll horizontal */
    .database-table-container { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    .db-table { min-width: 720px; }
    .database-nav { flex-direction: column; align-items: stretch; gap: 12px; }
    .db-action-btns { display: flex; gap: 8px; }
    .db-action-btns .btn { flex: 1; }

    /* Modais quase full-width */
    .modal-card { width: calc(100vw - 24px); max-width: none; }
}
```

- [ ] **Step 3: JS do drawer + leitura de hash**

Em `public/admin/admin.js`, dentro do bloco de inicialização que registra os listeners (mesmo escopo onde está o listener do `theme-toggle-btn`, ~linha 209), adicionar:

```js
    // Drawer mobile: hambúrguer abre, overlay/click em item fecha.
    const navToggle = document.getElementById('nav-toggle-btn');
    const navOverlay = document.getElementById('sidebar-overlay');
    const adminContainer = document.querySelector('.admin-container');
    function closeNav() { if (adminContainer) adminContainer.classList.remove('nav-open'); }
    if (navToggle && adminContainer) {
        navToggle.addEventListener('click', function () { adminContainer.classList.toggle('nav-open'); });
    }
    if (navOverlay) navOverlay.addEventListener('click', closeNav);
    document.querySelectorAll('.sidebar-menu li').forEach(function (li) {
        li.addEventListener('click', closeNav);
    });

    // Abre a aba a partir do #hash (ex.: /admin#config vindo do drawer do app).
    function tabFromHash() {
        const h = (location.hash || '').replace('#', '');
        if (['dashboard', 'conversas', 'banco', 'config'].indexOf(h) !== -1) {
            activateTab(h);
        }
    }
    window.addEventListener('hashchange', tabFromHash);
    tabFromHash();
```

> Nota: garanta que `tabFromHash()` rode DEPOIS de `activateTab` estar definida e dos elementos existirem (colocar no fim do init). Se houver erro de referência, mover as 3 últimas linhas pro final do handler de `DOMContentLoaded`.

- [ ] **Step 4: Verificar (screenshots mobile)**

Iniciar o servidor estático (ver topo). Capturar dashboard mobile e o drawer aberto:

```bash
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
"$CHROME" --headless=new --disable-gpu --window-size=390,844 --virtual-time-budget=3000 --screenshot=/tmp/a1.png "http://localhost:8799/admin/index.html" 2>/dev/null
cp /tmp/a1.png "C:/Users/joaov/Desktop/Agente Ideal/_v-adm-mobile.png"
"$CHROME" --headless=new --disable-gpu --window-size=390,844 --virtual-time-budget=3000 --screenshot=/tmp/a2.png "http://localhost:8799/admin/index.html#config" 2>/dev/null
cp /tmp/a2.png "C:/Users/joaov/Desktop/Agente Ideal/_v-adm-config.png"
```

Read `_v-adm-mobile.png`: hambúrguer visível, KPIs empilhados em 1 coluna, sidebar escondida.
Read `_v-adm-config.png`: aba **Configurações** ativa (veio do hash).
Para o drawer aberto, criar `public/admin/_preview.html` injetando `<script>document.querySelector('.admin-container').classList.add('nav-open')</script>` antes de `</body>` e capturar; conferir sidebar sobreposta + overlay. Remover `_preview.html` e os `_v-*.png` depois.

Expected: layout não quebra, drawer abre/fecha, hash ativa a aba.

- [ ] **Step 5: Commit**

```bash
git add public/admin/index.html public/admin/admin.css public/admin/admin.js
git commit -m "feat(admin): layout responsivo (drawer mobile) + abre aba via location.hash"
```

---

## Task 3: Parte C — drawer no app + escopo do PWA + ligação com o admin

**Files:**
- Modify: `public/app/index.html` (botão menu + markup do drawer + overlay)
- Modify: `public/app/app.css` (estilo do drawer escuro + overlay)
- Modify: `public/app/app.js` (abrir/fechar drawer)
- Modify: `public/app/manifest.webmanifest` (`scope` → `/`)
- Modify: `public/app/sw.js` (bump de cache v8 → v9)

- [ ] **Step 1: Botão menu no header da lista**

Em `public/app/index.html`, dentro de `<div class="head-actions">` da seção `#screen-list`, como PRIMEIRO botão (antes do `#notif-btn`), inserir:

```html
            <button id="menu-btn" class="head-round tap" aria-label="Menu" title="Menu">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>
            </button>
```

- [ ] **Step 2: Markup do drawer + overlay**

Em `public/app/index.html`, logo após `<div id="ideal-root" class="ideal light">`, inserir:

```html
  <!-- ============ DRAWER LATERAL (acessa o admin) ============ -->
  <aside id="app-drawer" class="app-drawer">
    <div class="drawer-brand">
      <span class="drawer-badge">id</span>
      <div><b>ideal</b><small>CRM</small></div>
    </div>
    <nav class="drawer-nav">
      <button class="drawer-item active" id="drawer-conversas">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M4 4h16v12H7l-3 3z"></path></svg> Conversas
      </button>
      <a class="drawer-item" href="/admin#dashboard">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3 13h8V3H3zM13 21h8V3h-8zM3 21h8v-6H3z"></path></svg> Dashboard
      </a>
      <a class="drawer-item" href="/admin#banco">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><ellipse cx="12" cy="6" rx="8" ry="3"></ellipse><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"></path></svg> Gerenciar Banco
      </a>
      <a class="drawer-item" href="/admin#config">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9 4l-2 1 1 2-2 2-2-1-1 2h-2l-1-2-2 1-2-2 1-2-2-1v-2l2-1-1-2 2-2 2 1 1-2h2l1 2 2-1 2 2-1 2z"></path></svg> Configurações
      </a>
    </nav>
    <div class="drawer-foot">
      <span class="drawer-avatar">A</span>
      <div><b>Time Ideal</b><small>online</small></div>
      <span class="drawer-online"></span>
    </div>
  </aside>
  <div id="drawer-overlay" class="drawer-overlay"></div>
```

- [ ] **Step 3: CSS do drawer**

Em `public/app/app.css`, ao FINAL do arquivo, adicionar:

```css
/* ---------------- DRAWER LATERAL (estética do admin) ---------------- */
.app-drawer {
  position: fixed; top: 0; left: 0; bottom: 0; z-index: 70; width: 264px;
  background: #221518; color: #CBB9BA; padding: 22px 14px;
  display: flex; flex-direction: column; gap: 4px;
  transform: translateX(-100%);
  transition: transform .28s cubic-bezier(.4,0,.2,1);
}
.app-drawer.open { transform: translateX(0); }
.ideal.dark .app-drawer { background: #1B1314; }

.drawer-brand { display: flex; align-items: center; gap: 10px; padding: 4px 10px 18px; }
.drawer-badge {
  width: 34px; height: 34px; border-radius: 11px; flex-shrink: 0;
  background: linear-gradient(150deg, #E03C49, #A31621);
  display: flex; align-items: center; justify-content: center;
  color: #fff; font: 700 16px 'Quicksand', sans-serif;
}
.drawer-brand b { font: 700 16px 'Quicksand', sans-serif; color: #fff; }
.drawer-brand small { display: block; font: 600 10px 'Quicksand', sans-serif; color: #9B8385; letter-spacing: 1.2px; }

.drawer-nav { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
.drawer-item {
  display: flex; align-items: center; gap: 11px; width: 100%;
  padding: 12px 12px; border-radius: 11px; border: none; cursor: pointer;
  background: transparent; color: #CBB9BA; text-decoration: none;
  font: 600 14px 'Quicksand', sans-serif; text-align: left;
}
.drawer-item.active { background: rgba(224, 60, 73, .18); color: #FF8A91; }

.drawer-foot {
  margin-top: auto; padding: 12px 10px 4px; border-top: 1px solid rgba(255,255,255,.08);
  display: flex; align-items: center; gap: 9px; font: 600 12px 'Quicksand', sans-serif;
}
.drawer-avatar {
  width: 30px; height: 30px; border-radius: 50%; background: var(--brand);
  color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700;
}
.drawer-foot small { display: block; color: #9B8385; font-size: 10.5px; }
.drawer-online { margin-left: auto; width: 9px; height: 9px; border-radius: 50%; background: #3DBF77; }

.drawer-overlay {
  position: fixed; inset: 0; z-index: 60; background: rgba(0,0,0,.45);
  opacity: 0; pointer-events: none; transition: opacity .28s ease;
}
.drawer-overlay.show { opacity: 1; pointer-events: auto; }
```

- [ ] **Step 4: JS abrir/fechar**

Em `public/app/app.js`, na seção `// ---------------- LISTENERS ----------------`, após o listener do `theme-btn` (`$("theme-btn").addEventListener(...)`), adicionar:

```js
  // Drawer lateral
  const drawer = $("app-drawer");
  const drawerOverlay = $("drawer-overlay");
  function openDrawer() { drawer.classList.add("open"); drawerOverlay.classList.add("show"); }
  function closeDrawer() { drawer.classList.remove("open"); drawerOverlay.classList.remove("show"); }
  $("menu-btn").addEventListener("click", openDrawer);
  drawerOverlay.addEventListener("click", closeDrawer);
  $("drawer-conversas").addEventListener("click", closeDrawer);
```

- [ ] **Step 5: Escopo do PWA**

Em `public/app/manifest.webmanifest`, trocar:

```json
  "scope": "/app/",
```

por:

```json
  "scope": "/",
```

(`start_url` continua `/app/`.)

- [ ] **Step 6: Bump do cache do SW**

Em `public/app/sw.js`, trocar:

```js
const CACHE = "crm-ideal-v8";
```

por:

```js
const CACHE = "crm-ideal-v9";
```

- [ ] **Step 7: Sanity check de sintaxe**

Run: `node --check public/app/app.js && node --check public/app/sw.js`
Expected: sem erros.

- [ ] **Step 8: Verificar (screenshot do drawer aberto)**

Servidor estático no ar. Criar `public/app/_preview.html` a partir do `index.html` injetando, antes de `</body>`, `<script>window.addEventListener('load',()=>setTimeout(()=>{document.getElementById('app-drawer').classList.add('open');document.getElementById('drawer-overlay').classList.add('show');},300))</script>` e capturar:

```bash
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
"$CHROME" --headless=new --disable-gpu --window-size=390,844 --virtual-time-budget=3000 --screenshot=/tmp/c1.png "http://localhost:8799/app/_preview.html" 2>/dev/null
cp /tmp/c1.png "C:/Users/joaov/Desktop/Agente Ideal/_v-app-drawer.png"
```

Read `_v-app-drawer.png`: drawer escuro com badge "id", itens Conversas (ativo)/Dashboard/Gerenciar Banco/Configurações, rodapé com bolinha verde, overlay sobre o conteúdo. Remover `_preview.html` e `_v-*.png` depois. Parar o servidor.

- [ ] **Step 9: Commit**

```bash
git add public/app/index.html public/app/app.css public/app/app.js public/app/manifest.webmanifest public/app/sw.js
git commit -m "feat(app): drawer lateral que acessa o admin + escopo do PWA em /"
```

---

## Task 4: Deploy

- [ ] **Step 1: Push para produção (Vercel usa `main`)**

```bash
git push origin master:main
```

- [ ] **Step 2: Confirmar deploy servindo o novo**

```bash
curl -s "https://agente-ideal.vercel.app/app/manifest.webmanifest?cb=$(date +%s)" | grep scope
curl -s "https://agente-ideal.vercel.app/app/sw.js?cb=$(date +%s)" | grep "CACHE ="
```

Expected: `"scope": "/"` e `CACHE = "crm-ideal-v9"`.

- [ ] **Step 3: Instruir reinstalar o PWA** (ícone/escopo só atualizam ao reinstalar).

---

## Self-Review (preenchido)

**Spec coverage:**
- Parte A (nomes) → Task 1. ✓
- Parte B (admin responsivo + hash) → Task 2. ✓
- Parte C (drawer app + escopo + SW) → Task 3. ✓
- Deploy/produção → Task 4. ✓
- Fotos de perfil → fora de escopo (spec), nenhuma task — correto.

**Placeholder scan:** sem TBD/TODO; todo passo tem código/comando concreto. ✓

**Type/idmatch consistency:** `buildProfileNameMap` usado igual no teste e no handler; `getOrCreateContact(waId, name?)` confere com `src/state/repository.ts:58`; ids do DOM (`menu-btn`, `app-drawer`, `drawer-overlay`, `drawer-conversas`, `nav-toggle-btn`, `sidebar-overlay`) batem entre HTML, CSS e JS; `activateTab` e os hashes `dashboard|conversas|banco|config` conferem com as abas existentes do admin. ✓
