/**
 * Planilha de MATRICULADOS do colégio (UNIDADE | … | NOME_ALUNO | …) →
 * contacts.seletiva_status = "matriculado" (selo "Matriculado" no CRM).
 *
 * A planilha não tem telefone: o telefone sai das inscrições da Seletiva
 * (data/seletiva/ e data/seletiva-agendada/), casando pelo NOME DO ALUNO —
 * primeiro o nome exato (sem acento/caixa); o que sobra, pelo nome mais
 * parecido, só se for claramente ele (erro de digitação).
 *
 * Matriculado é o topo da escada: sai de inscrito/pendente/agendada/realizou e
 * das listas e campanhas da Seletiva, e o selo de resultado é apagado. Nenhum
 * script da Seletiva o rebaixa depois.
 *
 * Rode:  npx tsx scripts/seletiva-matriculados.ts [planilhas ou pastas] [--dry-run]
 *   sem planilhas → lê tudo de data/matriculados/ (fora do git: dado pessoal)
 *
 * Imprime SÓ o resumo. Os pares casados por semelhança vão para
 * data/matriculados/_revisar-nomes.csv, pra conferir à mão.
 */
import { writeFileSync } from "node:fs";
import { getSupabase, isSupabaseEnabled } from "../src/db/supabase-client";
import { readSheets } from "./seletiva/read-sheet";
import { expandFiles, norm } from "./seletiva/resultado-alunos";
import { extractPhoneKeys, pickPhoneColumns, phoneKey, nomeSimilaridade, type SeletivaContact } from "../src/kb/seletiva-match";

const DEFAULT_DIR = "data/matriculados";
const INSCRICAO_DIRS = ["data/seletiva", "data/seletiva-agendada"];
const REVISAR = "data/matriculados/_revisar-nomes.csv";
const PAGE = 1000;
const CHUNK = 300;
// Semelhança mínima pro erro de digitação, e a folga sobre o segundo mais
// parecido (dois alunos parecidos = não arrisca).
const NOME_MIN = 0.9;
const NOME_MARGEM = 0.05;
const fmt = (n: number) => n.toLocaleString("pt-BR");

async function pageAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

// Nomes dos alunos matriculados (coluna NOME_ALUNO, ou a primeira "nome…aluno").
function lerMatriculados(files: string[]): string[] {
  const nomes = new Set<string>();
  for (const f of files) {
    let sheets;
    try { sheets = readSheets(f); } catch (e: any) { console.error(`⚠ ${e.message}`); continue; }
    for (const { name, rows } of sheets) {
      if (rows.length < 2) continue;
      const head = rows[0].map(norm);
      const i = head.findIndex((h) => h === "nome_aluno" || (h.includes("nome") && h.includes("aluno")));
      if (i < 0) { console.log(`⚠ ${name}: não achei a coluna do nome do aluno`); continue; }
      let n = 0;
      for (const r of rows.slice(1)) { const v = norm(r[i]); if (v) { nomes.add(v); n++; } }
      console.log(`📄 ${name}: [${rows[0][i]}] · ${fmt(n)} alunos`);
    }
  }
  return [...nomes];
}

