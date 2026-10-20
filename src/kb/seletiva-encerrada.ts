/**
 * SELETIVA IDEAL 2027 — ENCERRADA.
 *
 * As inscrições fecharam em 25/09/2026. Pedido do dono: todo assunto de
 * Seletiva se resume a duas respostas fixas, sem LLM —
 *   - resultado        → já foi enviado por e-mail; matrícula com o mesmo %
 *                        de desconto até 09/10 (informativo de 05/10/2026)
 *   - quem não fez     → teste agendado em 08/10 (formulário de inscrição)
 *   - qualquer outra   → "encerrada; fique de olho, vamos abrir o agendamento
 *                        de um teste pra quem não pôde participar"
 * e quem cai na segunda ganha o status "agendada" (selo "Seletivas agendadas"
 * no painel): é o público que vai receber o aviso quando o agendamento abrir.
 *
 * Os fluxos antigos (link de inscrição, taxa, edital, experimentais) ficam no
 * orquestrador atrás de config.seletivaEncerrada — SELETIVA_ENCERRADA=false
 * religa tudo na próxima edição.
 */

// ── RESULTADO (informativo de 05/10/2026) ───────────────────────────────────
// O resultado foi enviado por e-mail (o da inscrição) com o percentual de
// desconto de cada aluno. Esse % vale na MENSALIDADE o ano todo de 2027, SEM
// prazo, em QUALQUER unidade. O 09/10 é só o prazo pra levar o mesmo % também
// na MATRÍCULA; depois disso a matrícula tem a faixa do momento (20%/10%).
// Matrícula presencial, seg a sex, 8h às 18h. O bot NUNCA sabe o % de ninguém.
// Não recebeu o e-mail → sistemas@grupoideal.com.br.
export const SELETIVA_MATRICULA_PRAZO = "09/10";
export const SELETIVA_MATRICULA_HORARIO = "de segunda a sexta, das 8h às 18h";
export const SELETIVA_RESULTADO_EMAIL_SUPORTE = "sistemas@grupoideal.com.br";
// Fim do dia 09/10 em Belém (UTC-3).
export const SELETIVA_MATRICULA_FIM_MS = Date.parse("2026-10-10T03:00:00Z");

// ── TESTE AGENDADO (quem não fez a Seletiva) ────────────────────────────────
// Dono (20/10/2026): teste TODA terça e quinta, menos feriado, sempre às 8h e
// às 14h, inscrição pelo formulário. O bot divulga SÓ a próxima data (segunda
// → terça; quarta → quinta; sexta → terça). Quem diz que não pode ganha SÓ a
// seguinte ("nessa semana temos também a quinta") — nunca uma lista de datas.
// Um dia sai da resposta no início da última sessão (14h de Belém = 17h UTC).
// Belém é UTC-3 o ano todo (sem horário de verão).
export const SELETIVA_AGENDADA_HORARIOS = "às *8h* ou às *14h*";
export const SELETIVA_AGENDADA_URL = "https://forms.cloud.microsoft/r/WKqZt6vcgJ";
export const SELETIVA_AGENDADA_INICIO = "2026-10-06";
// Último dia de teste (AAAA-MM-DD) ou null = sem data pra acabar. Com fim,
// depois dele a resposta vira "encerrado" + a faixa de matrícula do momento.
export const SELETIVA_AGENDADA_FIM: string | null = null;
// Terças/quintas sem teste: feriados nacionais, do Pará e de Belém, Carnaval
// e as vésperas de Natal e Ano-Novo. Cancelou um dia? É só pôr aqui.
export const SELETIVA_AGENDADA_SEM_TESTE = new Set([
  "2026-11-02", "2026-11-15", "2026-11-20", "2026-12-08", "2026-12-24", "2026-12-25", "2026-12-31",
  "2027-01-01", "2027-01-12", "2027-02-08", "2027-02-09", "2027-02-10", "2027-03-26", "2027-04-21",
  "2027-05-01", "2027-05-27", "2027-08-15", "2027-09-07", "2027-10-11", "2027-10-12", "2027-11-02",
  "2027-11-15", "2027-11-20", "2027-12-08", "2027-12-24", "2027-12-25", "2027-12-31",
]);
const DIAS_TESTE: Record<number, string> = { 2: "terça-feira", 4: "quinta-feira" };
const BELEM_OFFSET_MS = 3 * 3600 * 1000;
const DIA_MS = 24 * 3600 * 1000;

