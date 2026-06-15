# Gerenciar Banco — Visual Redesign + Fix Gráfico de Rosca

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesenhar visualmente a aba "Gerenciar Banco" para organizar por propósito (não por tabela), adicionar seção de aprendizado do bot (`intent_learning`), e corrigir o gráfico de rosca que desaparece da tela.

**Architecture:** Três arquivos afetados, zero regressão funcional. HTML reestrutura o `#tab-banco` em dois painéis semânticos. CSS adiciona estilos sem sobrescrever nenhum existente. JS adiciona `loadIntentLearning()` como função nova e ajusta uma constante de posição do Chart.js.

**Tech Stack:** HTML puro, CSS custom properties (já existentes no projeto), Chart.js (CDN já carregado), Supabase JS SDK (CDN já carregado).

---

## Arquivos

| Arquivo | Mudança |
|---|---|
| `public/admin/index.html` | Reestrutura `#tab-banco`: headings, labels renomeados, `#banco-learning` adicionado |
| `public/admin/admin.css` | Adiciona `.banco-section`, `.banco-section-title`, `.learning-strip`, `.learning-stat`, `.intent-badge` e corrige `.charts-grid` |
| `public/admin/admin.js` | Adiciona `loadIntentLearning()`; chama-a em `activateTab('banco')`; muda `position` do donut para `'bottom'` |

---

## Task 1: Fix do gráfico de rosca

**Files:**
- Modify: `public/admin/admin.css` (selector `.charts-grid`)
- Modify: `public/admin/admin.js` (~linha 642, constante `narrowChart` e position)

- [ ] **Step 1: Localizar e corrigir o grid no CSS**

Em `public/admin/admin.css`, localizar:
```css
.charts-grid {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 20px;
}
```
Alterar para:
```css
.charts-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
}
```

- [ ] **Step 2: Localizar e corrigir a posição da legenda do donut no JS**

Em `public/admin/admin.js`, localizar (em torno da linha 642):
```javascript
const narrowChart = window.matchMedia('(max-width: 700px)').matches;
```
E depois (em torno da linha 664):
```javascript
position: narrowChart ? 'bottom' : 'right',
```
Substituir as duas linhas: remover a `const narrowChart` e mudar a position para:
```javascript
position: 'bottom',
```

- [ ] **Step 3: Ajustar altura do chart-wrapper do card do donut**

Ainda no CSS, localizar:
```css
.chart-wrapper {
    position: relative;
    height: 320px;
    width: 100%;
}
```
Adicionar abaixo dessa regra (nova regra, não altera a existente):
```css
/* donut com legenda embaixo precisa de menos altura vertical */
.chart-card:last-child .chart-wrapper {
    height: 260px;
}
```

- [ ] **Step 4: Verificar manualmente**

Abrir o painel no browser → aba Dashboard → confirmar:
- O donut aparece centralizado no card
- A legenda está embaixo do donut
- Os dois cards de gráfico têm largura igual
- Em mobile (< 900px) ainda colapsa para coluna única (regra existente mantém)

- [ ] **Step 5: Commit**

```bash
git add public/admin/admin.css public/admin/admin.js
git commit -m "fix(dashboard): gráfico de rosca visível — legenda embaixo, grid 1fr 1fr"
```

---

## Task 2: Reestruturar HTML do painel A ("O que a escola ensina")

**Files:**
- Modify: `public/admin/index.html` (section `#tab-banco`)

- [ ] **Step 1: Adicionar heading da seção A e renomear labels dos botões**

Localizar dentro de `#tab-banco > .database-wrapper > .database-nav > .table-selector-scroll` o seguinte bloco e substituir **só os textos visíveis** (os atributos `data-table` NÃO mudam):

```html
<!-- ANTES -->
<div class="table-selector-group">
    <span class="table-group-label">Produtos & Turmas</span>
    <button class="btn btn-db-nav active" data-table="school_products">
        <i class="fa-solid fa-tags"></i> Produtos
    </button>
    <button class="btn btn-db-nav" data-table="school_levels">
        <i class="fa-solid fa-layer-group"></i> Níveis
    </button>
    <button class="btn btn-db-nav" data-table="school_materials">
        <i class="fa-solid fa-book"></i> Materiais
    </button>
</div>
<div class="table-selector-divider"></div>
<div class="table-selector-group">
    <span class="table-group-label">Estrutura</span>
    <button class="btn btn-db-nav" data-table="school_units">
        <i class="fa-solid fa-building-columns"></i> Unidades
    </button>
    <button class="btn btn-db-nav" data-table="school_contacts">
        <i class="fa-solid fa-address-book"></i> Contatos
    </button>
</div>
<div class="table-selector-divider"></div>
<div class="table-selector-group">
    <span class="table-group-label">Bot</span>
    <button class="btn btn-db-nav" data-table="school_faq">
        <i class="fa-solid fa-comment-dots"></i> Respostas Diretas
    </button>
</div>
```

