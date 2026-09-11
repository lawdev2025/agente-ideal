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
