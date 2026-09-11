/**
 * Cruza as planilhas de inscritos da Seletiva com os contatos do CRM e grava
 * contacts.seletiva_status:
 *   - inscrito → telefone achado em alguma planilha
 *   - pendente → falou de Seletiva ou recebeu o link, e não está na planilha
 * Regras em src/kb/seletiva-match.ts. Inscrito nunca é rebaixado.
 *
 * Rode:  npx tsx scripts/seletiva-import.ts [planilhas ou pastas] [--dry-run] [--coluna=trecho]
 *   sem planilhas → lê tudo de data/seletiva/ (fora do git: dado pessoal)
 *   --dry-run     → mostra o resumo sem gravar nada
 *   --coluna=zap  → força as colunas de telefone pelo trecho do nome
 *
 * Imprime SÓ o resumo — nenhuma linha de planilha, nenhum telefone. É isso
 * que deixa o comando rápido quando quem roda é o Claude: ele lê 10 linhas
 * de saída em vez de milhares de linhas de planilha.
 * Pré-requisito: public/admin/supabase-contact-seletiva.sql rodado no Supabase.
 */
import { readdirSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { getSupabase, isSupabaseEnabled } from "../src/db/supabase-client";
import { readSheets } from "./seletiva/read-sheet";
import {
  extractPhoneKeys,
  pickPhoneColumns,
  isSeletivaInterestMessage,
  decideSeletivaUpdates,
  type SeletivaContact,
} from "../src/kb/seletiva-match";

const DEFAULT_DIR = "data/seletiva";
const SHEET_EXT = new Set([".xlsx", ".xlsm", ".csv"]);
const PAGE = 1000; // teto do PostgREST por requisição
const CHUNK = 300;

// Pré-filtro barato no banco; a regra de verdade é isSeletivaInterestMessage.
const USER_HINTS = ["selet", "prova de bolsa", "provas de bolsa", "concurso de bolsa", "teste de sele", "prova de sele", "aulão", "aulao"];

type Msg = { wa_id: string; role: string; content: string };

const fmt = (n: number) => n.toLocaleString("pt-BR");

function expandFiles(targets: string[]): string[] {
  const files: string[] = [];
  for (const t of targets.length ? targets : [DEFAULT_DIR]) {
    if (!existsSync(t)) { console.error(`⚠ não encontrei: ${t}`); continue; }
    if (statSync(t).isDirectory()) {
      for (const f of readdirSync(t)) {
        // "~$arquivo.xlsx" é a trava que o Excel cria com a planilha aberta.
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
  const targets = argv.filter((a) => !a.startsWith("--"));
  const files = expandFiles(targets);

  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase não configurado (.env sem SUPABASE_URL/ANON_KEY).");
    process.exit(1);
  }
  const sb = getSupabase();

  // 1. Planilhas → conjunto de chaves de telefone.
  const planilhaKeys = new Set<string>();
  let abas = 0;
  if (!files.length) console.log(`ℹ nenhuma planilha em ${targets.join(", ") || DEFAULT_DIR} — só vou marcar pendentes.`);
  for (const file of files) {
    let sheets;
    try { sheets = readSheets(file); } catch (e: any) { console.error(`⚠ ${e.message}`); continue; }
    // Arquivo que abre mas não rende nenhuma aba passava CALADO (foi assim com
    // um .xlsx de tags <x:row>): o resumo só mostrava "1 aba" para 2 arquivos.
    const abasAntes = abas;
    for (const { name, rows } of sheets) {
      if (rows.length < 2) continue;
      const { headerRow, columns } = pickPhoneColumns(rows, coluna);
      if (!columns.length) { console.log(`⚠ ${name}: não achei coluna de telefone (use --coluna=trecho do nome)`); continue; }
      const antes = planilhaKeys.size;
      let linhas = 0;
      for (const row of rows.slice(headerRow + 1)) {
        const keys = columns.flatMap((c) => extractPhoneKeys(row[c]));
        if (keys.length) linhas++;
        keys.forEach((k) => planilhaKeys.add(k));
      }
      const nomes = columns.map((c) => rows[headerRow]?.[c] || `coluna ${c + 1}`).join(", ");
      console.log(`📄 ${name}: [${nomes}] · ${fmt(linhas)} linhas com telefone · +${fmt(planilhaKeys.size - antes)} novos`);
      abas++;
    }
    if (abas === abasAntes) console.log(`⚠ ${file}: nenhuma aba com telefone lida — formato inesperado (salve de novo como .xlsx ou .csv)`);
  }

  // 2. Contatos do CRM (paginado: sem isso para em 1000).
  let contacts: SeletivaContact[];
  try {
    contacts = await pageAll<SeletivaContact>((a, b) =>
      sb.from("contacts").select("wa_id, seletiva_status").order("wa_id").range(a, b)
    );
  } catch (e: any) {
    if (e?.code !== "42703" && e?.code !== "PGRST204") throw e;
    if (!dryRun) {
      console.error("❌ A coluna seletiva_status não existe. Rode public/admin/supabase-contact-seletiva.sql no SQL Editor do Supabase e tente de novo.");
      process.exit(2);
    }
    console.log("ℹ coluna seletiva_status ainda não existe — dry-run considerando todos sem status.");
    const raw = await pageAll<{ wa_id: string }>((a, b) => sb.from("contacts").select("wa_id").order("wa_id").range(a, b));
    contacts = raw.map((c) => ({ wa_id: c.wa_id, seletiva_status: null }));
  }

  // 3. Quem demonstrou interesse (histórico completo de mensagens).
  const [userMsgs, botMsgs] = await Promise.all([
    pageAll<Msg>((a, b) =>
      sb.from("messages").select("wa_id, role, content").eq("role", "user")
        .or(USER_HINTS.map((h) => `content.ilike.%${h}%`).join(","))
        .order("id").range(a, b)
    ),
    pageAll<Msg>((a, b) =>
      sb.from("messages").select("wa_id, role, content").eq("role", "assistant")
        .ilike("content", "%seletivas2027%")
        .order("id").range(a, b)
    ),
  ]);
  const interessados = new Set(
    [...userMsgs, ...botMsgs].filter((m) => isSeletivaInterestMessage(m.role, m.content)).map((m) => m.wa_id)
  );

  // 4. Decide e grava em lote.
  const d = decideSeletivaUpdates(contacts, planilhaKeys, interessados);
  if (!dryRun) {
    const now = Date.now();
    for (let i = 0; i < d.toInscrito.length; i += CHUNK) {
      const { error } = await sb.from("contacts")
        .update({ seletiva_status: "inscrito", seletiva_at: now })
        .in("wa_id", d.toInscrito.slice(i, i + CHUNK));
      if (error) throw error;
    }
    for (let i = 0; i < d.toPendente.length; i += CHUNK) {
      const { error } = await sb.from("contacts")
        .update({ seletiva_status: "pendente", seletiva_at: now })
        .in("wa_id", d.toPendente.slice(i, i + CHUNK))
        .is("seletiva_status", null); // o webhook pode ter marcado no meio do caminho
      if (error) throw error;
    }
  }

  // 5. Resumo (estado depois da gravação).
  const status = new Map(contacts.map((c) => [c.wa_id, c.seletiva_status]));
  d.toInscrito.forEach((w) => status.set(w, "inscrito"));
  d.toPendente.forEach((w) => status.set(w, "pendente"));
  let inscritos = 0;
  let pendentes = 0;
  for (const s of status.values()) {
    if (s === "inscrito") inscritos++;
    else if (s === "pendente") pendentes++;
  }

  console.log("");
  console.log(`✅ Seletiva — resumo${dryRun ? " (DRY-RUN: nada foi gravado)" : ""}`);
  console.log(`   Planilhas: ${files.length} arquivo(s) · ${abas} aba(s) · ${fmt(planilhaKeys.size)} telefones únicos`);
  console.log(`   Contatos no CRM: ${fmt(contacts.length)}`);
  console.log(`   Inscritos: ${fmt(inscritos)} (novos agora: ${fmt(d.toInscrito.length)})`);
  console.log(`   Pendentes: ${fmt(pendentes)} (novos agora: ${fmt(d.toPendente.length)})`);
  console.log(`   Interessados na Seletiva (inscritos + pendentes): ${fmt(inscritos + pendentes)}`);
  console.log(`   Inscritos na planilha que nunca falaram no WhatsApp: ${fmt(d.planilhaSemWhatsApp)}`);
}

main().catch((e) => {
  console.error("❌ Erro:", e?.message || e);
  process.exit(1);
});
