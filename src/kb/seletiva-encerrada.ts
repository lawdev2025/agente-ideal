/**
 * SELETIVA IDEAL 2027 — ENCERRADA.
 *
 * As inscrições fecharam em 25/09/2026. Pedido do dono: todo assunto de
 * Seletiva se resume a duas respostas fixas, sem LLM —
 *   - resultado        → "encerrada; o resultado sai em 03/10"
 *   - qualquer outra   → "encerrada; fique de olho, vamos abrir o agendamento
 *                        de um teste pra quem não pôde participar"
 * e quem cai na segunda ganha o status "agendada" (selo "Seletivas agendadas"
 * no painel): é o público que vai receber o aviso quando o agendamento abrir.
 *
 * Os fluxos antigos (link de inscrição, taxa, edital, experimentais) ficam no
 * orquestrador atrás de config.seletivaEncerrada — SELETIVA_ENCERRADA=false
 * religa tudo na próxima edição.
 */

export const SELETIVA_RESULTADO_DATA = "03/10";

// Pergunta de RESULTADO: nota, aprovação, classificação, lista, gabarito.
// "saiu"/"sai quando" só contam junto de um desses — sozinhos são genéricos.
const RESULTADO_SIGNAL =
  /(resultad|aprovad|classificad|classifica[çc][ãa]o|\bnotas?\b|gabarito|\blista\b|ranking|\bpassou\b|\bpassei\b|\bpassaram\b)/i;

export function isSeletivaResultadoQuestion(text: string): boolean {
  return RESULTADO_SIGNAL.test(text || "");
}

export const SELETIVA_ENCERRADA_RESULTADO_REPLY =
  "A *Seletiva Ideal 2027* já foi encerrada. 🏆\n\n" +
  `📋 O *resultado* será divulgado no dia *${SELETIVA_RESULTADO_DATA}*. Fique de olho!`;

// ── DIA DA PROVA (26/09/2026) ───────────────────────────────────────────────
// Até a prova terminar, quem já se inscreveu ainda tem dúvida de logística
// (portão, documento, caneta...). Regras tiradas dos 3 editais (regular 4.5–
// 4.24, Jr 4.9–4.20, Militar 4/5.1–5.13). Depois do fim da prova mais longa
// (militar, 18h de Belém = 21h UTC) essa resposta some sozinha e tudo volta
// pro "encerrada".
export const SELETIVA_PROVA_FIM_MS = Date.parse("2026-09-26T21:00:00Z");

// Chegou tarde / quer se inscrever: ganha do dia da prova, porque "ainda dá
// pra fazer a prova amanhã?" é de quem NÃO está inscrito.
const ATRASADO_SIGNAL =
  /(me\s+inscrever|se\s+inscrever|fazer\s+(a\s+)?inscri|ainda\s+(d[áa]|posso|tem\s+como)|\bprazo\b|perdi\s+(o\s+prazo|a\s+inscri)|cheguei\s+tarde|n[ãa]o\s+consegui\s+(me\s+|se\s+)?inscrev|n[ãa]o\s+deu\s+tempo|encerr|fech(ou|aram)\s+as\s+inscri|inscri[çc][õo]es|sem\s+inscri|n[ãa]o\s+(me\s+|se\s+)?inscrevi)/i;

export function isSeletivaAtrasadoQuestion(text: string): boolean {
  return ATRASADO_SIGNAL.test(text || "");
}

// Logística do dia da prova. "prova de bolsa" (nome da campanha) não conta.
const PROVA_DIA_SIGNAL =
  /(port[ãa]o|port[õo]es|hor[áa]rio|que\s+horas|\bhoras?\b|come[çc]a|termina|\bdura|documento|\brg\b|identidade|levar|trazer|caneta|l[áa]pis|calculadora|celular|\blocal\b|\bonde\b|endere[çc]o|amanh[ãa]|s[áa]bado|atras|comprovante|cart[ãa]o|ficha|\bsala\b|ensalamento|inscrit[oa]|\bhoje\b|respons[áa]vel|acompanh|paguei|pagamento|\btaxa\b|e-?mail|\bprova\b(?!s?\s+de\s+bolsa))/i;

export function isSeletivaProvaDiaQuestion(text: string): boolean {
  return PROVA_DIA_SIGNAL.test(text || "");
}

// Dúvida de dia de prova SEM citar a Seletiva ("o que é preciso levar?", "é até
// que horas a prova?", "não consegui o cartão de inscrição"). Só vale com
// contexto: a Seletiva nos últimos turnos (campanha inclusa) ou "prova" +
// "inscrito/inscrição" na própria frase. Lista mais estreita que a de cima:
// "taxa", "onde", "e-mail" sozinhos são de matrícula/secretaria também.
const PROVA_DIA_SEM_NOME_SIGNAL =
  /(\bprova\b|\bsala\b|ensalamento|levar|documento|\brg\b|identidade|caneta|port[ãa]o|port[õo]es|cart[ãa]o\s+de\s+inscri|ficha\s+de\s+inscri|comprovante|inscri[çc][ãa]o|inscrit[oa]|que\s+horas|hor[áa]rio|calculadora)/i;
const PROVA_E_INSCRICAO = /\bprova\b[\s\S]*inscri|inscri[\s\S]*\bprova\b/i;

export function isSeletivaProvaDiaSemNome(text: string, seletivaNoContexto: boolean): boolean {
  const t = text || "";
  if (!PROVA_DIA_SEM_NOME_SIGNAL.test(t)) return false;
  return seletivaNoContexto || PROVA_E_INSCRICAO.test(t);
}

export const SELETIVA_PROVA_DIA_REPLY =
  "📝 *Prova da Seletiva Ideal 2027 — sábado, 26/09*\n\n" +
  "🚪 *Portões:* abrem às *13h* e fecham às *13h55* em ponto. Depois disso, ninguém entra.\n" +
  "⏰ *Prova:* das *14h às 17h* (turmas militares: das 14h às 18h).\n" +
  "📍 *Local:* na *unidade em que a inscrição foi feita* (turmas militares: *Augusto Montenegro*).\n" +
  "🏫 *Sala:* não precisa saber antes. Na chegada, o nosso time indica a sala de cada aluno.\n\n" +
  "🪪 *O que levar:*\n" +
  "• Um *documento de identificação* do aluno (o RG, por exemplo). Não precisa de ficha, cartão nem comprovante de inscrição\n" +
  "• *Caneta esferográfica azul ou preta*\n\n" +
  "📵 Celular e eletrônicos ficam *desligados e guardados*, e *calculadora não é permitida*.\n" +
  "👨‍👩‍👧 Os responsáveis não ficam no local da prova.\n\n" +
  `📋 O *resultado* sai no dia *${SELETIVA_RESULTADO_DATA}*. Boa prova! 🍀\n\n` +
  "_Não conseguiu se inscrever? Fique de olho: em breve vamos abrir o agendamento de um teste para quem não pôde participar._";

export const SELETIVA_ENCERRADA_AGENDAMENTO_REPLY =
  "As inscrições da *Seletiva Ideal 2027* já foram encerradas. 🙏\n\n" +
  "Mas fique de olho por aqui: em breve vamos abrir o *agendamento de um teste* " +
  "para quem não conseguiu participar. Assim que abrir, a gente te avisa! 😉";