```html
<!-- DEPOIS -->
<div class="table-selector-group">
    <span class="table-group-label">Turmas & Valores</span>
    <button class="btn btn-db-nav active" data-table="school_products">
        <i class="fa-solid fa-graduation-cap"></i> Turmas
    </button>
    <button class="btn btn-db-nav" data-table="school_levels">
        <i class="fa-solid fa-layer-group"></i> Níveis & Preços
    </button>
    <button class="btn btn-db-nav" data-table="school_materials">
        <i class="fa-solid fa-book-open"></i> Materiais
    </button>
</div>
<div class="table-selector-divider"></div>
<div class="table-selector-group">
    <span class="table-group-label">A Escola</span>
    <button class="btn btn-db-nav" data-table="school_units">
        <i class="fa-solid fa-building-columns"></i> Unidades
    </button>
    <button class="btn btn-db-nav" data-table="school_contacts">
        <i class="fa-solid fa-headset"></i> Secretaria
    </button>
</div>
<div class="table-selector-divider"></div>
<div class="table-selector-group">
    <span class="table-group-label">Respostas do Bot</span>
    <button class="btn btn-db-nav" data-table="school_faq">
        <i class="fa-solid fa-comment-dots"></i> FAQ do Bot
    </button>
</div>
```

- [ ] **Step 2: Adicionar heading visual acima da `.database-nav`**

Localizar a abertura de `#tab-banco`:
```html
<section class="tab-content" id="tab-banco">
    <div class="database-wrapper glass">
        <div class="database-nav">
```

Inserir um `<div class="banco-section-title">` entre `.database-wrapper` e `.database-nav`:
```html
<section class="tab-content" id="tab-banco">
    <div class="database-wrapper glass">
        <div class="banco-section-title">
            <span><i class="fa-solid fa-school"></i> O que a escola ensina ao bot</span>
        </div>
        <div class="database-nav">
```

- [ ] **Step 3: Verificar manualmente**

Abrir aba "Gerenciar Banco" → confirmar:
- Heading "O que a escola ensina ao bot" aparece acima dos botões
- Labels dos botões mudaram (Turmas, Secretaria, FAQ do Bot)
- Clicar em cada botão ainda carrega a tabela correta (lógica inalterada)

- [ ] **Step 4: Commit**

```bash
git add public/admin/index.html
git commit -m "feat(banco): heading semântico + labels de botões renomeados"
```

---

## Task 3: Adicionar seção HTML do painel B ("O que o bot aprendeu")

**Files:**
- Modify: `public/admin/index.html` (ao final de `#tab-banco`, antes de `</section>`)

- [ ] **Step 1: Adicionar o bloco HTML da seção de aprendizado**

Localizar o fechamento de `#tab-banco`:
```html
        </div><!-- fecha .database-wrapper -->
    </section><!-- fecha #tab-banco -->
```

Inserir **antes** do `</section>`:
```html
        <!-- PAINEL B: O que o bot aprendeu (intent_learning) -->
        <div class="database-wrapper glass banco-learning-wrapper" id="banco-learning" style="display:none;">
            <div class="banco-section-title">
                <span><i class="fa-solid fa-brain"></i> O que o bot aprendeu</span>
                <small>Intenções acumuladas automaticamente nas conversas</small>
            </div>

            <!-- Mini-cards de resumo -->
            <div class="learning-strip" id="learning-strip">
                <div class="learning-stat">
                    <span class="learning-stat-value" id="learn-active-count">—</span>
                    <span class="learning-stat-label">ativas</span>
                </div>
                <div class="learning-stat">
                    <span class="learning-stat-value" id="learn-candidate-count">—</span>
                    <span class="learning-stat-label">candidatas</span>
                </div>
                <div class="learning-stat">
                    <span class="learning-stat-value" id="learn-cache-hits">—</span>
                    <span class="learning-stat-label">acertos de cache</span>
                </div>
            </div>

            <!-- Tabela de intenções -->
            <div class="database-table-container">
                <table class="db-table" id="learning-table">
                    <thead>
                        <tr>
                            <th>Intenção</th>
                            <th>Tipo</th>
                            <th>Acertos</th>
                            <th>Taxa de sucesso</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody id="learning-table-body">
                        <tr><td colspan="5" class="loading-spinner">Carregando...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
```

