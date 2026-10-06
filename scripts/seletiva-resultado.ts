/**
 * Marca quem RECEBEU o resultado da Seletiva: cruza a lista de entrega
 * (N° | NOME DO ALUNO | SÉRIE | EVIDÊNCIA) com a planilha de resultado (quem
 * fez a prova, data/seletiva-presenca/) e grava contacts.seletiva_resultado:
 *   recebeu     → selo "Resultado recebido"
 *   nao_recebeu → selo "Resultado não recebido" (fez a prova e não está na lista)
 * Os nomes da lista são digitados à mão: o cruzamento aceita erro de digitação
 * (casarRecebidos em src/kb/seletiva-match.ts). O telefone vem das inscrições,
 * igual ao seletiva-presenca.ts. Rode o presenca ANTES (ele marca "realizou").
 *
 * Rode:  npx tsx scripts/seletiva-resultado.ts [planilhas ou pastas] [--dry-run]
 *   sem planilhas → lê data/seletiva-resultado/ (fora do git: dado pessoal)
 *
 * Imprime SÓ o resumo — nenhuma linha de planilha, nenhum telefone.
 */
import { getSupabase, isSupabaseEnabled } from "../src/db/supabase-client";
import { readSheets } from "./seletiva/read-sheet";
import { expandFiles, lerResultado, indexarInscricoes, norm } from "./seletiva/resultado-alunos";
import { casarRecebidos, decideResultado, type SeletivaContact } from "../src/kb/seletiva-match";

const DEFAULT_DIR = "data/seletiva-resultado";
const PRESENCA_DIR = "data/seletiva-presenca";
const PAGE = 1000;
const CHUNK = 300;
const fmt = (n: number) => n.toLocaleString("pt-BR");

// Lista de entrega: a coluna "NOME DO ALUNO" pode estar abaixo de um título.
// Só conta linha numerada (o N°), o que pula o "TOTAL QUE RECEBEU…" do rodapé.
function lerRecebidos(files: string[]): string[] {
  const nomes = new Set<string>();
  for (const file of files) {
    let sheets;
    try { sheets = readSheets(file); } catch (e: any) { console.error(`⚠ ${e.message}`); continue; }
    for (const { rows } of sheets) {
      const h = rows.findIndex((r) => r.some((c) => norm(c).startsWith("nome do aluno")));
      if (h < 0) continue;
      const iNome = rows[h].findIndex((c) => norm(c).startsWith("nome do aluno"));
      for (const r of rows.slice(h + 1)) {
        const nome = norm(r[iNome]);
        if (nome && /^\d+$/.test(String(r[0] ?? "").trim())) nomes.add(nome);
      }
    }
  }
  return [...nomes];
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
  const files = expandFiles(argv.filter((a) => !a.startsWith("--")), DEFAULT_DIR);

  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase não configurado (.env sem SUPABASE_URL/ANON_KEY).");
    process.exit(1);
  }
  const receberam = lerRecebidos(files);
  if (!receberam.length) { console.error(`❌ nenhuma lista de quem recebeu em ${DEFAULT_DIR} (coluna "NOME DO ALUNO").`); process.exit(1); }
  const fizeram = lerResultado(expandFiles([], PRESENCA_DIR));
  if (!fizeram) { console.error(`❌ nenhuma planilha de resultado em ${PRESENCA_DIR}.`); process.exit(1); }
  const sb = getSupabase();

  // 1. Nomes: lista de entrega × quem fez a prova.
  const m = casarRecebidos([...new Set(fizeram.map((a) => a.nome))], receberam);
  console.log(`📄 lista de entrega: ${fmt(receberam.length)} alunos · fizeram a prova: ${fmt(fizeram.length)}`);
  console.log(`   → casados pelo nome exato: ${fmt(receberam.length - m.porDigitacao.length - m.foraDaProva.length)} · por erro de digitação: ${fmt(m.porDigitacao.length)} · fora da planilha de resultado: ${fmt(m.foraDaProva.length)}`);

  // 2. Alunos → telefones (pelas inscrições).
  const { telefones } = indexarInscricoes(fizeram);
  const recebeuKeys = new Set<string>();
  const naoRecebeuKeys = new Set<string>();
  let semTelRecebeu = 0, semTelNao = 0;
  for (const a of fizeram) {
    const recebeu = m.recebeu.has(a.nome);
    const { keys } = telefones(a);
    if (!keys.size) { recebeu ? semTelRecebeu++ : semTelNao++; continue; }
    keys.forEach((k) => (recebeu ? recebeuKeys : naoRecebeuKeys).add(k));
  }
  console.log(`   alunos que receberam: ${fmt(m.recebeu.size)} · não receberam: ${fmt(fizeram.length - m.recebeu.size)}` +
    ` (sem telefone na inscrição: ${fmt(semTelRecebeu)} / ${fmt(semTelNao)})`);

  // 3. Contatos do CRM e decisão.
  const contacts = await pageAll<SeletivaContact & { seletiva_resultado: string | null }>((a, b) =>
    sb.from("contacts").select("wa_id, seletiva_status, seletiva_resultado").order("wa_id").range(a, b)
  );
  const d = decideResultado(contacts, recebeuKeys, naoRecebeuKeys);

  // 4. Grava.
  if (!dryRun) {
    for (const [valor, ids] of [["recebeu", d.toRecebeu], ["nao_recebeu", d.toNaoRecebeu]] as const) {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { error } = await sb.from("contacts").update({ seletiva_resultado: valor }).in("wa_id", ids.slice(i, i + CHUNK));
        if (error) throw error;
      }
    }
  }

  // 5. Resumo (contagem final lida do banco).
  const conta = async (v: string) =>
    (await sb.from("contacts").select("*", { count: "exact", head: true }).eq("seletiva_resultado", v)).count ?? 0;
  console.log(`\n${dryRun ? "🔎 DRY-RUN (nada gravado)" : "✅ Gravado"}`);
  console.log(`   Mudando agora: ${fmt(d.toRecebeu.length)} → recebeu · ${fmt(d.toNaoRecebeu.length)} → não recebeu`);
  if (!dryRun) {
    const [rec, nao] = await Promise.all([conta("recebeu"), conta("nao_recebeu")]);
    console.log(`   No banco agora: ${fmt(rec)} contatos receberam o resultado · ${fmt(nao)} não receberam`);
  }
}

main().catch((e) => { console.error("❌", e?.message || e); process.exit(1); });
