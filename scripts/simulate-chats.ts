/**
 * Agent-driven simulation of parent conversations against the live Ana bot.
 *
 * Each persona is driven by Gemini: given a goal and the bot's latest reply,
 * Gemini produces the next user message until either the goal is reached or
 * the conversation hits a max-turn limit. The webhook is hit at localhost:3000
 * exactly like chat-test.html does, so we exercise the real pipeline.
 *
 * After all conversations finish, a separate "judge" Gemini call evaluates
 * each transcript against hard rules (no "aguarde", correct escalation, etc.)
 * and writes one HTML file per persona styled like the chat UI, plus a
 * summary report.
 *
 * Run with: npx tsx scripts/simulate-chats.ts
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import config from "../src/config/env";

const WEBHOOK_URL = "http://localhost:3000/webhook";
const RESPONSE_URL = "http://localhost:3000/api/response";
const APP_SECRET = config.WHATSAPP_APP_SECRET;
const GEMINI_KEY = config.GEMINI_API_KEY;
// Use the same model the production bot uses — the user's free-tier quota
// for gemini-2.0-flash is exhausted, but the configured model still works.
const JUDGE_MODEL = config.GEMINI_MODEL;
const PERSONA_MODEL = config.GEMINI_MODEL;
// Delay between persona + judge calls to stay under per-minute quotas.
const CALL_THROTTLE_MS = 4000;

const genai = new GoogleGenerativeAI(GEMINI_KEY);

interface Persona {
  id: string;
  label: string;
  goal: string;
  expectation:
    | "answer_directly"
    | "map_synonym"
    | "escalate"
    | "answer_then_followup";
  notes?: string;
}

const PERSONAS: Persona[] = [
  {
    id: "01-mae-maternal",
    label: "Mãe ansiosa, filho de 3 anos",
    goal: "Quer saber valor da mensalidade do maternal/educação infantil para um filho de 3 anos.",
    expectation: "escalate",
    notes: "Colégio não tem educação infantil — deve escalar limpa.",
  },
  {
    id: "02-pai-direto-fund1",
    label: "Pai direto, filho de 9 anos",
    goal: "Quer saber quanto custa o Fundamental 1 e como matricular.",
    expectation: "answer_directly",
  },
  {
    id: "03-sinonimo-5ano",
    label: "Pai usando série em vez do nome do nível",
    goal: "Quer saber o valor do '5º ano' (sem dizer Fundamental 1).",
    expectation: "map_synonym",
    notes: "Bot deve mapear 5º ano → Fundamental 1.",
  },
  {
    id: "04-terceirao",
    label: "Mãe de aluno de cursinho",
    goal: "Quer saber valor do 'terceirão' / 'cursinho pré-vestibular'.",
    expectation: "map_synonym",
    notes: "Terceirão ≡ Pré-Enem.",
  },
  {
    id: "05-off-topic",
    label: "Cliente off-topic",
    goal: "Pergunta quem vai ganhar o jogo do Flamengo no fim de semana.",
    expectation: "escalate",
    notes: "Fora de escopo — deve escalar sem entrar no assunto.",
  },
  {
    id: "06-pede-humano",
    label: "Cliente que quer humano direto",
    goal: "Logo de cara pede pra falar com um atendente humano.",
    expectation: "escalate",
  },
  {
    id: "07-medio-com-desconto",
    label: "Mãe negociando",
    goal: "Quer saber valor do Ensino Médio e se tem desconto pra irmãos.",
    expectation: "answer_then_followup",
    notes: "Tem valor do EM mas desconto deve escalar.",
  },
  {
    id: "08-cliente-grosso",
    label: "Cliente impaciente e grosso",
    goal: "Tá com pressa, pergunta valor de todos os níveis de uma vez, sem paciência.",
    expectation: "answer_directly",
  },
  {
    id: "09-multi-info",
    label: "Cliente curioso",
    goal: "Quer saber valor do Fundamental 2, horário das aulas e que material vem incluso.",
    expectation: "answer_directly",
  },
  {
    id: "10-endereco-visita",
    label: "Pai querendo visitar a escola",
    goal: "Pergunta endereço, horário de funcionamento e como agendar visita.",
    expectation: "escalate",
    notes: "Endereço/visita não estão na base — deve escalar.",
  },
  {
    id: "11-renovacao",
    label: "Mãe renovando matrícula",
    goal: "Já tem filho na escola, quer renovar matrícula do filho que vai para o 7º ano.",
    expectation: "answer_then_followup",
    notes: "Renovação não está na base mas pode informar Fund 2; resto escala.",
  },
  {
    id: "12-bolsa",
    label: "Pai pedindo bolsa de estudo",
    goal: "Quer saber se tem bolsa de estudo / desconto para baixa renda.",
    expectation: "escalate",
  },
];

const MAX_TURNS = 6;

function hmac(payload: string): string {
  return crypto
    .createHmac("sha256", APP_SECRET)
    .update(payload)
    .digest("hex");
}

async function sendUserMessage(senderId: string, text: string): Promise<void> {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "sim",
        time: Math.floor(Date.now() / 1000),
        messaging: [
          {
            sender: { id: senderId },
            recipient: { id: "999999999" },
            timestamp: Math.floor(Date.now() / 1000),
            message: { mid: `msg_${Date.now()}`, text },
          },
        ],
      },
    ],
  };
  const body = JSON.stringify(payload);
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hub-signature-256": `sha256=${hmac(body)}`,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Webhook failed: HTTP ${res.status} ${await res.text()}`);
  }
}

async function waitForBotReply(
  senderId: string,
  alreadySeen: Set<string>,
  timeoutMs = 30000
): Promise<string | null> {
  const start = Date.now();
  // Initial breathing room for the poller + Gemini round-trip.
  await sleep(1200);
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${RESPONSE_URL}?userId=${senderId}`);
      if (res.ok) {
        const data = (await res.json()) as { response?: string };
        if (data.response && !alreadySeen.has(data.response)) {
          alreadySeen.add(data.response);
          return data.response;
        }
      }
    } catch {
      // ignore — server might be momentarily restarting
    }
    await sleep(400);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function nextUserMessage(
  persona: Persona,
  transcript: Array<{ role: "parent" | "ana"; text: string }>
): Promise<string> {
  const history = transcript
    .map((t) => `${t.role === "parent" ? "Pai/mãe" : "Ana"}: ${t.text}`)
    .join("\n");

  const prompt = `Você está roleplaying um pai/mãe falando com a Ana, atendente de matrículas de um colégio, pelo WhatsApp.

PERSONA: ${persona.label}
SEU OBJETIVO NA CONVERSA: ${persona.goal}

REGRAS DO ROLEPLAY:
- Escreva COMO UMA PESSOA REAL no WhatsApp: frases curtas, informais, pode ter erro de digitação ocasional, sem emojis excessivos.
- Não revele que é um teste. Não cite "persona", "roleplay", "Ana" como personagem.
- Se Ana ainda não pediu seu nome e você é a primeira mensagem, NÃO diga seu nome ainda.
- Se Ana pediu seu nome, responda com um nome brasileiro plausível em UMA palavra.
- Avance em direção ao seu objetivo. Faça perguntas de follow-up naturais.
- Se a Ana já te deu a resposta que você queria E você está satisfeito, escreva exatamente a string: <<FIM>>
- Se a Ana já escalou pra um humano e disse que vão te responder, escreva exatamente: <<FIM>>
- Caso contrário, escreva APENAS sua próxima fala, nada mais.

HISTÓRICO DA CONVERSA ATÉ AGORA:
${history || "(você ainda não falou nada)"}

Sua próxima fala:`;

  await sleep(CALL_THROTTLE_MS);
  const model = genai.getGenerativeModel({ model: PERSONA_MODEL });
  const r = await callWithRetry(() => model.generateContent(prompt));
  return r.response.text().trim();
}

// Gemini sometimes hits per-minute quotas mid-run. Honor the retryDelay
// from the 429 response (or fall back to 30s), then try once more.
async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = (e as Error).message || "";
    if (!/429|quota|rate/i.test(msg)) throw e;
    const m = msg.match(/retry in ([\d.]+)s/i);
    const wait = m ? Math.ceil(parseFloat(m[1]) * 1000) + 2000 : 30000;
    console.log(`   ⏳ Quota hit — aguardando ${(wait / 1000).toFixed(0)}s`);
    await sleep(wait);
    return fn();
  }
}

interface TurnRecord {
  role: "parent" | "ana";
  text: string;
  ts: number;
}

interface ScenarioResult {
  persona: Persona;
  senderId: string;
  transcript: TurnRecord[];
  failures: string[];
  judge: JudgeResult | null;
  startedAt: string;
  durationMs: number;
}

interface JudgeResult {
  verdict: "PASS" | "FAIL" | "NEEDS_REVIEW";
  reasoning: string;
  rule_breaches: string[];
}

async function runScenario(persona: Persona): Promise<ScenarioResult> {
  const senderId = `sim_${persona.id}_${Date.now()}`;
  const transcript: TurnRecord[] = [];
  const seen = new Set<string>();
  const failures: string[] = [];
  const t0 = Date.now();
  const startedAt = new Date().toISOString();

  console.log(`\n▶  [${persona.id}] ${persona.label}`);

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let userText: string;
    try {
      userText = await nextUserMessage(persona, transcript);
    } catch (e) {
      failures.push(`Persona generator failed: ${(e as Error).message}`);
      break;
    }

    if (userText.includes("<<FIM>>")) {
      console.log(`   parent → <<FIM>>`);
      break;
    }

    // Strip stray quotes Gemini sometimes wraps around output.
    userText = userText.replace(/^["']|["']$/g, "").trim();
    if (!userText) {
      failures.push("Persona produced empty message");
      break;
    }

    transcript.push({ role: "parent", text: userText, ts: Date.now() });
    console.log(`   parent → ${userText}`);

    try {
      await sendUserMessage(senderId, userText);
    } catch (e) {
      failures.push(`Webhook send failed: ${(e as Error).message}`);
      break;
    }

    const botReply = await waitForBotReply(senderId, seen, 30000);
    if (!botReply) {
      failures.push(`Ana never replied within 30s (turn ${turn + 1})`);
      console.log(`   ana    → ⏱ TIMEOUT`);
      break;
    }
    transcript.push({ role: "ana", text: botReply, ts: Date.now() });
    console.log(`   ana    → ${botReply.slice(0, 120)}${botReply.length > 120 ? "…" : ""}`);
  }

  const judge = transcript.length ? await judgeTranscript(persona, transcript) : null;

  return {
    persona,
    senderId,
    transcript,
    failures,
    judge,
    startedAt,
    durationMs: Date.now() - t0,
  };
}

async function judgeTranscript(
  persona: Persona,
  transcript: TurnRecord[]
): Promise<JudgeResult> {
  const text = transcript
    .map((t) => `${t.role === "parent" ? "PAI/MÃE" : "ANA"}: ${t.text}`)
    .join("\n");

  const prompt = `Você é um auditor de qualidade de atendimento. Avalie a conversa abaixo entre uma pessoa (PAI/MÃE) e a Ana, atendente de matrículas do Colégio Ideal.

CONTEXTO DA PERSONA:
- Persona: ${persona.label}
- Objetivo da pessoa: ${persona.goal}
- Comportamento esperado da Ana: ${persona.expectation}
- Observação: ${persona.notes ?? "(nenhuma)"}

REGRAS DURAS QUE A ANA DEVE SEGUIR:
1. NUNCA usar "aguarde", "um momento", "vou verificar", "deixa eu checar" ou variantes — ou ela responde, ou escala.
2. NUNCA inventar dados numéricos. Valores válidos: Fund 1 R$1200, Fund 2 R$1400, Médio R$1700, Pré-Enem R$1900.
3. Quando o usuário usa nome alternativo (5º ano, terceirão, cursinho, etc.), Ana deve mapear corretamente sem perguntar de volta.
4. Quando a pergunta é fora de escopo (educação infantil, esportes, endereço, bolsa, etc.), Ana deve dizer claramente que está encaminhando para coordenação.
5. Após o usuário dar o nome, Ana deve usá-lo nas respostas seguintes.
6. Respostas devem ser curtas e em tom WhatsApp, sem parecer email formal.

CONVERSA:
${text}

Responda APENAS em JSON válido, sem markdown, no formato:
{"verdict": "PASS" | "FAIL" | "NEEDS_REVIEW", "reasoning": "<1-3 frases>", "rule_breaches": ["<regra quebrada 1>", ...]}`;

  try {
    await sleep(CALL_THROTTLE_MS);
    const model = genai.getGenerativeModel({ model: JUDGE_MODEL });
    const r = await callWithRetry(() => model.generateContent(prompt));
    let raw = r.response.text().trim();
    raw = raw.replace(/^```json\s*|\s*```$/g, "").replace(/^```\s*|\s*```$/g, "");
    const parsed = JSON.parse(raw) as JudgeResult;
    return parsed;
  } catch (e) {
    return {
      verdict: "NEEDS_REVIEW",
      reasoning: `Judge call failed: ${(e as Error).message}`,
      rule_breaches: [],
    };
  }
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(result: ScenarioResult): string {
  const bubbles = result.transcript
    .map((t) => {
      const cls = t.role === "parent" ? "user" : "bot";
      const time = new Date(t.ts).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      return `<div class="message ${cls}"><div class="message-bubble">${escape(t.text)}</div><div class="message-time">${time}</div></div>`;
    })
    .join("\n");

  const verdict = result.judge?.verdict ?? "NO_JUDGMENT";
  const verdictColor =
    verdict === "PASS"
      ? "#2e7d32"
      : verdict === "FAIL"
      ? "#c62828"
      : "#f57c00";
  const breaches = (result.judge?.rule_breaches ?? [])
    .map((b) => `<li>${escape(b)}</li>`)
    .join("");
  const failuresList = result.failures
    .map((f) => `<li>${escape(f)}</li>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>${escape(result.persona.label)}</title>
<style>
body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; background: #ece5dd; margin: 0; padding: 20px; }
.wrap { max-width: 900px; margin: 0 auto; display: grid; grid-template-columns: 480px 1fr; gap: 20px; }
.chat { background: #efeae2; border-radius: 12px; padding: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
.chat-header { background: #075e54; color: white; padding: 12px 16px; border-radius: 8px 8px 0 0; margin: -16px -16px 12px; }
.chat-header h2 { margin: 0; font-size: 16px; }
.chat-header p { margin: 4px 0 0; font-size: 12px; opacity: 0.85; }
.message { display: flex; margin: 8px 0; }
.message.user { justify-content: flex-end; }
.message-bubble { max-width: 75%; padding: 8px 12px; border-radius: 8px; font-size: 14px; line-height: 1.4; white-space: pre-wrap; }
.message.user .message-bubble { background: #dcf8c6; }
.message.bot .message-bubble { background: white; border: 1px solid #e0e0e0; }
.message-time { font-size: 10px; color: #999; align-self: flex-end; margin: 0 6px; }
.judge { background: white; border-radius: 12px; padding: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); height: fit-content; }
.judge h2 { margin-top: 0; font-size: 18px; }
.verdict { display: inline-block; padding: 4px 12px; border-radius: 12px; color: white; font-weight: bold; background: ${verdictColor}; }
.meta { color: #666; font-size: 13px; margin: 12px 0; }
.meta strong { color: #333; }
ul { padding-left: 20px; }
li { margin: 4px 0; font-size: 13px; }
.section { margin-top: 16px; }
</style></head><body>
<div class="wrap">
  <div class="chat">
    <div class="chat-header"><h2>Ana — Colégio Ideal</h2><p>Simulação: ${escape(result.persona.label)}</p></div>
    ${bubbles || '<p style="color:#999">(sem mensagens)</p>'}
  </div>
  <div class="judge">
    <h2>Avaliação</h2>
    <p><span class="verdict">${verdict}</span></p>
    <div class="meta">
      <p><strong>Persona:</strong> ${escape(result.persona.label)}</p>
      <p><strong>Objetivo:</strong> ${escape(result.persona.goal)}</p>
      <p><strong>Esperado:</strong> ${escape(result.persona.expectation)}</p>
      ${result.persona.notes ? `<p><strong>Nota:</strong> ${escape(result.persona.notes)}</p>` : ""}
      <p><strong>Turnos:</strong> ${result.transcript.length}</p>
      <p><strong>Duração:</strong> ${(result.durationMs / 1000).toFixed(1)}s</p>
    </div>
    <div class="section">
      <strong>Raciocínio do auditor:</strong>
      <p>${escape(result.judge?.reasoning ?? "(sem julgamento)")}</p>
    </div>
    ${breaches ? `<div class="section"><strong>Regras quebradas:</strong><ul>${breaches}</ul></div>` : ""}
    ${failuresList ? `<div class="section"><strong>Falhas de infraestrutura:</strong><ul>${failuresList}</ul></div>` : ""}
  </div>
</div></body></html>`;
}

function renderIndex(results: ScenarioResult[], outDir: string): string {
  const rows = results
    .map((r) => {
      const v = r.judge?.verdict ?? "NO_JUDGMENT";
      const color =
        v === "PASS" ? "#2e7d32" : v === "FAIL" ? "#c62828" : "#f57c00";
      return `<tr>
        <td><a href="${r.persona.id}.html">${escape(r.persona.label)}</a></td>
        <td><span style="background:${color};color:white;padding:2px 8px;border-radius:8px;font-size:12px">${v}</span></td>
        <td>${escape(r.persona.expectation)}</td>
        <td>${r.transcript.length}</td>
        <td>${(r.durationMs / 1000).toFixed(1)}s</td>
        <td>${r.failures.length}</td>
      </tr>`;
    })
    .join("\n");

  const total = results.length;
  const pass = results.filter((r) => r.judge?.verdict === "PASS").length;
  const fail = results.filter((r) => r.judge?.verdict === "FAIL").length;
  const review = total - pass - fail;

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>Simulação Ana — Resultados</title>
<style>
body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; background: #f5f5f5; margin: 0; padding: 24px; }
h1 { margin-top: 0; }
table { border-collapse: collapse; background: white; width: 100%; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #eee; }
th { background: #075e54; color: white; }
.summary { display: flex; gap: 12px; margin: 16px 0; }
.card { background: white; padding: 16px 24px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.card .n { font-size: 28px; font-weight: bold; }
.pass { color: #2e7d32; } .fail { color: #c62828; } .review { color: #f57c00; }
a { color: #075e54; }
</style></head><body>
<h1>Simulação Ana — ${new Date().toLocaleString("pt-BR")}</h1>
<div class="summary">
  <div class="card"><div>Total</div><div class="n">${total}</div></div>
  <div class="card"><div>Aprovados</div><div class="n pass">${pass}</div></div>
  <div class="card"><div>Falhas</div><div class="n fail">${fail}</div></div>
  <div class="card"><div>Revisar</div><div class="n review">${review}</div></div>
</div>
<table>
  <thead><tr><th>Persona</th><th>Veredito</th><th>Esperado</th><th>Turnos</th><th>Duração</th><th>Falhas infra</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`;
}

async function checkServer(): Promise<boolean> {
  try {
    const r = await fetch("http://localhost:3000/health");
    return r.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log("🤖 Agent-driven simulation starting...");

  if (!(await checkServer())) {
    console.error(
      "❌ Servidor em localhost:3000 não responde. Rode `npm run dev` antes."
    );
    process.exit(1);
  }
  console.log("✓ Servidor respondendo em localhost:3000");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join("tests", "simulation", stamp);
  fs.mkdirSync(outDir, { recursive: true });

  // Default: 6 personas (covers each expectation type). Pass --all to run all 12.
  const runAll = process.argv.includes("--all");
  const subset = runAll
    ? PERSONAS
    : PERSONAS.filter((p) =>
        ["01-mae-maternal", "02-pai-direto-fund1", "03-sinonimo-5ano", "04-terceirao", "05-off-topic", "07-medio-com-desconto"].includes(p.id)
      );
  console.log(`Rodando ${subset.length} cenário(s)${runAll ? " (--all)" : " (subset; --all para os 12)"}\n`);

  const results: ScenarioResult[] = [];
  for (const persona of subset) {
    const result = await runScenario(persona);
    results.push(result);
    fs.writeFileSync(
      path.join(outDir, `${persona.id}.html`),
      renderHtml(result)
    );
    fs.writeFileSync(
      path.join(outDir, `${persona.id}.json`),
      JSON.stringify(result, null, 2)
    );
  }

  fs.writeFileSync(path.join(outDir, "index.html"), renderIndex(results, outDir));

  const pass = results.filter((r) => r.judge?.verdict === "PASS").length;
  const fail = results.filter((r) => r.judge?.verdict === "FAIL").length;
  console.log(`\n✅ Simulação finalizada — ${pass} PASS, ${fail} FAIL, ${results.length - pass - fail} REVIEW`);
  console.log(`📂 Abra: ${path.resolve(outDir, "index.html")}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