export type TesteAgendado = { iso: string; data: string; semana: string; ateMs: number };

function testeDoDia(diaUtcMs: number): TesteAgendado | null {
  const d = new Date(diaUtcMs);
  const semana = DIAS_TESTE[d.getUTCDay()];
  const iso = d.toISOString().slice(0, 10);
  if (!semana || iso < SELETIVA_AGENDADA_INICIO || SELETIVA_AGENDADA_SEM_TESTE.has(iso)) return null;
  if (SELETIVA_AGENDADA_FIM && iso > SELETIVA_AGENDADA_FIM) return null;
  return { iso, data: `${iso.slice(8, 10)}/${iso.slice(5, 7)}`, semana, ateMs: diaUtcMs + 17 * 3600 * 1000 };
}

/** Os próximos `n` testes ainda abertos (a partir de `now`), em ordem. */
export function proximosTestesAgendados(now: number = Date.now(), n = 1): TesteAgendado[] {
  const out: TesteAgendado[] = [];
  const hojeBelem = new Date(now - BELEM_OFFSET_MS);
  let dia = Math.max(
    Date.UTC(hojeBelem.getUTCFullYear(), hojeBelem.getUTCMonth(), hojeBelem.getUTCDate()),
    Date.parse(`${SELETIVA_AGENDADA_INICIO}T00:00:00Z`)
  );
  // Teto de 400 dias: com fim definido a lista acaba.
  for (let i = 0; i < 400 && out.length < n; i++, dia += DIA_MS) {
    const t = testeDoDia(dia);
    if (t && now < t.ateMs) out.push(t);
  }
  return out;
}

/** Data do próximo teste (["22/10"]), ou [] se acabaram. */
export function seletivaAgendadaDatas(now: number = Date.now()): string[] {
  return proximosTestesAgendados(now, 1).map((t) => t.data);
}

/** "*quinta-feira, 22/10*" — como o dia aparece nas respostas. */
export function testeAgendadoDiaTexto(t: TesteAgendado): string {
  return `*${t.semana}, ${t.data}*`;
}

// "Não posso nesse dia", "tem outra data?", "terça não dá" — só conta depois
// do bot ter oferecido uma data de teste (ver testeOferecidoNoHistorico).
const OUTRA_DATA_SIGNAL =
  /(n[ãa]o\s+(vou\s+|vamos\s+|vai\s+)?(posso|podemos|poder|consigo|conseguimos|conseguir|d[áa]\b|dar\b|tenho\s+como|temos\s+como)|outr[oa]s?\s+(data|dia|op[çc][ãa]o|semana)|tem\s+outr|teria\s+outr|tem\s+mais\s+(alguma\s+)?(data|dia|op[çc])|pr[óo]xim[oa]\s+(data|teste|dia|semana|op[çc])|remarc|impossibilitad|sem\s+disponibilidade|n[ãa]o\s+tenho\s+disponibilidade|fica\s+(dif[íi]cil|complicado))/i;

export function isSeletivaOutraDataPedido(text: string): boolean {
  return OUTRA_DATA_SIGNAL.test(text || "");
}

/**
 * Data ("DD/MM") que o bot ofereceu por último — toda resposta de teste
 * agendado leva o link do formulário. Só olha os últimos turnos: oferta antiga
 * não transforma "não posso" de outro assunto em pedido de outra data.
 */
export function testeOferecidoNoHistorico(history: { role: string; content: string }[]): string | null {
  for (const m of history.slice(-4).reverse()) {
    if (m.role !== "assistant" || !m.content.includes(SELETIVA_AGENDADA_URL)) continue;
    const datas = m.content.match(/\b\d{2}\/\d{2}\b/g);
    return datas ? datas[datas.length - 1] : null;
  }
  return null;
}

