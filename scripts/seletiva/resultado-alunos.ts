/**
 * Planilha de RESULTADO da Seletiva (POSIÇÃO | IDENTIFICAÇÃO | NOME | …): não
 * tem telefone. O telefone sai das planilhas de INSCRIÇÃO (data/seletiva/),
 * casando pela identificação e, sem ela, pelo nome do aluno.
 * Usado por seletiva-presenca.ts (quem fez a prova) e seletiva-resultado.ts
 * (quem recebeu o resultado).
 */
import { readdirSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { readSheets } from "./read-sheet";
import { extractPhoneKeys, pickPhoneColumns } from "../../src/kb/seletiva-match";

const SHEET_EXT = new Set([".xlsx", ".xlsm", ".csv"]);
const INSCRICAO_DIR = "data/seletiva";

export function expandFiles(targets: string[], defaultDir: string): string[] {
  const files: string[] = [];
  for (const t of targets.length ? targets : [defaultDir]) {
    if (!existsSync(t)) { console.error(`⚠ não encontrei: ${t}`); continue; }
    if (statSync(t).isDirectory()) {
      for (const f of readdirSync(t)) {
        if (SHEET_EXT.has(extname(f).toLowerCase()) && !f.startsWith("~$")) files.push(join(t, f));
      }
    } else files.push(t);
  }
  return files;
}

export const norm = (v: unknown) =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
export const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

export type Aluno = { id: string; nome: string };

// Abas com cabeçalho IDENTIFICAÇÃO + NOME e sem coluna de telefone → lista de
// quem fez a prova. null se o arquivo não for desse tipo.
export function lerResultado(files: string[]): Aluno[] | null {
  const alunos: Aluno[] = [];
  let achou = false;
  for (const file of files) {
    let sheets;
    try { sheets = readSheets(file); } catch { continue; }
    for (const { rows } of sheets) {
      if (rows.length < 2) continue;
      const head = rows[0].map(norm);
      const iId = head.findIndex((h) => h.startsWith("identifica"));
      const iNome = head.findIndex((h) => h === "nome");
      if (iId < 0 || iNome < 0 || pickPhoneColumns(rows).columns.length) continue;
      achou = true;
      for (const r of rows.slice(1)) {
        const nome = norm(r[iNome]);
        if (nome) alunos.push({ id: soDigitos(r[iId]), nome });
      }
    }
  }
  return achou ? alunos : null;
}

/** Índice das inscrições: telefones por identificação e por nome do aluno. */
export function indexarInscricoes(alunos: Aluno[]) {
  const ids = new Set(alunos.map((a) => a.id).filter(Boolean));
  const porIdx = new Map<string, Set<string>>(); // identificação → telefones
  const porNomeIdx = new Map<string, Set<string>>(); // nome do aluno → telefones
  const colunasId = new Set<string>();
  const add = (m: Map<string, Set<string>>, k: string, tels: string[]) => {
    if (!k || !tels.length) return;
    const s = m.get(k) || new Set<string>();
    tels.forEach((t) => s.add(t));
    m.set(k, s);
  };
  for (const f of expandFiles([], INSCRICAO_DIR)) {
    let sheets;
    try { sheets = readSheets(f); } catch { continue; }
    for (const { name, rows } of sheets) {
      if (rows.length < 2) continue;
      const { headerRow, columns } = pickPhoneColumns(rows);
      if (!columns.length) continue;
      const head = rows[headerRow].map(norm);
      const corpo = rows.slice(headerRow + 1);
      // Coluna de identificação = a que mais coincide com as identificações do
      // resultado (descoberta pelos dados, sem depender do nome da coluna).
      const iId = head.map((_, c) => corpo.filter((r) => ids.has(soDigitos(r[c]))).length)
        .reduce((best, n, c, arr) => (n > (arr[best] || 0) ? c : best), -1);
      if (iId >= 0) colunasId.add(`${name.split("›").pop()!.trim()} › ${rows[headerRow][iId]}`);
      // Nome do ALUNO (não do responsável): "Nome do aluno(a)" ou "CANDIDATO_NOME".
      const iNome = head.findIndex((h) => (h.includes("nome") && (h.includes("aluno") || h.includes("candidato"))) && !h.startsWith("pontos") && !h.startsWith("comentarios"));
      for (const r of corpo) {
        const tels = columns.flatMap((c) => extractPhoneKeys(r[c]));
        if (iId >= 0) add(porIdx, soDigitos(r[iId]), tels);
        if (iNome >= 0) add(porNomeIdx, norm(r[iNome]), tels);
      }
    }
  }
  // Telefones do aluno: pela identificação; sem ela, pelo nome.
  const telefones = (a: Aluno): { via: "id" | "nome" | null; keys: Set<string> } => {
    const t = (a.id && porIdx.get(a.id)) || null;
    if (t) return { via: "id", keys: t };
    const n = porNomeIdx.get(a.nome);
    if (n) return { via: "nome", keys: n };
    return { via: null, keys: new Set() };
  };
  return { telefones, colunasId: [...colunasId] };
}
