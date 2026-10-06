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
// desconto de cada aluno. Quem se matricular até 09/10 leva o MESMO % na
// matrícula e na mensalidade, o ano todo de 2027, em QUALQUER unidade.
// Depois de 09/10 a condição acaba (há outras, piores — quem apresenta é a
// unidade). Matrícula presencial, seg a sex, 8h às 18h. O bot NUNCA sabe o %
// de ninguém. Não recebeu o e-mail → sistemas@grupoideal.com.br.
export const SELETIVA_MATRICULA_PRAZO = "09/10";
export const SELETIVA_MATRICULA_HORARIO = "de segunda a sexta, das 8h às 18h";
export const SELETIVA_RESULTADO_EMAIL_SUPORTE = "sistemas@grupoideal.com.br";
// Fim do dia 09/10 em Belém (UTC-3).
export const SELETIVA_MATRICULA_FIM_MS = Date.parse("2026-10-10T03:00:00Z");

// ── TESTE AGENDADO (quem não fez a Seletiva) ────────────────────────────────
// Sempre às 8h e às 14h; inscrição pelo formulário. Cada dia:
//   aPartirMs → quando passa a ser divulgado (o dono só quer anunciar a
//               próxima data DEPOIS que a anterior passar)
//   ateMs     → quando sai da resposta: início da última sessão (14h de
//               Belém = 17h UTC)
// Depois do último, a resposta vira "encerrado" + o desconto da matrícula do momento.
export const SELETIVA_AGENDADA_HORARIOS = "às *8h* ou às *14h*";
export const SELETIVA_AGENDADA_DIAS = [
  { data: "06/10", aPartirMs: 0, ateMs: Date.parse("2026-10-06T17:00:00Z") },
  { data: "08/10", aPartirMs: 0, ateMs: Date.parse("2026-10-08T17:00:00Z") },
  { data: "13/10", aPartirMs: Date.parse("2026-10-08T17:00:00Z"), ateMs: Date.parse("2026-10-13T17:00:00Z") },
  { data: "20/10", aPartirMs: Date.parse("2026-10-13T17:00:00Z"), ateMs: Date.parse("2026-10-20T17:00:00Z") },
];

/** Datas do teste agendado que podem ser divulgadas agora. */
export function seletivaAgendadaDatas(now: number = Date.now()): string[] {
  return SELETIVA_AGENDADA_DIAS.filter((d) => now >= d.aPartirMs && now < d.ateMs).map((d) => d.data);
}
export const SELETIVA_AGENDADA_URL = "https://forms.cloud.microsoft/r/WKqZt6vcgJ";
export const SELETIVA_AGENDADA_FIM_MS = SELETIVA_AGENDADA_DIAS[SELETIVA_AGENDADA_DIAS.length - 1].ateMs;

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

// "Não recebi o e-mail", "não chegou nada", "cadê o resultado?".
const NAO_RECEBI_SIGNAL =
  /(n[ãa]o\s+(me\s+)?(recebi|recebemos|recebeu|chegou|veio|encontr\w*|ach\w*|apareceu|localiz\w*)|ainda\s+n[ãa]o\s+(recebi|chegou|veio)|cad[êe]|nada\s+(no|na|chegou)|n[ãa]o\s+tem\s+nada)/i;

export function isSeletivaResultadoNaoRecebido(text: string): boolean {
  return NAO_RECEBI_SIGNAL.test(text || "");
}

export const SELETIVA_ENCERRADA_RESULTADO_REPLY =
  "📩 O *resultado da Seletiva Ideal 2027* já foi enviado por *e-mail*!\n\n" +
  "Acesse o *e-mail usado na inscrição* para conferir o *percentual de desconto* conquistado.\n\n" +
  `🎓 *Matricule-se até ${SELETIVA_MATRICULA_PRAZO}* com o mesmo % de desconto da Seletiva. ` +
  "Ele vale para a *matrícula* e para a *mensalidade*, durante *todo o ano de 2027*, " +
  "e a matrícula pode ser feita em *qualquer uma das nossas unidades*.\n" +
  `⚠️ Condição válida *somente até ${SELETIVA_MATRICULA_PRAZO}*.\n\n` +
  `🏫 Nossas unidades estão te esperando para a matrícula, *${SELETIVA_MATRICULA_HORARIO}*.`;

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
function condicaoAtualTexto(now: number): string {
  const d = descontoMatriculaAtual(now);
  return d
    ? `Mas ainda dá para garantir *${d.pct}% de desconto na matrícula* até *${d.ate}*! 🎓\n\n` +
      `🏫 Nossas unidades estão te esperando, *${SELETIVA_MATRICULA_HORARIO}*. 😉`
    : `Visite uma das nossas unidades, *${SELETIVA_MATRICULA_HORARIO}*, que o nosso time te apresenta as condições de matrícula para 2027. 😉`;
}

// Depois de 09/10: a condição da Seletiva acabou; vale a faixa do momento.
export function seletivaResultadoReply(now: number = Date.now()): string {
  if (now < SELETIVA_MATRICULA_FIM_MS) return SELETIVA_ENCERRADA_RESULTADO_REPLY;
  return (
    `O prazo para matricular com o desconto da *Seletiva Ideal 2027* terminou em *${SELETIVA_MATRICULA_PRAZO}*. 🙏\n\n` +
    condicaoAtualTexto(now)
  );
}

