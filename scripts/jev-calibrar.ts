/**
 * Recalibra o modo live do Jev com os dados do modo sombra (tabela jev_shadow).
 *
 * Baixa todas as linhas, mostra a concordância regex × Jev por faixa de
 * confiança e simula o veto (jevVeredito) com o LIVE_MIN atual: quantas
 * mensagens o Jev mudaria e quais — pra revisar à mão antes de mexer no corte.
 * Grava o dump em data/jev-shadow/ (fora do git — tem mensagem de cliente).
 *
 * Uso: NODE_ENV=production npx tsx --env-file=.env scripts/jev-calibrar.ts
 */
import { writeFileSync, mkdirSync } from "fs";
import { getSupabase } from "../src/db/supabase-client";
import { jevVeredito, JevDecision, LIVE_MIN } from "../src/worker/jev-router";

const SELETIVA = ["seletiva_resultado", "seletiva_resultado_nao_recebido", "seletiva_prova", "seletiva_edital", "seletiva_agendamento"];

interface Row {
  id: number;
  created_at: number;
  message: string;
  legacy_route: string;
  final_route?: string | null;
  jev_route: string | null;
  jev_confidence: number | null;
  agree: boolean | null;
}

async function main() {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await getSupabase().from("jev_shadow").select("*").order("id").range(from, from + 999);
    if (error) throw error;
    rows.push(...(data as Row[]));
    if (!data || data.length < 1000) break;
  }
  mkdirSync("data/jev-shadow", { recursive: true });
  const out = `data/jev-shadow/jev_shadow-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(out, JSON.stringify(rows));
  const dia = (t: number) => new Date(Number(t)).toISOString().slice(0, 10);
  console.log(`${rows.length} linhas (${dia(rows[0].created_at)} → ${dia(rows[rows.length - 1].created_at)}) → ${out}\n`);

  console.log("Concordância por faixa de confiança:");
  const comp = rows.filter((r) => r.agree !== null && r.jev_confidence !== null);
  for (const [lo, hi] of [[0, 0.5], [0.5, 0.8], [0.8, 0.95], [0.95, 1.01]]) {
    const b = comp.filter((r) => r.jev_confidence! >= lo && r.jev_confidence! < hi);
    const pct = b.length ? Math.round((100 * b.filter((r) => r.agree).length) / b.length) : 0;
    console.log(`  ${lo.toFixed(2)}–${Math.min(hi, 1).toFixed(2)}: ${String(b.length).padStart(4)} msgs, ${pct}% concordam`);
  }

  const mudaria: string[] = [];
  for (const r of rows) {
    if (!r.jev_route || r.jev_confidence === null) continue;
    const d = { route: r.jev_route, confidence: r.jev_confidence } as JevDecision;
    const v = jevVeredito(r.legacy_route, d, SELETIVA.includes(r.legacy_route) ? SELETIVA : []);
    if (v.acao === "seguir") continue;
    mudaria.push(`  ${v.acao.padEnd(6)} #${r.id} ${r.legacy_route} → ${r.jev_route} (${r.jev_confidence.toFixed(2)}) | ${r.message.replace(/\s+/g, " ").slice(0, 90)}`);
  }
  console.log(`\nCom LIVE_MIN=${LIVE_MIN}, o Jev mudaria ${mudaria.length} de ${rows.length} respostas:`);
  console.log(mudaria.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
