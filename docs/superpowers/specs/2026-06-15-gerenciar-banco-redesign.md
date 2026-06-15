# Design: Gerenciar Banco — Visual Redesign + Fix Gráfico de Rosca

**Data:** 2026-06-15  
**Escopo:** Somente camada visual (HTML, CSS, JS aditivo). Nenhuma lógica de negócio, query ou modal existente é alterada.

---

## Contexto

A aba "Gerenciar Banco" está organizada por nome de tabela (modelo mental de desenvolvedor). O admin pensa em função ("o que o bot precisa saber?"). Além disso, a tabela `intent_learning` existe em produção com dados reais acumulados pelo bot e está completamente invisível no painel. O gráfico de rosca no Dashboard desaparece da tela em certas resoluções por causa de legenda mal posicionada.

---

## Solução

### 1. Gerenciar Banco — Dois painéis por propósito

**Painel A — "O que a escola ensina ao bot"**  
Contém os botões de tabela existentes, reorganizados com labels semânticos:
- "Produtos" → "Turmas & Preços"
- "Contatos" → "Secretaria"
- "Respostas Diretas" → "FAQ do Bot"
- Adiciona heading visual e separador de seção
- A tabela e todos os modais continuam funcionando exatamente igual

**Painel B — "O que o bot aprendeu"**  
Seção nova, separada, abaixo do painel A:
- Só renderiza se `intent_learning` existir no Supabase e tiver dados
- Três mini-cards: total ativas / total candidatas / total acertos de cache
- Tabela com colunas: Intenção (`canonical_key`) | Tipo (`intent_kind`) | Acertos (`cache_hits`) | Taxa de sucesso | Status (badge verde/âmbar)
- Sem edição inline — read-only por ora (insert/delete fica para versão futura)

### 2. Fix gráfico de rosca

**Problema:** `charts-grid: 2fr 1fr` + legenda à direita com 6 rótulos longos espreme o donut até ~100px de largura.

**Fix:**
- CSS: `charts-grid` de `2fr 1fr` → `1fr 1fr`
- JS: `position: narrowChart ? 'bottom' : 'right'` → sempre `'bottom'`; ajusta `chart-wrapper` height do card do donut para `260px` (legenda abaixo precisa de menos altura vertical)

---

## Arquivos afetados

| Arquivo | Tipo de mudança |
|---|---|
| `public/admin/index.html` | Reorganização do `#tab-banco`: headings, labels, novo `#banco-learning` |
| `public/admin/admin.css` | Adição de `.banco-section`, `.learning-cards`, `.learning-table`, `.intent-badge`; mudança no `charts-grid` |
| `public/admin/admin.js` | Adição de `loadIntentLearning()`; chamada em `activateTab('banco')`; `position: 'bottom'` no donut |

---

## Restrições

- Nenhuma função JS existente é removida ou alterada em sua lógica
- Nenhum modal, query Supabase, CSV import ou fluxo de negócio é tocado
- O painel B só aparece quando conectado ao Supabase e com dados reais em `intent_learning`
- O rename dos botões é visual — o `data-table` attribute continua igual (não quebra o JS)

---

## Critério de sucesso

- [ ] Painel A mostra as mesmas tabelas com labels mais claros e hierarquia visual
- [ ] Painel B aparece quando há dados em `intent_learning`, some quando não há
- [ ] Gráfico de rosca visível em todas as resoluções testadas
- [ ] Zero regressões nas outras abas (Dashboard, Conversas, Configurações)
