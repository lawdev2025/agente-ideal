# Design — Contatos órfãos para as 3 atendentes + fluxo de Transferência

Data: 2026-07-08

## Problema

1. **Leads sem unidade caem no vácuo.** As 3 atendentes de unidade
   (Elizangela=AM, Ivane=BC, Adriane=CN, `role: unit`) só enxergam contatos
   cujo `unit_tag` bate com a unidade delas
   (`api/admin/contacts.ts`). Um cliente que demonstra interesse em matrícula
   mas **não diz a unidade** fica com `unit_tag = null` e não aparece para
   ninguém.

2. **"Transferência" é tratada como documento de saída.** Hoje `transferência`
   está em `DOCUMENT_KEYWORDS` (`intent-router.ts`) → cai em `document_request`
   e o bot responde só com o telefone da secretaria, como se fosse tirar um
   documento. Na prática, quem fala em transferência geralmente quer **vir** pro
   Ideal.

## Solução

### Parte 1 — Contatos órfãos (tag=matrícula) visíveis para as 3

Arquivo: `api/admin/contacts.ts`. Ajuste do filtro de escopo nos **dois**
caminhos (RPC e fallback):

```js
const scoped = authUser.role === "unit"
  ? list.filter((c) =>
      c.unit_tag === authUser.unit ||
      (!c.unit_tag && c.tag === "matricula"))
  : list;
```

- Cada atendente continua vendo os contatos da sua unidade **e** passa a ver os
  leads de matrícula sem unidade definida (esses aparecem para as 3 ao mesmo
  tempo — sem mecanismo de "claim", é intencional).
- Contatos sem unidade e sem tag de matrícula (ex.: só "oi") continuam fora.
- Vale para `/admin` e `/app` — usam o mesmo endpoint.
- `c.tag` e `c.unit_tag` já vêm no payload: a RPC faz `to_jsonb(c)` (todas as
  colunas de `contacts`) e o fallback faz `select("*")`.

### Parte 2 — `transfer_request`: transferência como interesse de entrada

Arquivos: `src/worker/intent-router.ts`, `src/worker/orchestrator.ts`.

**Router:**
- Remover `transfer[êe]ncia` de `DOCUMENT_KEYWORDS`.
- Novo `TRANSFER_KEYWORDS`: `transferência`, `transferir`, `mudar de escola`,
  `trocar de escola`.
- Novo intent `{ kind: "transfer_request"; unit?: string }`, avaliado antes de
  documento/visita/matrícula (depois de human_request e hard off-scope).
  `unit` = unidade detectada na mensagem, se houver.

**Orquestrador:**
- `processMessage`: nova ramificação `if (intent.kind === "transfer_request")`
  → `handleTransferRequest(...)`, logo após o bloco de `soft_redirect` e antes
  do dispatch de intents cacheáveis (não é cacheável).
- `handleTransferRequest`:
  - `resolvedUnit = unit ?? findRecentUnit(history)`.
  - Com unidade → `buildTransferReplyWithUnit(unit)` (link de visita +
    telefone da secretaria daquela unidade).
  - Sem unidade → `TRANSFER_ASK_UNIT_REPLY` (pergunta qual unidade).
  - `softNotifyTeam` (lead quente, não pausa o bot).
- Follow-up determinístico: `detectPendingUnitAsk` ganha o tipo `"transfer"`
  (casando uma frase-marca exclusiva do `TRANSFER_ASK_UNIT_REPLY`); o despacho
  em `processMessage` (que hoje trata document/payment/secretaria) passa a
  mapear `"transfer"` → `buildTransferReplyWithUnit(followUpUnit)`. Assim,
  responder só "Cidade Nova" após a pergunta resolve sem LLM.

**Textos (tom WhatsApp atual):**

Sem unidade (`TRANSFER_ASK_UNIT_REPLY`, contém a frase-marca
"fazer a transferência pro *Colégio Ideal*"):
```
Que ótimo que você quer fazer a transferência pro *Colégio Ideal*! 🎉

Pra te passar o link de visita e o contato certinho, me diz de qual unidade você quer:
🏫 *Batista Campos*
🏫 *Augusto Montenegro*
🏫 *Cidade Nova (Ananindeua)*
```

Com unidade (`buildTransferReplyWithUnit`):
```
Que ótimo que você quer vir pro *Colégio Ideal*! 🎉 A transferência é bem tranquila.

Na unidade *${unit}*, agende uma visita que a gente te explica tudo:
👉 ${VISIT_LINKS[unit]}

📞 E pra dúvidas de documentos/vaga, fale com a secretaria: *${UNIT_SECRETARIA_PHONE[unit]}*
```

Decisão confirmada: **toda** menção a transferência vira fluxo de entrada
(inclusive aluno atual querendo sair — caso raro; a secretaria no telefone
resolve a saída).

## Testes

`tests/orchestrator-flows.test.ts` (e/ou router):
- "quero transferir meu filho pra Cidade Nova" → reply com link CN + telefone CN,
  sem pausar o bot.
- "quero fazer uma transferência" (sem unidade) → pergunta a unidade; resposta
  seguinte "Batista Campos" → reply com link + telefone BC.
- Regressão: "preciso do meu histórico escolar" continua caindo em documento
  (não vira transferência).

`tests/contact-tags.test.ts` já cobre a classificação; o filtro do endpoint é
lógica simples (sem novo teste de API — sem harness de request nesta base).

## Fora de escopo

- Mecanismo de "claim" / atribuição de órfãos a uma atendente específica.
- Reclassificar transferência por LLM (fica determinístico).