// "DD/MM" → AAAA-MM-DD, no ano mais perto de hoje (oferta de dezembro lida em
// janeiro continua sendo do ano anterior).
function isoDaData(data: string, now: number): string {
  const [dd, mm] = data.split("/").map(Number);
  const hoje = new Date(now - BELEM_OFFSET_MS);
  const mesHoje = hoje.getUTCMonth() + 1;
  let ano = hoje.getUTCFullYear();
  if (mm - mesHoje > 6) ano--;
  else if (mesHoje - mm > 6) ano++;
  return `${ano}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

// Segunda-feira da semana do dia (duas datas na mesma semana?).
function segundaDaSemana(iso: string): number {
  const d = Date.parse(`${iso}T00:00:00Z`);
  return d - ((new Date(d).getUTCDay() + 6) % 7) * DIA_MS;
}

/**
 * Cliente não pode na data oferecida → oferece SÓ a seguinte. Mesma semana:
 * "nessa semana temos também a quinta"; senão, "a próxima opção é...".
 * null quando não há teste depois (só com SELETIVA_AGENDADA_FIM).
 */
export function seletivaOutraDataReply(oferecida: string | null, now: number = Date.now()): string | null {
  const depoisDe = oferecida ? isoDaData(oferecida, now) : "";
  const prox = proximosTestesAgendados(now, 12).find((t) => t.iso > depoisDe);
  if (!prox) return null;
  const mesmaSemana = !!oferecida && segundaDaSemana(prox.iso) === segundaDaSemana(depoisDe);
  const abertura = mesmaSemana
    ? `Sem problemas! 😉 Nessa semana, temos também a opção de fazer o *teste agendado* na ${testeAgendadoDiaTexto(prox)}, ${SELETIVA_AGENDADA_HORARIOS}. 📝`
    : `Sem problemas! 😉 A próxima opção é fazer o *teste agendado* na ${testeAgendadoDiaTexto(prox)}, ${SELETIVA_AGENDADA_HORARIOS}. 📝`;
  return `${abertura}\n\n👉 Faça a inscrição aqui: ${SELETIVA_AGENDADA_URL}`;
}

// Pergunta de RESULTADO: nota, aprovação, classificação, lista, gabarito.
// "saiu"/"sai quando" só contam junto de um desses — sozinhos são genéricos.
const RESULTADO_SIGNAL =
  /(resultad|aprovad|classificad|classifica[çc][ãa]o|\bnotas?\b|gabarito|\blista\b|ranking|\bpassou\b|\bpassei\b|\bpassaram\b)/i;

// Depois do resultado, quem fala de Seletiva + desconto/matrícula/e-mail/prazo
// é quem FEZ a prova e quer usar o desconto — não quem chegou tarde.
const POS_RESULTADO_SIGNAL =
  /(desconto|percentual|porcentagem|\d\s*%|\bbolsa\b|matr[ií]cul|e-?mail|\bprazo\b|at[ée]\s+quando|\b0?9\/10\b|mensalidade)/i;

export function isSeletivaResultadoQuestion(text: string): boolean {
  return RESULTADO_SIGNAL.test(text || "");
}

// Só depois da prova (antes dela, "e-mail"/"taxa" são da inscrição).
export function isSeletivaPosResultadoQuestion(text: string): boolean {
  return POS_RESULTADO_SIGNAL.test(text || "");
}

// Sem citar a Seletiva, só com ela no histórico (a campanha do resultado fica
// gravada como fala do bot): conta só o que é DELA — desconto, %, e-mail, 09/10.
// RAIZ DE BUG (07/10, print do dono): "Gostaria de saber mais sobre matrícula"
// virava o bloco do resultado. Matrícula, mensalidade e prazo sozinhos são de
// quem quer MATRICULAR — vão pro fluxo de matrícula (visita, unidades).
const POS_RESULTADO_CONTEXTO_SIGNAL =
  /(desconto|percentual|porcentagem|\d\s*%|\bbolsa\b|e-?mail|\b0?9\/10\b)/i;

export function isSeletivaPosResultadoContexto(text: string): boolean {
  return POS_RESULTADO_CONTEXTO_SIGNAL.test(text || "");
}

// "Não recebi o e-mail", "não chegou nada", "cadê o resultado?".
const NAO_RECEBI_SIGNAL =
  /(n[ãa]o\s+(me\s+)?(recebi|recebemos|recebeu|chegou|veio|encontr\w*|ach\w*|apareceu|localiz\w*)|ainda\s+n[ãa]o\s+(recebi|chegou|veio)|cad[êe]|nada\s+(no|na|chegou)|n[ãa]o\s+tem\s+nada)/i;

export function isSeletivaResultadoNaoRecebido(text: string): boolean {
  return NAO_RECEBI_SIGNAL.test(text || "");
}

// ── DEPOIS DE 09/10: desconto na matrícula que cai com o tempo ──────────────
// Dono (05/10/2026): 20% na matrícula até 20/10, 10% até 30/10. Fim de cada
// dia em Belém (UTC-3). Depois de 30/10 o bot não cita % nenhum.
export const MATRICULA_DESCONTO_FAIXAS = [
  { pct: 20, ate: "20/10", ateMs: Date.parse("2026-10-21T03:00:00Z") },
  { pct: 10, ate: "30/10", ateMs: Date.parse("2026-10-31T03:00:00Z") },
];

/** Desconto na matrícula que vale AGORA, depois do prazo da Seletiva. */
export function descontoMatriculaAtual(now: number = Date.now()) {
  if (now < SELETIVA_MATRICULA_FIM_MS) return null;
  return MATRICULA_DESCONTO_FAIXAS.find((f) => now < f.ateMs) ?? null;
}

// "Temos X% na matrícula até DD/MM" ou, sem faixa, "a unidade apresenta".
// Pra quem NÃO fez a Seletiva (testes agendados encerrados).
function condicaoAtualTexto(now: number): string {
  const d = descontoMatriculaAtual(now);
  return d
    ? `Mas ainda dá para garantir *${d.pct}% de desconto na matrícula* até *${d.ate}*! 🎓\n\n` +
      `🏫 Nossas unidades estão te esperando, *${SELETIVA_MATRICULA_HORARIO}*. 😉`
    : `Visite uma das nossas unidades, *${SELETIVA_MATRICULA_HORARIO}*, que o nosso time te apresenta as condições de matrícula para 2027. 😉`;
}

// Quem FEZ a Seletiva: o % vale na mensalidade sempre; na matrícula, até 09/10
// e depois a faixa do momento.
export function seletivaResultadoReply(now: number = Date.now()): string {
  const d = descontoMatriculaAtual(now);
  const matricula = now < SELETIVA_MATRICULA_FIM_MS
    ? `⚠️ E quem se matricular *até ${SELETIVA_MATRICULA_PRAZO}* leva o *mesmo %* também na *matrícula*!`
    : d
      ? `Na *matrícula*, o mesmo % valia até *${SELETIVA_MATRICULA_PRAZO}*, mas ainda dá para garantir *${d.pct}% de desconto na matrícula* até *${d.ate}*!`
      : `Na *matrícula*, o mesmo % valia até *${SELETIVA_MATRICULA_PRAZO}*. As condições de matrícula de agora o nosso time te apresenta na unidade.`;
  return (
    "📩 O *resultado da Seletiva Ideal 2027* já foi enviado por *e-mail*!\n\n" +
    "Acesse o *e-mail usado na inscrição* para conferir o *percentual de desconto* conquistado.\n\n" +
    "🎓 Esse % vale para a *mensalidade* durante *todo o ano de 2027*, " +
    "e a matrícula pode ser feita em *qualquer uma das nossas unidades*.\n" +
    `${matricula}\n\n` +
    `🏫 Nossas unidades estão te esperando para a matrícula, *${SELETIVA_MATRICULA_HORARIO}*.`
  );
}

// Antes de 09/10 — texto de referência dos testes.
export const SELETIVA_ENCERRADA_RESULTADO_REPLY = seletivaResultadoReply(0);

const NAO_RECEBIDO_BASE =
  "Poxa, vamos resolver! 😉 O resultado foi enviado para o *e-mail usado na inscrição*.\n\n" +
  "🔎 Dá uma olhada também nas pastas *Spam / Lixo eletrônico* e *Promoções*, " +
  "e procure por *Seletivas Ideal 2027*.\n\n" +
  `📧 Se não encontrar, mande um e-mail para *${SELETIVA_RESULTADO_EMAIL_SUPORTE}* ` +
  "com o *nome completo do aluno* e o *e-mail correto* para receber o resultado.";

export const SELETIVA_RESULTADO_NAO_RECEBIDO_REPLY =
  NAO_RECEBIDO_BASE +
  `\n\n_Lembrando: o mesmo % da Seletiva na *matrícula* vale *somente até ${SELETIVA_MATRICULA_PRAZO}*._`;

export function seletivaNaoRecebidoReply(now: number = Date.now()): string {
  return now < SELETIVA_MATRICULA_FIM_MS ? SELETIVA_RESULTADO_NAO_RECEBIDO_REPLY : NAO_RECEBIDO_BASE;
}

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
  "🏫 *Sala:* a sala de cada aluno será informada no local de prova.\n\n" +
  "🪪 *O que levar:*\n" +
  "• Um *documento de identificação* do aluno (o RG, por exemplo). Não precisa de ficha, cartão nem comprovante de inscrição\n" +
  "• *Caneta esferográfica azul ou preta*\n\n" +
  "📵 Celular e eletrônicos ficam *desligados e guardados*, e *calculadora não é permitida*.\n" +
  "👨‍👩‍👧 Os responsáveis não ficam no local da prova.\n\n" +
  "Boa prova! 🍀\n\n" +
  "_Não conseguiu se inscrever? Fique de olho: em breve vamos abrir o agendamento de um teste para quem não pôde participar._";

function agendamentoReply(t: TesteAgendado): string {
  return (
    "As inscrições da *Seletiva Ideal 2027* já foram encerradas. 🙏\n\n" +
    `Mas quem não conseguiu participar pode fazer o *teste agendado* na ${testeAgendadoDiaTexto(t)}, ${SELETIVA_AGENDADA_HORARIOS}! 📝\n\n` +
    `👉 Faça a inscrição aqui: ${SELETIVA_AGENDADA_URL}`
  );
}

// Antes do primeiro teste (06/10) — texto de referência dos testes.
export const SELETIVA_ENCERRADA_AGENDAMENTO_REPLY = agendamentoReply(proximosTestesAgendados(0)[0]);

// Sem teste pela frente (só com SELETIVA_AGENDADA_FIM): vale a faixa do momento.
export function seletivaAgendamentoReply(now: number = Date.now()): string {
  const [prox] = proximosTestesAgendados(now);
  if (prox) return agendamentoReply(prox);
  return "A *Seletiva Ideal 2027* e os testes agendados já foram encerrados. 🙏\n\n" + condicaoAtualTexto(now);
}

/**
 * Fecho da resposta de VALOR (mensalidade, taxa, preço): o gancho de desconto.
 * Só sai em pergunta de valor — matrícula/visita não leva Seletiva (dono, 07/10).
 * Quem fez já tem o % no e-mail; quem não fez ganha o teste agendado da vez
 * ou, depois deles, a faixa de matrícula do momento.
 */
export function seletivaDescontoDica(now: number = Date.now()): string {
  const fez = "💡 *Quer desconto?* Quem fez a *Seletiva Ideal 2027* já recebeu por *e-mail* o % de desconto na mensalidade.";
  const [prox] = proximosTestesAgendados(now);
  if (prox) {
    return `${fez} Não fez? Ainda dá para fazer o *teste agendado* na ${testeAgendadoDiaTexto(prox)}, ${SELETIVA_AGENDADA_HORARIOS}: ${SELETIVA_AGENDADA_URL}`;
  }
  const d = descontoMatriculaAtual(now);
  return d ? `${fez} E ainda dá para garantir *${d.pct}% de desconto na matrícula* até *${d.ate}*!` : fez;
}

/**
 * O que o LLM sabe da Seletiva AGORA — mesma fonte das respostas fixas, pra
 * nunca divergir. Recalculado a cada mensagem: as datas viram sozinhas.
 * Usado pelo prompt principal (llm/prompts/system-prompt.ts) e pelos prompts
 * curtos do orquestrador (DADOS_COLEGIO).
 */
export function seletivaInfoLLM(now: number = Date.now()): string {
  const [prox, seguinte] = proximosTestesAgendados(now, 2);
  const agendado = prox
    ? `Quem NÃO fez a Seletiva → pode fazer o TESTE AGENDADO (toda terça e quinta, menos feriado), sempre às 8h ou às 14h, inscrição em ${SELETIVA_AGENDADA_URL}. Divulgue SÓ a próxima data: ${prox.semana}, ${prox.data}.` +
      (seguinte ? ` Se o cliente disser que não pode nessa data, ofereça SÓ a seguinte: ${seguinte.semana}, ${seguinte.data}.` : "") +
      " NUNCA liste várias datas de uma vez."
    : "Quem NÃO fez a Seletiva → os testes agendados já foram encerrados. NÃO cite datas de teste.";
  const faixa = descontoMatriculaAtual(now);
  const condicaoAtual = faixa
    ? `Condição que vale HOJE: ${faixa.pct}% de desconto na MATRÍCULA até ${faixa.ate} (não cite outro percentual nem outra data).`
    : "Não há desconto divulgado agora: as condições de matrícula são apresentadas nas unidades (não cite percentual).";
  const resultado =
    `O % da Seletiva vale na MENSALIDADE durante TODO o ano de 2027, SEM prazo, em QUALQUER uma das 3 unidades (não precisa ser a da prova). O prazo de ${SELETIVA_MATRICULA_PRAZO} é SÓ para usar o mesmo % também na MATRÍCULA (nunca diga que o aluno perdeu o desconto da mensalidade). ` +
    (now < SELETIVA_MATRICULA_FIM_MS
      ? `Quem se matricular ATÉ ${SELETIVA_MATRICULA_PRAZO} leva o mesmo % também na matrícula.`
      : `O mesmo % na matrícula valia até ${SELETIVA_MATRICULA_PRAZO} (já passou). ${condicaoAtual}`);
  return [
    `• SELETIVA IDEAL 2027: JÁ ENCERRADA (prova foi em 26/09). Não passe link de inscrição da Seletiva, taxa nem datas antigas. EDITAL do teste agendado: o colégio manda o ARQUIVO do edital (um por segmento: 2º ao 5º ano, 6º ano ao Ensino Médio, turmas militares) — se ele já foi enviado na conversa, diga que a resposta está no edital enviado; nunca invente regra ou conteúdo do edital. ${agendado}${!prox && now >= SELETIVA_MATRICULA_FIM_MS ? ` ${condicaoAtual}` : ""}`,
    `• RESULTADO DA SELETIVA: JÁ FOI ENVIADO POR E-MAIL (o e-mail usado na inscrição), com o percentual de desconto de cada aluno. Você NÃO sabe o percentual da Seletiva de nenhum aluno — nunca diga nem estime esse número; ele está no e-mail. ${resultado} Matrícula presencial nas unidades, ${SELETIVA_MATRICULA_HORARIO} (dê o endereço se perguntarem onde). Não achou o e-mail → olhar Spam/Lixo eletrônico e Promoções, buscar "Seletivas Ideal 2027"; se não achar, mandar e-mail para ${SELETIVA_RESULTADO_EMAIL_SUPORTE} com o nome completo do aluno e o e-mail correto. Responda SÓ o que foi perguntado, em 1–2 frases — NUNCA repita o bloco inteiro.`,
    "• MATRÍCULA NÃO É SELETIVA: quem pergunta de matrícula, vaga, turma ou visita quer MATRICULAR — fale da matrícula " +
      `(presencial nas unidades, ${SELETIVA_MATRICULA_HORARIO}) e convide para agendar uma visita. Só fale da Seletiva se o cliente citar a Seletiva/resultado ou perguntar de valor/desconto.`,
  ].join("\n");
}
