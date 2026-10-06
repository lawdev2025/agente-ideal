/**
 * Marca quem FEZ a prova da Seletiva: cruza a planilha de presença/resultado
 * com os contatos do CRM e grava contacts.seletiva_status = "realizou"
 * (selo "Seletivas realizaram"). Quem não está na planilha fica como está —
 * inscrito que não veio continua "inscrito". Regras em src/kb/seletiva-match.ts
 * (decidePresenca). "realizou" nunca é rebaixado pelo seletiva-import.
 *
 * Rode:  npx tsx scripts/seletiva-presenca.ts [planilhas ou pastas] [--dry-run] [--coluna=trecho] [--criar-leads]
 *   sem planilhas → lê tudo de data/seletiva-presenca/ (fora do git: dado pessoal)
 *   --dry-run     → mostra o resumo sem gravar nada
 *   --coluna=tel  → força as colunas de telefone pelo trecho do nome
 *   --criar-leads → quem fez a prova e não tem contato no CRM vira contato já
 *                   como "realizou" (criar contato NÃO manda mensagem)
 *
 * Imprime SÓ o resumo — nenhuma linha de planilha, nenhum telefone.
 */
import { getSupabase, isSupabaseEnabled } from "../src/db/supabase-client";
import { readSheets } from "./seletiva/read-sheet";
import { expandFiles, lerResultado, indexarInscricoes, type Aluno } from "./seletiva/resultado-alunos";
import {
  extractPhoneKeys,
  pickPhoneColumns,
  decidePresenca,
  leadWaId,
  type SeletivaContact,
} from "../src/kb/seletiva-match";

const DEFAULT_DIR = "data/seletiva-presenca";
const PAGE = 1000;
const CHUNK = 300;
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