- [ ] **Step 2: Verificar que o bloco não aparece antes do JS estar pronto**

O `style="display:none"` garante que a seção fica oculta até o JS decidir mostrá-la. Confirmar visualmente que não aparece nada extra ao abrir a aba ainda.

- [ ] **Step 3: Commit**

```bash
git add public/admin/index.html
git commit -m "feat(banco): adiciona bloco HTML da seção de aprendizado do bot"
```

---

## Task 4: Adicionar CSS dos novos componentes

**Files:**
- Modify: `public/admin/admin.css` (adicionar ao final, antes do último bloco de media queries)

- [ ] **Step 1: Adicionar estilos ao final do arquivo**

Localizar o comentário de responsividade global:
```css
/* ==========================================================================
   RESPONSIVIDADE GLOBAL (MÉDIA QUERIES - PREMIUM FLUIDITY)
```

Inserir **antes** desse bloco:
```css
/* ==========================================================================
   ABA BANCO — REDESIGN VISUAL
   ========================================================================== */

.banco-section-title {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 18px 24px 12px;
    border-bottom: 1px solid var(--border-color);
}

.banco-section-title span {
    font-family: 'Quicksand', sans-serif;
    font-size: 14px;
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    display: flex;
    align-items: center;
    gap: 8px;
}

.banco-section-title span i {
    color: var(--brand-color);
    font-size: 13px;
}

.banco-section-title small {
    font-size: 12px;
    color: var(--text-muted);
}

.banco-learning-wrapper {
    margin-top: 20px;
}

/* Strip de mini-métricas do aprendizado */
.learning-strip {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--border-color);
}

.learning-stat {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 16px 12px;
    border-right: 1px solid var(--border-color);
}

.learning-stat:last-child {
    border-right: none;
}

.learning-stat-value {
    font-family: 'Quicksand', sans-serif;
    font-size: 26px;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1;
}

.learning-stat-label {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

/* Badges de status na tabela de intenções */
.intent-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
}

.intent-badge.active {
    background: rgba(31, 157, 85, 0.12);
    color: var(--accent-green);
}

.intent-badge.candidate {
    background: rgba(199, 123, 20, 0.12);
    color: var(--accent-gold);
}

/* Taxa de sucesso como barra inline */
.success-bar-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
}

.success-bar {
    flex: 1;
    height: 5px;
    background: var(--border-color);
    border-radius: 4px;
    overflow: hidden;
    min-width: 48px;
}

.success-bar-fill {
    height: 100%;
    background: var(--accent-green);
    border-radius: 4px;
    transition: width 0.4s ease;
}

.success-pct {
    font-size: 11px;
    color: var(--text-muted);
    min-width: 32px;
    text-align: right;
}
```

- [ ] **Step 2: Verificar visualmente**

Abrir a aba "Gerenciar Banco" após JS estar pronto (Task 5) e confirmar o visual.

- [ ] **Step 3: Commit**

```bash
git add public/admin/admin.css
git commit -m "feat(banco): estilos do redesign — section title, learning strip, intent badges"
```

---

## Task 5: Adicionar JS — `loadIntentLearning()` e integração

**Files:**
- Modify: `public/admin/admin.js`

- [ ] **Step 1: Adicionar a função `loadIntentLearning()`**

Localizar o comentário `// 7. BANCO DE DADOS — apenas dados reais` e inserir a função nova **antes** dele:

