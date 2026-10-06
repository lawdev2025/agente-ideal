/**
 * Cruzamento das planilhas de inscritos da Seletiva com os contatos do CRM.
 *
 * Status da Seletiva por contato (coluna contacts.seletiva_status):
 *   - inscrito → o telefone dele aparece numa planilha de inscrição
 *   - pendente → demonstrou interesse (falou de Seletiva ou recebeu o link)
 *                e não achamos a inscrição
 * "Interessados" no dashboard = inscrito + pendente.
 *
 * Velocidade acima de precisão: a chave de telefone é DDD + últimos 8 dígitos.
 * É o que sobra igual entre o wa_id da Meta (55 + DDD + 8, sem o 9 — ver
 * normalizeBrazilMobile em whatsapp/client.ts) e o que a família digita no
 * formulário, com ou sem 55, 9, parênteses e traço. O preço é colidir fixo
 * com celular de mesmo final, o que é raro o bastante pra ignorar.
 */
import { classifyContactTag } from "./contact-tags";

// Escada (só sobe): vazio → pendente / agendada → inscrito → realizou.
//   agendada → chegou depois do fim das inscrições (bot, 25/09/2026)
//   realizou → fez a prova (planilha de presença, scripts/seletiva-presenca.ts)
export type SeletivaStatus = "inscrito" | "pendente" | "agendada" | "realizou";

// Colégio em Belém/Ananindeua: número digitado sem DDD é daqui.
export const DEFAULT_DDD = "91";

export function phoneKey(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = typeof raw === "number"
    ? (Number.isFinite(raw) ? Math.trunc(raw).toString() : "")
    : String(raw);
  // "9.19889E+10": o Excel já jogou dígitos fora, não dá pra recuperar.
  if (/\de[+-]?\d/i.test(s)) return null;
  let d = s.replace(/\D/g, "").replace(/^0+/, "");
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 10 || d.length === 11) return d.slice(0, 2) + d.slice(-8);
  if (d.length === 8 || d.length === 9) return DEFAULT_DDD + d.slice(-8);
  return null;
}

/**
 * Chave de telefone → wa_id de um contato que ainda não existe.
 *
 * Sai com 12 dígitos (55 + DDD + 8, SEM o 9) de propósito: é o formato que a
 * Meta manda no webhook, e 1.422 dos 1.472 contatos do CRM estão assim. Criar
 * com 13 dígitos faria uma segunda linha nascer pra mesma pessoa no dia em que
 * ela respondesse. Na hora do envio o 9 volta (normalizeBrazilMobile).
 */
export function leadWaId(key: string): string | null {
  return /^\d{10}$/.test(key) ? "55" + key : null;
}

/** Célula pode trazer mais de um telefone: "(91) 9888-7777 / 9999-1111". */
export function extractPhoneKeys(cell: unknown): string[] {
  const parts = String(cell ?? "").split(/\s*(?:\/|;|,|\||\bou\b|\be\b)\s*/i);
  const keys: string[] = [];
  for (const p of parts) {
    const k = phoneKey(p);
    if (k && !keys.includes(k)) keys.push(k);
  }
  return keys;
}

