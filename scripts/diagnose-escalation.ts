/**
 * Diagnóstico determinístico do "manda pra coordenação cedo demais".
 *
 * NÃO precisa de servidor, API key ou rede. Exercita o pipeline REAL
 * (routeIntent + MessageOrchestrator + sanitizer + detecção de deflexão)
 * com um LLM "de mentira" cujo comportamento imita o que os system prompts
 * de produção mandam o modelo responder. Assim conseguimos ver, para cada
 * mensagem de pai/mãe, o que o CLIENTE receberia e se houve escalação —
 * tudo offline e reproduzível.
 *
 * Rode com:  npx tsx scripts/diagnose-escalation.ts
 */

// Env stub ANTES de importar qualquer coisa que dependa de config/env (zod).
const ENV_DEFAULTS: Record<string, string> = {
  NODE_ENV: "production",
  WHATSAPP_PHONE_NUMBER_ID: "test",
  WHATSAPP_ACCESS_TOKEN: "test",
  WHATSAPP_APP_SECRET: "test",
  WHATSAPP_VERIFY_TOKEN: "test",
  GEMINI_API_KEY: "test",
  ANTHROPIC_API_KEY: "test",
  TELEGRAM_BOT_TOKEN: "test",
  TELEGRAM_CHAT_ID: "test",
  INSTITUTION_NAME: "Colégio Ideal",
  ADMIN_TOKEN: "test",
  WHATSAPP_DRY_RUN: "0",
};
for (const [k, v] of Object.entries(ENV_DEFAULTS)) {
  if (!process.env[k]) process.env[k] = v;
}

type Msg = { role: string; content: string };

/**
 * LLM de mentira. Recebe um "modo" que decide como ele responde, imitando
 * o que os system prompts de produção realmente induzem o modelo a dizer.
 *
 *  - "answer"      → responde direto e útil (sem deflexão)
 *  - "secretaria"  → usa a frase SANCIONADA pelo chat prompt para dúvidas
 *                    concretas fora da base: "Essa parte quem te confirma
 *                    é a secretaria — quer o telefone?"  ← veja o que acontece
 *  - "phone"       → devolve um telefone real
 */
function makeFakeLLM(mode: "answer" | "secretaria" | "phone") {
  return {
    async generateMessage(userMessage: string, _hist: Msg[], _tools: unknown[]) {
      if (mode === "phone") {
        return { message: "Claro! O telefone da Sede é (91) 3323-5000. 😊", toolCalls: [] };
      }
      if (mode === "secretaria") {
        // Exatamente o que o buildChatSystemPrompt manda dizer para dúvidas
        // concretas que não estão na base.
        return {
          message: "Essa parte quem te confirma é a secretaria — quer o telefone?",
          toolCalls: [],
        };
      }
      return { message: "Boa! Posso te ajudar com isso sim. 😊", toolCalls: [] };
    },
  };
}

function makeDeps(opts: { history?: Msg[]; paused?: boolean; llmMode?: "answer" | "secretaria" | "phone" }) {
  const history: Msg[] = [...(opts.history ?? [])];
  const sentToClient: string[] = [];
  const escalations: string[] = [];
  let paused = !!opts.paused;

  let displayName: string | null = "Maria";
  const stateRepository = {
    async getOrCreateContact(waId: string) {
      return { wa_id: waId, bot_paused: paused, display_name: displayName };
    },
    async setDisplayName(_waId: string, name: string) {
      displayName = name;
    },
    async getHistory() {
      return history.map((h, i) => ({ id: i + 1, wa_id: "u1", role: h.role, content: h.content, created_at: Date.now() }));
    },
    async appendMessage(_c: string, role: string, content: string) {
      history.push({ role, content });
      return 1;
    },
    async pauseBot() {
      paused = true;
    },
    async resumeBot() {
      paused = false;
    },
    async isBotPaused() {
      return paused;
    },
  };
  const whatsappClient = {
    async sendMessage(_to: string, text: string) {
      sentToClient.push(text);
      return { messageId: "m1" };
    },
  };
  const escalationHandler = {
    async escalateToGroup(_studentId: string, reason: string) {
      escalations.push(reason);
      return { messageId: "e1" };
    },
  };
  const llmProvider = makeFakeLLM(opts.llmMode ?? "answer");

  return { stateRepository, whatsappClient, escalationHandler, llmProvider, sentToClient, escalations, getPaused: () => paused };
}

interface Scenario {
  id: string;
  msg: string;
  /** Como o LLM deve responder se a msg chegar no path de chat livre. */
  llmMode?: "answer" | "secretaria" | "phone";
  history?: Msg[];
  /**
   * Comportamento esperado:
   *  - "answer" → responde, sem Telegram, sem pausa.
   *  - "soft"   → redireciona pra secretaria, avisa o time em SILÊNCIO
   *               (Telegram sim, pausa NÃO, sem "vou pedir pra coordenação").
   *  - "hard"   → handoff humano: pausa + "vou pedir pra coordenação" + Telegram.
   */
  expect: "answer" | "soft" | "hard";
  note: string;
}

const HIST_NAMED: Msg[] = [
  { role: "assistant", content: "Olá! Aqui é o atendimento oficial do Grupo Ideal. Como posso te chamar?" },
  { role: "user", content: "Maria" },
  { role: "assistant", content: "Prazer, Maria! Como posso ajudar?" },
];

