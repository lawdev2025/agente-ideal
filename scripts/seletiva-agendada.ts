/**
 * Planilha de AGENDADOS da Seletiva ("Exame de Acesso - Seletivas Agendadas")
 * → contacts.seletiva_status = "agendada" ("Seletivas agendadas" no CRM).
 *
 * Todo contato achado na planilha vira agendada, inclusive quem era pendente
 * ou inscrito: a lista é de quem tem teste marcado agora. Só "realizou" (fez a
 * prova) nunca é rebaixado.
 *
 * Rode:  npx tsx scripts/seletiva-agendada.ts [planilhas ou pastas] [--dry-run] [--coluna=trecho]
 *   sem planilhas → lê tudo de data/seletiva-agendada/ (fora do git: dado pessoal)
 *   NÃO ponha esses arquivos em data/seletiva/: lá o seletiva-import marcaria inscrito.
 *
 * Telefone da planilha sem contato no CRM (nunca falou no WhatsApp) vira
 * contato novo já como agendada, pra a tag e as campanhas alcançarem todo
 * mundo da lista. Criar contato NÃO manda mensagem nem gasta nada.
 *
 * Imprime SÓ o resumo — nenhuma linha de planilha, nenhum telefone.
 */
import { readdirSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { getSupabase, isSupabaseEnabled } from "../src/db/supabase-client";
import { readSheets } from "./seletiva/read-sheet";
import { extractPhoneKeys, pickPhoneColumns, phoneKey, leadWaId, type SeletivaContact } from "../src/kb/seletiva-match";

const DEFAULT_DIR = "data/seletiva-agendada";
const SHEET_EXT = new Set([".xlsx", ".xlsm", ".csv"]);
const PAGE = 1000;
const CHUNK = 300;

const fmt = (n: number) => n.toLocaleString("pt-BR");

function expandFiles(targets: string[]): string[] {
  const files: string[] = [];
  for (const t of targets.length ? targets : [DEFAULT_DIR]) {
    if (!existsSync(t)) { console.error(`⚠ não encontrei: ${t}`); continue; }
    if (statSync(t).isDirectory()) {
      for (const f of readdirSync(t)) {
        if (SHEET_EXT.has(extname(f).toLowerCase()) && !f.startsWith("~$")) files.push(join(t, f));
      }
    } else files.push(t);
  }
  return files;
}

async function pageAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const coluna = argv.find((a) => a.startsWith("--coluna="))?.slice("--coluna=".length);
  const files = expandFiles(argv.filter((a) => !a.startsWith("--")));

  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase não configurado (.env sem SUPABASE_URL/ANON_KEY).");
    process.exit(1);
  }
  const sb = getSupabase();

  // 1. Planilhas → chaves de telefone.
  const keys = new Set<string>();
  for (const file of files) {
    let sheets;
    try { sheets = readSheets(file); } catch (e: any) { console.error(`⚠ ${e.message}`); continue; }
    let lidas = 0;
    for (const { name, rows } of sheets) {
      if (rows.length < 2) continue;
      const { headerRow, columns } = pickPhoneColumns(rows, coluna);
      if (!columns.length) { console.log(`⚠ ${name}: não achei coluna de telefone (use --coluna=trecho do nome)`); continue; }
      const antes = keys.size;
      let linhas = 0;
      for (const row of rows.slice(headerRow + 1)) {
        const ks = columns.flatMap((c) => extractPhoneKeys(row[c]));
        if (ks.length) linhas++;
        ks.forEach((k) => keys.add(k));
      }
      const nomes = columns.map((c) => rows[headerRow]?.[c] || `coluna ${c + 1}`).join(", ");
      console.log(`📄 ${name}: [${nomes}] · ${fmt(linhas)} linhas com telefone · +${fmt(keys.size - antes)} novos`);
      lidas++;
    }
    if (!lidas) console.log(`⚠ ${file}: nenhuma aba com telefone lida — formato inesperado (salve de novo como .xlsx ou .csv)`);
  }

  // 2. Contatos do CRM que estão na planilha.
  const contacts = await pageAll<SeletivaContact>((a, b) =>
    sb.from("contacts").select("wa_id, seletiva_status").order("wa_id").range(a, b)
  );
  const matched = new Set<string>();
  const toAgendada: string[] = [];
  const antes: Record<string, number> = {};
  let realizou = 0;
  for (const c of contacts) {
    const k = phoneKey(c.wa_id);
    if (!k || !keys.has(k)) continue;
    matched.add(k);
    if (c.seletiva_status === "realizou") { realizou++; continue; }
    if (c.seletiva_status === "agendada") continue;
    toAgendada.push(c.wa_id);
    const s = c.seletiva_status || "sem status";
    antes[s] = (antes[s] || 0) + 1;
  }

  // 3. Grava.
  const novos = [...keys].filter((k) => !matched.has(k)).map(leadWaId).filter((w): w is string => Boolean(w));
  let criados = 0;
  if (!dryRun) {
    const now = Date.now();
    for (let i = 0; i < novos.length; i += CHUNK) {
      const linhas = novos.slice(i, i + CHUNK).map((wa_id) => ({ wa_id, seletiva_status: "agendada", seletiva_at: now }));
      // ignoreDuplicates: rodar duas vezes não explode nem sobrescreve contato existente.
      const { error, count } = await sb.from("contacts")
        .upsert(linhas, { onConflict: "wa_id", ignoreDuplicates: true, count: "exact" });
      if (error) throw error;
      criados += count ?? linhas.length;
    }
    for (let i = 0; i < toAgendada.length; i += CHUNK) {
      const { error } = await sb.from("contacts")
        .update({ seletiva_status: "agendada", seletiva_at: now })
        .in("wa_id", toAgendada.slice(i, i + CHUNK))
        // Trava no banco também: quem fez a prova nunca volta pra agendada.
        .or("seletiva_status.is.null,seletiva_status.neq.realizou");
      if (error) throw error;
    }
  }

  const vieram = Object.entries(antes).map(([s, n]) => `${fmt(n)} ${s}`).join(", ") || "nenhum";
  console.log("");
  console.log(`✅ Seletivas agendadas — resumo${dryRun ? " (DRY-RUN: nada foi gravado)" : ""}`);
  console.log(`   Planilhas: ${files.length} arquivo(s) · ${fmt(keys.size)} telefones únicos`);
  console.log(`   Achados no CRM: ${fmt(matched.size)} · já eram agendada: ${fmt(matched.size - toAgendada.length - realizou)}`);
  console.log(`   Marcados agendada agora: ${fmt(toAgendada.length)} (antes: ${vieram})`);
  console.log(`   Mantidos como "realizou" (já fizeram a prova): ${fmt(realizou)}`);
  console.log(`   Nunca falaram no WhatsApp: ${fmt(keys.size - matched.size)} → ${dryRun ? `criaria ${fmt(novos.length)}` : `criados agora ${fmt(criados)}`} contato(s) como agendada`);
}

main().catch((e) => {
  console.error("❌ Erro:", e?.message || e);
  process.exit(1);
});