function norm(s: unknown): string {
  return String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

const PHONE_HEADER = /\b(tel|telefone|telefones|fone|celular|cel|whats|whatsapp|zap|contato)\b/;
const NOT_PHONE_HEADER = /(e-?mail|cpf|cnpj|cep|\brg\b|matric|inscri|codigo|\bid\b)/;
const CPF_FORMAT = /^\d{3}\.\d{3}\.\d{3}-\d{2}$/;

/**
 * Descobre em que linha está o cabeçalho e quais colunas têm telefone. As
 * planilhas mudaram de formato no meio do processo, então nada de posição
 * fixa: primeiro pelo nome da coluna, e se nenhum nome ajudar, pelo conteúdo.
 * `override` (flag --coluna) casa por trecho do nome e manda sozinho.
 */
export function pickPhoneColumns(
  rows: unknown[][],
  override?: string
): { headerRow: number; columns: number[] } {
  const scan = Math.min(rows.length, 10);

  for (let r = 0; r < scan; r++) {
    const header = (rows[r] || []).map(norm);
    const cols = header
      .map((h, i) => {
        if (!h) return -1;
        if (override) return h.includes(norm(override)) ? i : -1;
        return PHONE_HEADER.test(h) && !NOT_PHONE_HEADER.test(h) ? i : -1;
      })
      .filter((i) => i >= 0);
    if (cols.length) return { headerRow: r, columns: cols };
  }
  if (override) return { headerRow: 0, columns: [] };

  // Sem nome reconhecível: cabeçalho = primeira linha com 2+ células cheias,
  // e telefone = coluna onde a maioria das células vira chave válida.
  let headerRow = 0;
  for (let r = 0; r < scan; r++) {
    if ((rows[r] || []).filter((c) => norm(c)).length >= 2) { headerRow = r; break; }
  }
  const header = (rows[headerRow] || []).map(norm);
  const body = rows.slice(headerRow + 1, headerRow + 51);
  const width = Math.max(0, ...body.map((row) => row.length));
  const columns: number[] = [];
  for (let c = 0; c < width; c++) {
    if (NOT_PHONE_HEADER.test(header[c] || "")) continue;
    const filled = body.map((row) => String(row[c] ?? "").trim()).filter(Boolean);
    if (!filled.length) continue;
    const phones = filled.filter((v) => !CPF_FORMAT.test(v) && phoneKey(v));
    if (phones.length / filled.length >= 0.6) columns.push(c);
  }
  return { headerRow, columns };
}

/**
 * Mensagem que prova interesse na Seletiva: o cliente falando dela (mesma
 * regra da tag de intenção) ou o bot mandando o link de inscrição. O convite
 * de fim de resposta de matrícula cita a Seletiva sem link — é oferta nossa,
 * não interesse dele, e por isso não conta.
 */
export function isSeletivaInterestMessage(role: string, content: string): boolean {
  if (role === "user") return classifyContactTag(content) === "seletiva";
  if (role === "assistant") return /seletivas2027/i.test(content || "");
  return false;
}

export interface SeletivaContact {
  wa_id: string;
  seletiva_status: string | null;
}

/**
 * Decide quem muda de status. Regras:
 *   - na planilha e ainda não inscrito → inscrito (inclui pendente que se inscreveu)
 *   - interessado, sem status e fora da planilha → pendente
 *   - inscrito nunca é rebaixado, mesmo sumindo da planilha nova
 */
export function decideSeletivaUpdates(
  contacts: SeletivaContact[],
  planilhaKeys: Set<string>,
  interessados: Set<string>
) {
  const toInscrito: string[] = [];
  const toPendente: string[] = [];
  const matched = new Set<string>();
  let inscritosNoCrm = 0;

  for (const c of contacts) {
    const key = phoneKey(c.wa_id);
    if (key && planilhaKeys.has(key)) {
      matched.add(key);
      inscritosNoCrm++;
      // "realizou" está ACIMA de inscrito: reler a planilha de inscrição não
      // pode desfazer a presença na prova.
      if (c.seletiva_status !== "inscrito" && c.seletiva_status !== "realizou") toInscrito.push(c.wa_id);
      continue;
    }
    if (!c.seletiva_status && interessados.has(c.wa_id)) toPendente.push(c.wa_id);
  }

  // Telefone que está na planilha e não tem contato nenhum no CRM. Só contar
  // não bastava: é essa lista que vira contato com --criar-leads, pra a
  // campanha conseguir alcançar quem se inscreveu mas nunca falou no WhatsApp.
  const semContato: string[] = [];
  for (const k of planilhaKeys) if (!matched.has(k)) semContato.push(k);

  return { toInscrito, toPendente, inscritosNoCrm, semContato, planilhaSemWhatsApp: semContato.length };
}

/**
 * Presença na prova (planilha de quem FEZ a Seletiva). Todo contato achado
 * vira "realizou", seja qual for o status atual (inscrito, pendente, agendada
 * ou vazio — a planilha de inscrição pode ter errado o número). Quem não está
 * na lista fica como está: inscrito que não veio continua "inscrito".
 */
export function decidePresenca(contacts: SeletivaContact[], presencaKeys: Set<string>) {
  const toRealizou: string[] = [];
  const matched = new Set<string>();
  let presentesNoCrm = 0;
  for (const c of contacts) {
    const key = phoneKey(c.wa_id);
    if (!key || !presencaKeys.has(key)) continue;
    matched.add(key);
    presentesNoCrm++;
    if (c.seletiva_status !== "realizou") toRealizou.push(c.wa_id);
  }
  const semContato: string[] = [];
  for (const k of presencaKeys) if (!matched.has(k)) semContato.push(k);
  return { toRealizou, presentesNoCrm, semContato };
}

// ── Entrega do resultado (contacts.seletiva_resultado) ─────────────────────
// Dimensão À PARTE da escada: só faz sentido pra quem fez a prova.
//   recebeu     → o aluno está na lista de quem recebeu o resultado
//   nao_recebeu → fez a prova e não está nessa lista
export type SeletivaResultado = "recebeu" | "nao_recebeu";

// Distância de edição normalizada (1 = iguais). Os nomes já chegam normalizados.
export function nomeSimilaridade(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

// Abaixo disso o nome é outro aluno; a margem evita escolher entre dois parecidos.
const NOME_MIN = 0.8;
const NOME_MARGEM = 0.05;

/**
 * Casa a lista de quem RECEBEU o resultado (digitada à mão, com erro de
 * digitação) com quem FEZ a prova. Primeiro pelo nome exato; o que sobra, pelo
 * aluno mais parecido ainda não casado — só se for claramente o mais parecido.
 * Recebe nomes normalizados; devolve o conjunto de nomes de `fizeram` que receberam.
 */
export function casarRecebidos(fizeram: string[], receberam: string[]) {
  const recebeu = new Set<string>();
  const todos = new Set(fizeram);
  const sobra: string[] = [];
  for (const n of receberam) {
    if (todos.has(n)) recebeu.add(n);
    else sobra.push(n);
  }
  const porDigitacao: [string, string][] = [];
  const foraDaProva: string[] = [];
  for (const n of sobra) {
    const ranking = [...todos].filter((f) => !recebeu.has(f))
      .map((f) => ({ f, s: nomeSimilaridade(n, f) }))
      .sort((x, y) => y.s - x.s);
    const [best, second] = ranking;
    if (best && best.s >= NOME_MIN && best.s - (second?.s ?? 0) >= NOME_MARGEM) {
      recebeu.add(best.f);
      porDigitacao.push([n, best.f]);
    } else foraDaProva.push(n);
  }
  return { recebeu, porDigitacao, foraDaProva };
}

/**
 * Decide a tag de resultado por contato. Telefone de aluno que não recebeu
 * vence o de aluno que recebeu (irmãos no mesmo número: ainda falta entregar).
 * Contato "realizou" sem telefone ligado a quem recebeu → nao_recebeu.
 * Só devolve quem muda.
 */
export function decideResultado(
  contacts: (SeletivaContact & { seletiva_resultado?: string | null })[],
  recebeuKeys: Set<string>,
  naoRecebeuKeys: Set<string>,
) {
  const toRecebeu: string[] = [];
  const toNaoRecebeu: string[] = [];
  for (const c of contacts) {
    const key = phoneKey(c.wa_id);
    let alvo: SeletivaResultado | null = null;
    if (key && naoRecebeuKeys.has(key)) alvo = "nao_recebeu";
    else if (key && recebeuKeys.has(key)) alvo = "recebeu";
    else if (c.seletiva_status === "realizou") alvo = "nao_recebeu";
    if (!alvo || c.seletiva_resultado === alvo) continue;
    (alvo === "recebeu" ? toRecebeu : toNaoRecebeu).push(c.wa_id);
  }
  return { toRecebeu, toNaoRecebeu };
}