const SCENARIOS: Scenario[] = [
  // --- Coisas que o bot SABE responder (system prompt já tem o dado) ---
  { id: "uniforme", msg: "onde compro o uniforme?", history: HIST_NAMED, llmMode: "answer", expect: "answer",
    note: "System prompt SABE: 'Uniforme na malharia das unidades'. Responde direto." },
  { id: "horario-aula", msg: "que horas começam as aulas?", history: HIST_NAMED, llmMode: "answer", expect: "answer",
    note: "System prompt SABE: 07:30 com 30 min tolerância." },
  { id: "sistema", msg: "vocês usam qual sistema de ensino?", history: HIST_NAMED, llmMode: "answer", expect: "answer",
    note: "System prompt SABE: Poliedro." },
  { id: "niveis", msg: "tem ensino médio?", history: HIST_NAMED, llmMode: "answer", expect: "answer",
    note: "Nível conhecido — enrollment_info." },
  { id: "telefone", msg: "qual o telefone de vocês?", history: HIST_NAMED, llmMode: "phone", expect: "answer",
    note: "Contato conhecido — pergunta qual unidade." },

  // --- Dúvida concreta fora da base: oferece secretaria + avisa em silêncio,
  //     NÃO vira resposta de preço, NÃO pausa o bot ---
  { id: "robotica", msg: "vocês têm aula de robótica?", history: HIST_NAMED, llmMode: "secretaria", expect: "soft",
    note: "Antes virava resposta de PREÇO + escalava. Agora: secretaria + aviso silencioso." },
  { id: "periodo-integral", msg: "tem período integral?", history: HIST_NAMED, llmMode: "secretaria", expect: "soft",
    note: "Dúvida concreta; secretaria, não preço, não pausa." },
  { id: "bolsa", msg: "vocês oferecem bolsa de estudo?", history: HIST_NAMED, llmMode: "answer", expect: "soft",
    note: "Bolsa → secretaria + aviso silencioso (sem pausar)." },
  { id: "desconto", msg: "tem desconto pra dois irmãos?", history: HIST_NAMED, llmMode: "answer", expect: "soft",
    note: "Desconto → secretaria + aviso silencioso." },
  { id: "transferencia", msg: "como faço a transferência do histórico escolar?", history: HIST_NAMED, llmMode: "answer", expect: "soft",
    note: "Documento → secretaria + aviso silencioso." },

  // --- Handoff humano de verdade: pausa + coordenação ---
  { id: "futebol", msg: "quem ganha o jogo do Flamengo?", history: HIST_NAMED, llmMode: "answer", expect: "hard",
    note: "Totalmente fora do escopo → handoff humano." },
  { id: "humano", msg: "quero falar com um atendente humano", history: HIST_NAMED, llmMode: "answer", expect: "hard",
    note: "Pediu humano explicitamente → handoff humano." },

  // --- Preço: resposta fixa presencial, nunca escala ---
  { id: "mensalidade", msg: "qual o valor da mensalidade?", history: HIST_NAMED, llmMode: "answer", expect: "answer",
    note: "Resposta presencial fixa, sem escalar." },
];

async function run() {
  const { MessageOrchestrator } = await import("../src/worker/orchestrator");
  const { routeIntent } = await import("../src/worker/intent-router");

  console.log("\n================ DIAGNÓSTICO DE ESCALAÇÃO ================\n");

  let surprises = 0;
  for (const s of SCENARIOS) {
    const deps = makeDeps({ history: s.history, llmMode: s.llmMode });
    const orch = new MessageOrchestrator(
      deps.llmProvider as any,
      deps.stateRepository as any,
      deps.whatsappClient as any,
      deps.escalationHandler as any
    );

    const intent = routeIntent(s.msg, true);
    await orch.processMessage("u1", s.msg, "u1");

    const clientMsgs = deps.sentToClient;
    const lastClient = clientMsgs[clientMsgs.length - 1] ?? "(nada)";
    const telegram = deps.escalations.length > 0;
    const paused = deps.getPaused();
    const handoffToClient = clientMsgs.some((m) => /vou pedir para a coordena/i.test(m));

    // Classifica o comportamento observado nos 3 tiers.
    const observed: "answer" | "soft" | "hard" =
      paused && handoffToClient ? "hard" : telegram ? "soft" : "answer";
    // Sanidade extra: pergunta que não é de preço NÃO pode receber a resposta
    // de preço presencial.
    const gotPriceReply = /informamos \*somente presencialmente\*/i.test(lastClient);
    const wrongPriceReply = gotPriceReply && s.id !== "mensalidade";

    const wrong = observed !== s.expect || wrongPriceReply;
    if (wrong) surprises++;

    const flag = wrong ? "🔴 INESPERADO" : "🟢 ok";
    console.log(`[${s.id}] ${flag}  (esperado: ${s.expect} · observado: ${observed})`);
    console.log(`  cliente disse : "${s.msg}"`);
    console.log(`  intent        : ${intent.kind}`);
    console.log(`  telegram?     : ${telegram ? "SIM" : "não"}   bot pausado?: ${paused ? "SIM ⚠️" : "não"}   handoff p/ cliente?: ${handoffToClient ? "SIM" : "não"}`);
    if (wrongPriceReply) console.log(`  ⚠️  recebeu RESPOSTA DE PREÇO sem ser pergunta de preço!`);
    console.log(`  cliente recebe: "${truncate(lastClient, 140)}"`);
    console.log(`  nota          : ${s.note}`);
    console.log("");
  }

  console.log("=========================================================");
  console.log(`Cenários com comportamento INESPERADO: ${surprises}/${SCENARIOS.length}`);
  console.log("=========================================================\n");
  if (surprises > 0) process.exitCode = 1;
}

function truncate(s: string, n: number): string {
  const oneLine = s.replace(/\n+/g, " ⏎ ");
  return oneLine.length > n ? oneLine.slice(0, n) + "…" : oneLine;
}

run().catch((e) => {
  console.error("Falhou:", e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