```javascript
// 6b. APRENDIZADO DO BOT — lê intent_learning (read-only, aditivo)
async function loadIntentLearning() {
    const wrapper = document.getElementById('banco-learning');
    if (!wrapper || !_sb) return;

    try {
        const { data, error } = await _sb
            .from('intent_learning')
            .select('canonical_key, intent_kind, cache_hits, positive_outcomes, negative_outcomes, status')
            .order('cache_hits', { ascending: false })
            .limit(50);

        if (error || !data || data.length === 0) {
            wrapper.style.display = 'none';
            return;
        }

        wrapper.style.display = 'block';

        const active    = data.filter(r => r.status === 'active').length;
        const candidate = data.filter(r => r.status === 'candidate').length;
        const totalHits = data.reduce((s, r) => s + (r.cache_hits || 0), 0);

        document.getElementById('learn-active-count').textContent    = active;
        document.getElementById('learn-candidate-count').textContent = candidate;
        document.getElementById('learn-cache-hits').textContent      = totalHits;

        const tbody = document.getElementById('learning-table-body');
        tbody.innerHTML = '';
        data.forEach(r => {
            const total   = (r.positive_outcomes || 0) + (r.negative_outcomes || 0);
            const pct     = total > 0 ? Math.round((r.positive_outcomes / total) * 100) : null;
            const pctText = pct !== null ? `${pct}%` : '—';
            const barFill = pct !== null ? `style="width:${pct}%"` : '';
            const isActive = r.status === 'active';
            const badge = isActive
                ? '<span class="intent-badge active"><i class="fa-solid fa-circle-check"></i> ativa</span>'
                : '<span class="intent-badge candidate"><i class="fa-solid fa-clock"></i> candidata</span>';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><code style="font-size:12px">${escapeHtml(r.canonical_key || '')}</code></td>
                <td>${escapeHtml(r.intent_kind || '—')}</td>
                <td>${r.cache_hits || 0}</td>
                <td>
                    <div class="success-bar-wrap">
                        <div class="success-bar"><div class="success-bar-fill" ${barFill}></div></div>
                        <span class="success-pct">${pctText}</span>
                    </div>
                </td>
                <td>${badge}</td>`;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.warn('intent_learning indisponível (migração pode não ter rodado):', e);
        const wrapper2 = document.getElementById('banco-learning');
        if (wrapper2) wrapper2.style.display = 'none';
    }
}
```

- [ ] **Step 2: Chamar `loadIntentLearning()` ao entrar na aba banco**

Localizar em `activateTab()`:
```javascript
if (tab === 'banco') return loadDatabaseTable();
```
Substituir por:
```javascript
if (tab === 'banco') { loadDatabaseTable(); loadIntentLearning(); return; }
```

- [ ] **Step 3: Verificar manualmente — cenário com Supabase conectado**

Abrir aba "Gerenciar Banco":
- Se `intent_learning` tiver dados: painel B aparece com contagens e tabela preenchida
- Se `intent_learning` não existir ou estiver vazia: painel B permanece oculto
- Clicar em diferentes botões de tabela não faz o painel B sumir (só recarrega a tabela A)

- [ ] **Step 4: Verificar cenário sem Supabase**

Abrir painel sem credenciais configuradas → painel B não aparece, sem erro no console.

- [ ] **Step 5: Commit**

```bash
git add public/admin/admin.js
git commit -m "feat(banco): loadIntentLearning — seção de aprendizado do bot integrada"
```

---

## Task 6: Verificação final de regressão

- [ ] **Step 1: Testar aba Dashboard**
  - Gráfico de linha (Histórico de Conversas) renderiza normalmente
  - Gráfico de rosca (Assuntos) aparece centralizado com legenda abaixo
  - Cards de métricas intactos

- [ ] **Step 2: Testar aba Conversas**
  - Lista de contatos carrega normalmente
  - Abrir conversa, pausar/retomar bot funcionam
  - Busca de contato funciona

- [ ] **Step 3: Testar aba Gerenciar Banco**
  - Cada botão de tabela carrega os dados corretos
  - Adicionar/Editar/Excluir registro funcionam (modal abre, salva, fecha)
  - Import CSV abre o modal correto
  - Filtro de unidade em "Turmas" funciona
  - Painel B aparece se houver dados em `intent_learning`

- [ ] **Step 4: Testar aba Configurações**
  - Form carrega com os valores do servidor
  - Salvar e limpar funcionam

- [ ] **Step 5: Commit final**

```bash
git add -p   # revisar se há algo não commitado
git commit -m "chore: verificação de regressão pós-redesign banco + fix rosca"
```

---

## Critério de Sucesso

- [ ] Painel A mostra labels semânticos e heading visual
- [ ] Painel B aparece com dados reais quando conectado ao Supabase
- [ ] Gráfico de rosca visível em todas as larguras de tela
- [ ] Zero regressões nas quatro abas