// Inscrições: nome do aluno → telefones do responsável.
function indexarInscricoes(): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>();
  for (const f of expandFiles(INSCRICAO_DIRS, "")) {
    let sheets;
    try { sheets = readSheets(f); } catch { continue; }
    for (const { rows } of sheets) {
      if (rows.length < 2) continue;
      const { headerRow, columns } = pickPhoneColumns(rows);
      if (!columns.length) continue;
      const head = rows[headerRow].map(norm);
      const iNome = head.findIndex((h) => h.includes("nome") && (h.includes("aluno") || h.includes("candidato")) && !h.startsWith("pontos") && !h.startsWith("comentarios"));
      if (iNome < 0) continue;
      for (const r of rows.slice(headerRow + 1)) {
        const nome = norm(r[iNome]);
        const tels = columns.flatMap((c) => extractPhoneKeys(r[c]));
        if (!nome || !tels.length) continue;
        const s = idx.get(nome) || new Set<string>();
        tels.forEach((t) => s.add(t));
        idx.set(nome, s);
      }
    }
  }
  return idx;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const files = expandFiles(argv.filter((a) => !a.startsWith("--")), DEFAULT_DIR).filter((f) => !f.includes("_revisar"));

  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase não configurado (.env sem SUPABASE_URL/ANON_KEY).");
    process.exit(1);
  }
  const sb = getSupabase();

  // 1. Matriculados × inscrições, pelo nome do aluno.
  const matriculados = lerMatriculados(files);
  const idx = indexarInscricoes();
  const inscritos = [...idx.keys()];
  const keys = new Set<string>();
  const usados = new Set<string>();
  let exato = 0;
  const parecidos: [string, string, number][] = [];
  for (const nome of matriculados) {
    if (idx.has(nome)) { exato++; usados.add(nome); idx.get(nome)!.forEach((k) => keys.add(k)); continue; }
    const ranking = inscritos.map((f) => ({ f, s: nomeSimilaridade(nome, f) })).sort((a, b) => b.s - a.s);
    const [best, second] = ranking;
    if (best && best.s >= NOME_MIN && best.s - (second?.s ?? 0) >= NOME_MARGEM && !usados.has(best.f)) {
      usados.add(best.f);
      parecidos.push([nome, best.f, best.s]);
      idx.get(best.f)!.forEach((k) => keys.add(k));
    }
  }
  // Mesmo telefone com outro filho inscrito que NÃO está na lista de matriculados.
  const comIrmao = new Set<string>();
  for (const [nome, tels] of idx) if (!usados.has(nome)) tels.forEach((k) => keys.has(k) && comIrmao.add(k));

  // 2. Contatos do CRM.
  const contacts = await pageAll<SeletivaContact>((a, b) =>
    sb.from("contacts").select("wa_id, seletiva_status").order("wa_id").range(a, b)
  );
  const toMatriculado: string[] = [];
  const antes: Record<string, number> = {};
  const achados = new Set<string>();
  let jaEra = 0;
  for (const c of contacts) {
    const k = phoneKey(c.wa_id);
    if (!k || !keys.has(k)) continue;
    achados.add(k);
    if (c.seletiva_status === "matriculado") { jaEra++; continue; }
    toMatriculado.push(c.wa_id);
    const s = c.seletiva_status || "sem status";
    antes[s] = (antes[s] || 0) + 1;
  }

  // 3. Grava.
  if (!dryRun) {
    const now = Date.now();
    for (let i = 0; i < toMatriculado.length; i += CHUNK) {
      const { error } = await sb.from("contacts")
        .update({ seletiva_status: "matriculado", seletiva_at: now, seletiva_resultado: null })
        .in("wa_id", toMatriculado.slice(i, i + CHUNK));
      if (error) throw error;
    }
  }
  writeFileSync(REVISAR, "﻿matriculado;inscricao;semelhanca\n" +
    parecidos.map(([a, b, s]) => `${a};${b};${s.toFixed(2)}`).join("\n"));

  const vieram = Object.entries(antes).map(([s, n]) => `${fmt(n)} ${s}`).join(", ") || "nenhum";
  console.log("");
  console.log(`✅ Matriculados — resumo${dryRun ? " (DRY-RUN: nada foi gravado)" : ""}`);
  console.log(`   Alunos matriculados: ${fmt(matriculados.length)} · inscrições da Seletiva lidas: ${fmt(inscritos.length)} alunos`);
  console.log(`   Achados na Seletiva pelo nome: ${fmt(exato + parecidos.length)} (exato ${fmt(exato)} · parecido ${fmt(parecidos.length)} → ${REVISAR})`);
  console.log(`   Telefones desses alunos: ${fmt(keys.size)} · no CRM: ${fmt(achados.size)} · fora do CRM: ${fmt(keys.size - achados.size)}`);
  console.log(`   ${dryRun ? "Virariam" : "Viraram"} matriculado: ${fmt(toMatriculado.length)} (antes: ${vieram}) · já eram: ${fmt(jaEra)}`);
  console.log(`   Telefones com outro filho inscrito que não está na lista: ${fmt(comIrmao.size)}`);
}

main().catch((e) => {
  console.error("❌ Erro:", e?.message || e);
  process.exit(1);
});
