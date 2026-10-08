/**
 * Sonda manual do Jev: roda o catálogo de rotas contra frases de exemplo e
 * imprime rota/confiança/unidade/nível. Uso: npx tsx --env-file=.env scripts/jev-probe.ts
 */
import { JevClient } from "../src/llm/jev";
import { classifyWithJev } from "../src/worker/jev-router";
import { config } from "../src/config";

const casos: Array<{ hist?: Array<{ role: string; content: string }>; msg: string }> = [
  { msg: "Quanto fica a mensalidade do 7 ano?" },
  { msg: "tem desconto pra quem fez a seletiva?" },
  { msg: "Qual o calendário das provas da seletiva?" },
  { msg: "meu filho fez a prova sábado e até agora nada do resultado" },
  { msg: "vcs tem van?" },
  { hist: [{ role: "assistant", content: "Claro! Temos 3 unidades — me diz qual você prefere que eu te passe o número" }], msg: "augusto" },
  { hist: [{ role: "user", content: "Quero fazer uma visita" }, { role: "assistant", content: "Ótimo! Qual unidade?" }], msg: "Tem link?" },
  { msg: "Quero renovar a matrícula da minha filha que estuda aí" },
  { msg: "Bom dia, me chamo Carla" },
  { msg: "quero falar com uma pessoa por favor" },
  { msg: "O uniforme é vendido onde?" },
  { msg: "estou no 3º ano e quero passar na EsPCEx" },
];

async function main() {
const client = new JevClient({ apiKey: config.jev.apiKey, model: config.jev.model, timeoutMs: 8000 });
for (const c of casos) {
  const d = await classifyWithJev(client, c.hist ?? [], c.msg);
  if (!d) { console.log("FALHOU", c.msg); continue; }
  console.log(
    `${c.msg.padEnd(62)} → ${d.route.padEnd(32)} conf=${d.confidence.toFixed(2)} un=${d.unit ?? "-"} niv=${d.nivel ?? "-"} hum=${d.humano.toFixed(2)} ${d.latencyMs}ms ${d.inputTokens}tok ${d.model}`
  );
}
}
main();
