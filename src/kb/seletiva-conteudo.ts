/**
 * Pergunta de CONTEÚDO da prova da Seletiva Ideal 2027.
 *
 * Quem pergunta "devo estudar os conteúdos do 9º ou do 1º ano?", "o que cai na
 * seletiva?" ou "onde vejo o edital?" quer o conteúdo programático — e ele está
 * no EDITAL, publicado na página da Seletiva logo abaixo dos botões de
 * inscrição. RAIZ DE BUG: a frase do print não cita "seletiva", cita série
 * ("9 ano", "1 ano do ensino médio"), então caía em matrícula e o bot respondia
 * "Fundamental 1" com valores presenciais.
 *
 * Usado pelo orquestrador (resposta fixa) e pela tag de contato (vira
 * "seletiva", o que marca o contato como pendente na campanha).
 */
import { isMilitarInterest } from "../worker/intent-router";

// Sinais que sozinhos já são pergunta de conteúdo/edital.
const CONTEUDO_DIRETO =
  /(\bedital\b|conte[úu]do\s+program[áa]tico|\bo\s+que\s+(?:vai\s+|v[ãa]o\s+)?(?:cai|caem|cair)\b|\bquais?\s+(?:s[ãa]o\s+)?(?:os\s+|as\s+)?(?:assuntos?|conte[úu]dos?|mat[ée]rias?)\s+(?:que\s+)?(?:vai\s+|v[ãa]o\s+)?(?:cai|caem|cair)\b|\bo\s+que\s+(?:eu\s+|ele\s+|ela\s+)?(?:devo\s+|deve\s+|preciso\s+|precisa\s+|tenho\s+que\s+|tem\s+que\s+)?estudar\b)/i;

const CONTEUDO = /\bconte[úu]dos?\b/i;
const ASSUNTO_OU_MATERIA = /\b(assuntos?|mat[ée]rias?)\b/i;
const CONTEXTO_PROVA = /(\bestud(?:ar|e)\b|\brevisar\b|\bprova\b|\bselet[a-zçãáéíóú]*|\bcai\b|\bcaem\b|\bcair\b)/i;
// "conteúdo do 9º ano ou do 1º?" — série também é contexto, mas SÓ para
// "conteúdo": "quais matérias tem no 6º ano" é pergunta de grade (matrícula).
const CONTEXTO_SERIE = /(\b[1-9][ºo°ª]?\s*(?:ano|s[ée]rie)\b|\bcursar\b|\bcursando\b)/i;
const DEVE_ESTUDAR = /\b(?:devo|deve|preciso|precisa|tenho\s+que|tem\s+que)\s+estudar\b/i;

// Prova que NÃO é a Seletiva: ENEM/vestibular (Eixo) e avaliação de quem já é
// aluno (bimestral, recuperação, 2ª chamada, simulado).
const NAO_E_SELETIVA =
  /(\benem\b|vestibular|bimestr|trimestr|recupera[çc]|segunda\s+chamada|2[ªa]\s*chamada|simulado)/i;

export function isSeletivaContentQuestion(text: string): boolean {
  const t = text || "";
  if (NAO_E_SELETIVA.test(t)) return false;
  if (CONTEUDO_DIRETO.test(t)) return true;
  if (CONTEUDO.test(t) && (CONTEXTO_PROVA.test(t) || CONTEXTO_SERIE.test(t))) return true;
  if (ASSUNTO_OU_MATERIA.test(t) && CONTEXTO_PROVA.test(t)) return true;
  return DEVE_ESTUDAR.test(t) && CONTEXTO_SERIE.test(t);
}

/**
 * Os três editais publicados na página da Seletiva (lidos em 09/2026):
 *   - regular → vagas do 6º ano à 3ª série do Ensino Médio
 *   - jr      → vagas do 2º ao 5º ano (Fundamental Anos Iniciais)
 *   - militar → turmas militares (9º ano Militar ao Convênio)
 * Nos editais regular e Jr a prova cobre a SÉRIE ANTERIOR à que o aluno vai
 * cursar em 2027 (item 4.1), e o Anexo I separa o conteúdo por série
 * pretendida. O Militar não traz essa regra de conteúdo — só o edital.
 */
export type SeletivaEdital = "regular" | "jr" | "militar";

export const SELETIVA_EDITAIS: Record<SeletivaEdital, { label: string; url: string }> = {
  regular: {
    label: "do 6º ano ao Ensino Médio",
    url: "https://grupoideal.com.br/wp-content/uploads/2026/08/EDITAL-SELETIVA-IDEAL-2027.pdf",
  },
  jr: {
    label: "do 2º ao 5º ano (Ideal Jr)",
    url: "https://grupoideal.com.br/wp-content/uploads/2026/08/EDITAL-SELETIVA-IDEAL-JR-2027.pdf",
  },
  militar: {
    label: "das turmas militares",
    url: "https://grupoideal.com.br/wp-content/uploads/2026/08/Edital-Ideal-Militar-2027.pdf",
  },
};

// 2º, 4º e 5º ano do Fundamental → Jr. "3º ano" sozinho fica de fora de
// propósito: tanto é o 3º ano do Fundamental quanto o "terceirão" do Médio, e a
// ambiguidade manda os dois editais. O lookahead descarta "2º ano do Médio".
const SERIE_JR =
  /(\b(?:[245]\s*[ºo°]?\s*ano|(?:segundo|quarto|quinto)\s+ano|(?:quarta|quinta)\s+s[ée]rie|3\s*[ºo°]?\s*ano\s+do\s+fundamental|terceiro\s+ano\s+do\s+fundamental)\b(?!\s+(?:do\s+|de\s+)?(?:ensino\s+)?m[ée]dio)|fundamental\s*(?:1|i)\b|anos\s+iniciais)/i;

// 6º ao 9º ano e Ensino Médio → edital regular.
const SERIE_REGULAR =
  /(\b(?:[6-9]\s*[ºo°]?\s*ano|(?:sexto|s[ée]timo|oitavo|nono)\s+ano|(?:sexta|s[ée]tima|oitava|nona)\s+s[ée]rie)\b|\bm[ée]dio\b|\b[1-3]\s*[ªa]\s*s[ée]rie\b|fundamental\s*(?:2|ii)\b|anos\s+finais)/i;

/**
 * Qual(is) edital(is) mandar pela série citada. null = o texto não cita série
 * nem turma militar (o chamador tenta o histórico e, sem nada, manda regular +
 * Jr). Citou as duas faixas → os dois.
 */
export function pickSeletivaEditais(text: string): SeletivaEdital[] | null {
  const t = text || "";
  if (isMilitarInterest(t)) return ["militar"];
  const jr = SERIE_JR.test(t);
  const regular = SERIE_REGULAR.test(t);
  if (jr && regular) return ["regular", "jr"];
  if (jr) return ["jr"];
  if (regular) return ["regular"];
  return null;
}
