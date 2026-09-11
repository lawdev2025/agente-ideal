/**
 * Leitor mínimo de planilha (.xlsx e .csv) sem dependência: um .xlsx é um zip
 * de XML, e o Node já traz o inflate. Devolve só texto célula a célula — sem
 * fórmula, estilo ou data — que é tudo que o cruzamento de telefones precisa.
 * Não lê o .xls antigo (binário): salve como .xlsx ou .csv.
 */
import { readFileSync } from "node:fs";
import { extname, basename } from "node:path";
import { inflateRawSync } from "node:zlib";

export interface Sheet {
  name: string;
  rows: string[][];
}

export function readSheets(path: string): Sheet[] {
  const ext = extname(path).toLowerCase();
  if (ext === ".csv" || ext === ".txt") return [{ name: basename(path), rows: parseCsv(decode(readFileSync(path))) }];
  if (ext === ".xlsx" || ext === ".xlsm") return readXlsx(path);
  throw new Error(`${basename(path)}: formato ${ext || "?"} não suportado — salve como .xlsx ou .csv`);
}

// CSV do Excel em PT-BR costuma sair em Windows-1252; UTF-8 inválido denuncia.
function decode(buf: Buffer): string {
  const utf8 = buf.toString("utf8").replace(/^﻿/, "");
  return utf8.includes("�") ? buf.toString("latin1") : utf8;
}

function parseCsv(text: string): string[][] {
  const firstLine = text.slice(0, text.indexOf("\n") >>> 0);
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function unzip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("arquivo não é um .xlsx válido");
  const files = new Map<string, Buffer>();
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && buf.readUInt32LE(p) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    // O cabeçalho local tem os próprios tamanhos de nome/extra.
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    files.set(name, method === 8 ? inflateRawSync(data) : data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === "#"
      ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
      : ENTITIES[e] ?? m
  );
}
function textOf(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)) out += m[1];
  return unescapeXml(out);
}

function colIndex(ref: string): number {
  const letters = ref.replace(/\d+$/, "");
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readXlsx(path: string): Sheet[] {
  const files = unzip(readFileSync(path));
  const shared: string[] = [];
  const sst = files.get("xl/sharedStrings.xml")?.toString("utf8");
  if (sst) for (const m of sst.matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)) shared.push(textOf(m[1]));

  const sheetNames = [...files.keys()]
    .filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));

  return sheetNames.map((f) => {
    const xml = files.get(f)!.toString("utf8");
    const rows: string[][] = [];
    // Tags com prefixo opcional: há exportadores que gravam <x:row>, <x:c>…
    for (const rm of xml.matchAll(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
      const row: string[] = [];
      for (const cm of rm[1].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
        const attrs = cm[1];
        const inner = cm[2] || "";
        const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
        const type = attrs.match(/\bt="(\w+)"/)?.[1];
        const v = inner.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1] ?? "";
        let value: string;
        if (type === "s") value = shared[Number(v)] ?? "";
        else if (type === "inlineStr") value = textOf(inner);
        else if (/e/i.test(v) && Number.isFinite(Number(v))) value = Number(v).toFixed(0); // número gravado em notação científica
        else value = unescapeXml(v);
        row[ref ? colIndex(ref) : row.length] = value;
      }
      rows.push(Array.from(row, (c) => c ?? ""));
    }
    return { name: `${basename(path)} › ${basename(f, ".xml")}`, rows };
  });
}
