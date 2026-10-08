/**
 * Avaliação OFFLINE do Jev com conversas reais do Supabase.
 *
 * Pega as N mensagens de cliente mais recentes, roda o Jev com o histórico que
 * existia ANTES de cada uma e gera um CSV (data/, fora do git — tem mensagem de
 * cliente) com: mensagem, rota aproximada do regex, rota do Jev, confiança e a
 * resposta que o bot realmente mandou. Serve pra revisar à mão onde os dois
 * discordam sem esperar o modo sombra acumular dados.
 *
 * "regex_aprox" reproduz os portões do orquestrador que são funções puras
 * (Passaporte, Seletiva encerrada, pagamento, preço, roteador). Não enxerga
 * school_faq, follow-up de unidade nem cache aprendido — o rótulo exato vem do
 * modo sombra (tabela jev_shadow).
 *
 * Uso: NODE_ENV=production npx tsx --env-file=.env scripts/jev-eval.ts [N=200] [tag]
 */
import { writeFileSync, mkdirSync } from "fs";
import { getSupabase } from "../src/db/supabase-client";
import { config } from "../src/config";
import { JevClient } from "../src/llm/jev";
import { classifyWithJev, routesAgree } from "../src/worker/jev-router";
import { routeIntent } from "../src/worker/intent-router";
import { loadActiveDirectResponses } from "../src/kb/direct-responses";
import {
  legacyRouteLabel,
  detectSeletivaEncerradaTopic,
  isPaymentOrSegundaChamadaQuestion,
  isPriceOrMaterialQuestion,
  isSeletivaInscricaoPaymentQuestion,
} from "../src/worker/orchestrator";
import { isPassaporteIdealQuestion } from "../src/kb/passaporte-ideal";
import { isSeletivaContentQuestion } from "../src/kb/seletiva-conteudo";

interface Msg {
  id: number;
  wa_id: string;
  role: string;
  content: string;
  created_at: number;
}

const N = Number(process.argv[2] || 200);
// Sufixo do arquivo de saída, pra comparar rodadas (ex.: v1, v2).
const TAG = process.argv[3] || new Date().toISOString().slice(0, 10);
const HISTORY_TURNS = 10;
const CONCURRENCY = 5;

function regexAprox(msg: string, history: Array<{ role: string; content: string }>): string {
  if (isPassaporteIdealQuestion(msg)) return "passaporte_ideal";
  if (config.seletivaEncerrada) {
    const t = detectSeletivaEncerradaTopic(msg, history);
    if (t) return `seletiva_${t}`;
  }
  if (isSeletivaInscricaoPaymentQuestion(msg)) return "seletiva_pagamento_inscricao";
  if (isSeletivaContentQuestion(msg)) return "seletiva_edital";
  if (isPaymentOrSegundaChamadaQuestion(msg)) return "pagamento";
  if (isPriceOrMaterialQuestion(msg)) return "valores";
  return legacyRouteLabel(routeIntent(msg, false), msg);
}

function csv(v: unknown): string {
  const s = v == null ? "" : String(v);
  return `"${s.replace(/"/g, '""').replace(/\r?\n/g, " ⏎ ")}"`;
}

async function fetchRecent(limit: number): Promise<Msg[]> {
  const sb = getSupabase();
  const rows: Msg[] = [];
  for (let from = 0; rows.length < limit; from += 1000) {
    const { data, error } = await sb
      .from("messages")
      .select("id, wa_id, role, content, created_at")
      .order("created_at", { ascending: false })
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...(data as Msg[]));
  }
  return rows;
}

async function main() {
  // Busca bem mais que N: precisamos do histórico ao redor de cada mensagem.
  const all = await fetchRecent(N * 6);
  const byContact = new Map<string, Msg[]>();
  for (const m of all) {
    if (!byContact.has(m.wa_id)) byContact.set(m.wa_id, []);
    byContact.get(m.wa_id)!.push(m);
  }
  for (const list of byContact.values()) list.sort((a, b) => a.created_at - b.created_at || a.id - b.id);

  const casos: Array<{ msg: Msg; history: Msg[]; reply: string }> = [];
  for (const list of byContact.values()) {
    list.forEach((m, i) => {
      if (m.role !== "user" || !m.content?.trim()) return;
      const next = list.slice(i + 1).find((x) => x.role !== "tool");
      casos.push({
        msg: m,
        history: list.slice(Math.max(0, i - HISTORY_TURNS), i),
        reply: next?.role === "assistant" ? next.content : "",
      });
    });
  }
  casos.sort((a, b) => b.msg.created_at - a.msg.created_at);
  const amostra = casos.slice(0, N);

  const faqs = (await loadActiveDirectResponses()) ?? [];
  const client = new JevClient({ apiKey: config.jev.apiKey, model: config.jev.model, timeoutMs: 10000 });

  const linhas: string[] = [
    ["quando", "wa_id", "mensagem", "regex_aprox", "jev_rota", "jev_rota_bruta", "jev_conf", "jev_continuacao", "jev_top3", "concorda", "jev_unidade", "jev_nivel", "jev_humano", "resposta_do_bot", "rota_correta"].join(","),
  ];
  let tokens = 0;
  let falhas = 0;
  let concorda = 0;
  let comparaveis = 0;

  for (let i = 0; i < amostra.length; i += CONCURRENCY) {
    const lote = amostra.slice(i, i + CONCURRENCY);
    const resultados = await Promise.all(
      lote.map(async (c) => {
        const hist = c.history.map((h) => ({ role: h.role, content: h.content }));
        const d = await classifyWithJev(client, hist, c.msg.content, faqs);
        return { c, hist, d };
      })
    );
    for (const { c, hist, d } of resultados) {
      const legacy = regexAprox(c.msg.content, hist);
      if (!d) falhas++;
      tokens += d?.inputTokens ?? 0;
      const agree = d ? routesAgree(legacy, d.route) : null;
      if (agree !== null) {
        comparaveis++;
        if (agree) concorda++;
      }
      linhas.push(
        [
          new Date(c.msg.created_at).toISOString(),
          c.msg.wa_id.slice(-4),
          c.msg.content,
          legacy,
          d?.route ?? "FALHOU",
          d?.rawRoute ?? "",
          d?.confidence.toFixed(2) ?? "",
          d?.continuacao.toFixed(2) ?? "",
          d?.top.map((t) => `${t.route}:${t.p.toFixed(2)}`).join(" | ") ?? "",
          agree === null ? "" : agree ? "sim" : "NAO",
          d?.unit ?? "",
          d?.nivel ?? "",
          d?.humano.toFixed(2) ?? "",
          c.reply.slice(0, 300),
          "",
        ]
          .map(csv)
          .join(",")
      );
    }
    process.stdout.write(`\r${Math.min(i + CONCURRENCY, amostra.length)}/${amostra.length}`);
  }

  mkdirSync("data", { recursive: true });
  const out = `data/jev-eval-${TAG}.csv`;
  // BOM pro Excel abrir os acentos certo.
  writeFileSync(out, "﻿" + linhas.join("\n"), "utf-8");
  console.log(
    `\n${amostra.length} mensagens · concordância regex×Jev ${comparaveis ? ((100 * concorda) / comparaveis).toFixed(0) : 0}% (${concorda}/${comparaveis}) · falhas ${falhas} · ${tokens} tokens ≈ US$ ${((tokens / 1e6) * 0.042).toFixed(4)}\n→ ${out}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