const NAO_RECEBIDO_BASE =
  "Poxa, vamos resolver! 😉 O resultado foi enviado para o *e-mail usado na inscrição*.\n\n" +
  "🔎 Dá uma olhada também nas pastas *Spam / Lixo eletrônico* e *Promoções*, " +
  "e procure por *Seletivas Ideal 2027*.\n\n" +
  `📧 Se não encontrar, mande um e-mail para *${SELETIVA_RESULTADO_EMAIL_SUPORTE}* ` +
  "com o *nome completo do aluno* e o *e-mail correto* para receber o resultado.";

export const SELETIVA_RESULTADO_NAO_RECEBIDO_REPLY =
  NAO_RECEBIDO_BASE +
  `\n\n_Lembrando: a matrícula com o desconto da Seletiva vale *somente até ${SELETIVA_MATRICULA_PRAZO}*._`;

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

function agendamentoReply(datas: string[]): string {
  const dias = datas.length > 1
    ? `nos dias ${datas.map((d) => `*${d}*`).join(" ou ")}`
    : `no dia *${datas[0]}*`;
  return (
    "As inscrições da *Seletiva Ideal 2027* já foram encerradas. 🙏\n\n" +
    `Mas quem não conseguiu participar pode fazer o *teste agendado* ${dias}, ${SELETIVA_AGENDADA_HORARIOS}! 📝\n\n` +
    `👉 Faça a inscrição aqui: ${SELETIVA_AGENDADA_URL}`
  );
}

// Antes do primeiro teste (06/10 e 08/10) — texto de referência dos testes.
export const SELETIVA_ENCERRADA_AGENDAMENTO_REPLY = agendamentoReply(seletivaAgendadaDatas(0));

// Depois do último teste agendado: sem prova pela frente, vale a faixa do momento.
export function seletivaAgendamentoReply(now: number = Date.now()): string {
  const datas = seletivaAgendadaDatas(now);
  if (datas.length) return agendamentoReply(datas);
  return "A *Seletiva Ideal 2027* e os testes agendados já foram encerrados. 🙏\n\n" + condicaoAtualTexto(now);
}

/**
 * O que o LLM sabe da Seletiva AGORA — mesma fonte das respostas fixas, pra
 * nunca divergir. Recalculado a cada mensagem: as datas viram sozinhas.
 * Usado pelo prompt principal (llm/prompts/system-prompt.ts) e pelos prompts
 * curtos do orquestrador (DADOS_COLEGIO).
 */
export function seletivaInfoLLM(now: number = Date.now()): string {
  const datas = seletivaAgendadaDatas(now);
  const agendado = datas.length
    ? `Quem NÃO fez a Seletiva → pode fazer o TESTE AGENDADO ${datas.length > 1 ? `nos dias ${datas.join(" ou ")}` : `no dia ${datas[0]}`}, sempre às 8h ou às 14h, inscrição em ${SELETIVA_AGENDADA_URL}. NÃO cite nenhuma outra data de teste.`
    : "Quem NÃO fez a Seletiva → os testes agendados já foram encerrados. NÃO cite datas de teste.";
  const faixa = descontoMatriculaAtual(now);
  const condicaoAtual = faixa
    ? `Condição que vale HOJE: ${faixa.pct}% de desconto na MATRÍCULA até ${faixa.ate} (não cite outro percentual nem outra data).`
    : "Não há desconto divulgado agora: as condições de matrícula são apresentadas nas unidades (não cite percentual).";
  const resultado = now < SELETIVA_MATRICULA_FIM_MS
    ? `Quem se matricular ATÉ ${SELETIVA_MATRICULA_PRAZO} leva o MESMO % de desconto da Seletiva, válido para a matrícula E a mensalidade, durante TODO o ano de 2027, em QUALQUER uma das 3 unidades (não precisa ser a da prova). Condição válida SOMENTE até ${SELETIVA_MATRICULA_PRAZO}.`
    : `O prazo para matricular com o desconto da Seletiva TERMINOU em ${SELETIVA_MATRICULA_PRAZO}; NÃO prometa o desconto da Seletiva. ${condicaoAtual}`;
  return [
    `• SELETIVA IDEAL 2027: JÁ ENCERRADA (prova foi em 26/09). Não passe link de inscrição da Seletiva, taxa, edital nem datas antigas. ${agendado}${!datas.length && now >= SELETIVA_MATRICULA_FIM_MS ? ` ${condicaoAtual}` : ""}`,
    `• RESULTADO DA SELETIVA: JÁ FOI ENVIADO POR E-MAIL (o e-mail usado na inscrição), com o percentual de desconto de cada aluno. Você NÃO sabe o percentual da Seletiva de nenhum aluno — nunca diga nem estime esse número; ele está no e-mail. ${resultado} Matrícula presencial nas unidades, ${SELETIVA_MATRICULA_HORARIO} (dê o endereço se perguntarem onde). Não achou o e-mail → olhar Spam/Lixo eletrônico e Promoções, buscar "Seletivas Ideal 2027"; se não achar, mandar e-mail para ${SELETIVA_RESULTADO_EMAIL_SUPORTE} com o nome completo do aluno e o e-mail correto. Responda SÓ o que foi perguntado, em 1–2 frases — NUNCA repita o bloco inteiro.`,
  ].join("\n");
}