function resolverPorInscricao(alunos: Aluno[]) {
  const { telefones, colunasId } = indexarInscricoes(alunos);
  const keys = new Set<string>();
  let porId = 0, porNome = 0, semTelefone = 0;
  for (const a of alunos) {
    const t = telefones(a);
    if (t.via === "id") porId++;
    else if (t.via === "nome") porNome++;
    else semTelefone++;
    t.keys.forEach((k) => keys.add(k));
  }
  return { keys, porId, porNome, semTelefone, colunasId };
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const criarLeads = argv.includes("--criar-leads");
  const coluna = argv.find((a) => a.startsWith("--coluna="))?.slice("--coluna=".length);
  const files = expandFiles(argv.filter((a) => !a.startsWith("--")), DEFAULT_DIR);

  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase não configurado (.env sem SUPABASE_URL/ANON_KEY).");
    process.exit(1);
  }
  if (!files.length) { console.error(`❌ nenhuma planilha de presença em ${DEFAULT_DIR}.`); process.exit(1); }
  const sb = getSupabase();

  // 1. Planilha(s) → chaves de telefone de quem fez a prova.
  const presencaKeys = new Set<string>();
  // Planilha de RESULTADO do sistema (POSIÇÃO | IDENTIFICAÇÃO | NOME | …) não
  // tem telefone: o telefone sai das planilhas de INSCRIÇÃO (data/seletiva/),
  // casando pela identificação e, sem ela, pelo nome do aluno.
  const resultado = lerResultado(files);
  if (resultado) {
    const r = resolverPorInscricao(resultado);
    r.keys.forEach((k) => presencaKeys.add(k));
    console.log(`📄 resultado: ${fmt(resultado.length)} alunos que fizeram a prova`);
    console.log(`   → telefone achado pela identificação: ${fmt(r.porId)} · pelo nome: ${fmt(r.porNome)} · sem telefone (não achei na inscrição): ${fmt(r.semTelefone)}`);
    console.log(`   (coluna da inscrição que casou com a identificação: ${r.colunasId.join(", ") || "nenhuma"})`);
  }
  for (const file of resultado ? [] : files) {
    let sheets;
    try { sheets = readSheets(file); } catch (e: any) { console.error(`⚠ ${e.message}`); continue; }
    let lidas = 0;
    for (const { name, rows } of sheets) {
      if (rows.length < 2) continue;
      const { headerRow, columns } = pickPhoneColumns(rows, coluna);
      if (!columns.length) { console.log(`⚠ ${name}: não achei coluna de telefone (use --coluna=trecho do nome)`); continue; }
      const antes = presencaKeys.size;
      let linhas = 0, semTel = 0;
      for (const row of rows.slice(headerRow + 1)) {
        const keys = columns.flatMap((c) => extractPhoneKeys(row[c]));
        if (keys.length) linhas++;
        else if (row.some((v) => String(v ?? "").trim())) semTel++;
        keys.forEach((k) => presencaKeys.add(k));
      }
      const nomes = columns.map((c) => rows[headerRow]?.[c] || `coluna ${c + 1}`).join(", ");
      console.log(`📄 ${name}: [${nomes}] · ${fmt(linhas)} linhas com telefone · ${fmt(semTel)} linhas sem telefone legível · +${fmt(presencaKeys.size - antes)} telefones`);
      lidas++;
    }
    if (!lidas) console.log(`⚠ ${file}: nenhuma aba com telefone lida — formato inesperado (salve de novo como .xlsx ou .csv)`);
  }

  // 2. Contatos do CRM e decisão.
  const contacts = await pageAll<SeletivaContact>((a, b) =>
    sb.from("contacts").select("wa_id, seletiva_status").order("wa_id").range(a, b)
  );
  const d = decidePresenca(contacts, presencaKeys);
  const antes = new Map(contacts.map((c) => [c.wa_id, c.seletiva_status]));
  const deOnde: Record<string, number> = {};
  for (const w of d.toRealizou) {
    const s = antes.get(w) || "sem status";
    deOnde[s] = (deOnde[s] || 0) + 1;
  }

  // 3. Grava.
  if (!dryRun) {
    const now = Date.now();
    for (let i = 0; i < d.toRealizou.length; i += CHUNK) {
      const { error } = await sb.from("contacts")
        .update({ seletiva_status: "realizou", seletiva_at: now })
        .in("wa_id", d.toRealizou.slice(i, i + CHUNK));
      if (error) throw error;
    }
  }
  const novosLeads = criarLeads ? d.semContato.map(leadWaId).filter((w): w is string => Boolean(w)) : [];
  let leadsCriados = 0;
  if (criarLeads && !dryRun && novosLeads.length) {
    const now = Date.now();
    for (let i = 0; i < novosLeads.length; i += CHUNK) {
      const linhas = novosLeads.slice(i, i + CHUNK).map((wa_id) => ({ wa_id, seletiva_status: "realizou", seletiva_at: now }));
      const { error, count } = await sb.from("contacts")
        .upsert(linhas, { onConflict: "wa_id", ignoreDuplicates: true, count: "exact" });
      if (error) throw error;
      leadsCriados += count ?? linhas.length;
    }
  }

  // 4. Resumo (contagem final lida do banco).
  const conta = async (st: string) =>
    (await sb.from("contacts").select("*", { count: "exact", head: true }).eq("seletiva_status", st)).count ?? 0;
  const [realizou, inscrito] = dryRun ? [NaN, NaN] : await Promise.all([conta("realizou"), conta("inscrito")]);

  console.log(`\n${dryRun ? "🔎 DRY-RUN (nada gravado)" : "✅ Gravado"}`);
  console.log(`   Fizeram a prova (telefones únicos na planilha): ${fmt(presencaKeys.size)}`);
  console.log(`   Achados no CRM: ${fmt(d.presentesNoCrm)} · marcados "realizou" agora: ${fmt(d.toRealizou.length)}` +
    (d.toRealizou.length ? ` (antes: ${Object.entries(deOnde).map(([k, v]) => `${v} ${k}`).join(", ")})` : ""));
  console.log(`   Fizeram a prova e não têm contato no CRM: ${fmt(d.semContato.length)}` +
    (criarLeads ? (dryRun ? ` → --criar-leads criaria ${fmt(novosLeads.length)}` : ` → criados agora: ${fmt(leadsCriados)}`) : " (use --criar-leads pra criar)"));
  if (!dryRun) console.log(`   No banco agora: ${fmt(realizou)} realizou · ${fmt(inscrito)} inscritos que NÃO fizeram a prova`);
}

main().catch((e) => { console.error("❌", e?.message || e); process.exit(1); });
