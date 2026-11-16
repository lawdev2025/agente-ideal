/**
 * EIXO — pré-vestibular do Grupo Ideal + Seletivas Eixo 2027.
 *
 * Regras do dono (15/11/2026):
 *   - Perguntou do Eixo → explica que é um pré-vestibular NOVO e totalmente
 *     diferente, formado por eixos: o aluno escolhe quais faz e paga por
 *     quantos escolheu.
 *   - Valor NUNCA pelo bot: só na secretaria ou com o coordenador do Eixo.
 *   - Divulga a Seletiva Eixo 2027 (link do formulário + a arte), e o desconto
 *     ganho vale pra CADA eixo em que o aluno se matricular.
 *   - Inscrições de 15/11 até sexta 27/11; prova sábado 28/11 às 9h.
 *
 * Resposta fixa sai 1x por conversa (ver resposta-fixa-sem-repetir); depois o
 * LLM responde curto com EIXO_LLM, que tem os mesmos dados.
 */

export const EIXO_COORDENADOR_PHONE = "(91) 99334-4387";

// Formulário de inscrição (Microsoft Forms, link de RESPOSTA — o link de
// edição "DesignPageV2" não abre pro público).
export const EIXO_SELETIVA_URL =
  "https://forms.office.com/Pages/ResponsePage.aspx?id=oPDMhAF5-EecGkpLlWidGdRzlrCiq19FqyQg7c1uSDRURVFKUEdBNURFVExMSDREWUxaV1k4RVk5NC4u";

// Arte da campanha, servida pelo próprio deploy (public/img/).
export const EIXO_SELETIVA_ART_URL = "https://agente-ideal.vercel.app/img/seletiva-eixo-2027.jpg";

// Depois da prova (28/11, manhã) a Seletiva Eixo some da resposta: fica só a
// explicação do curso + valores com a secretaria/coordenador.
export const EIXO_SELETIVA_FIM_MS = Date.parse("2026-11-28T14:00:00-03:00");

export function eixoSeletivaAberta(now: number = Date.now()): boolean {
  return now < EIXO_SELETIVA_FIM_MS;
}

// "eixo" é a palavra da campanha; pré-vestibular/pré-enem/cursinho são o
// mesmo curso. "enem"/"vestibular" sozinhos ficam de fora (simulado do Médio,
// "meu filho vai prestar vestibular").
const EIXO_SIGNAL =
  /(\beixos?\b|pr[ée][-\s]?vestibular|pr[ée][-\s]?enem|\bcursinho\b|pr[ée][-\s]?universit[áa]rio)/i;

export function isEixoQuestion(text: string): boolean {
  return EIXO_SIGNAL.test(text || "");
}

const EIXO_CURSO =
  "O *Eixo* é o nosso *pré-vestibular*: um curso *novo e totalmente diferente*! 🎯\n\n" +
  "Ele é formado por *eixos*: o aluno escolhe os eixos que quer fazer e paga só por eles. " +
  "Se fizer um eixo, paga por um; se fizer mais de um, paga pela quantidade de eixos escolhidos.";

const EIXO_VALORES =
  "💰 Valores não passamos por aqui: você pode ver na *secretaria* de qualquer unidade " +
  `ou falar direto com o *coordenador do Eixo* 📞 *${EIXO_COORDENADOR_PHONE}* (mesmo número pra todas as unidades).`;

export function eixoReply(now: number = Date.now()): string {
  if (!eixoSeletivaAberta(now)) return `${EIXO_CURSO}\n\n${EIXO_VALORES}`;
  return (
    `${EIXO_CURSO}\n\n` +
    "📝 *Seletivas Eixo 2027 — inscrições abertas!*\n" +
    "• Inscrições até *sexta-feira, 27/11*\n" +
    "• Prova: *sábado, 28/11, às 9h*\n" +
    "• O desconto conquistado na Seletiva vale para *cada um dos eixos* em que o aluno se matricular.\n\n" +
    `👉 Inscrição: ${EIXO_SELETIVA_URL}\n\n` +
    EIXO_VALORES
  );
}

// Pergunta de valor depois que o bloco do Eixo já saiu ("e quanto custa?").
export const EIXO_VALOR_REPLY =
  "Os valores do *Eixo* dependem de quantos eixos o aluno escolher, e a gente não passa por aqui 😊\n\n" +
  EIXO_VALORES;

export const EIXO_ART_CAPTION = "Arte Seletivas Eixo 2027";

// Marca da resposta fixa no histórico (as duas versões começam igual).
export function eixoJaApresentado(botText: string): boolean {
  return (botText || "").startsWith("O *Eixo* é o nosso *pré-vestibular*");
}

export function eixoLLM(now: number = Date.now()): string {
  const base =
    `• EIXO = nosso pré-vestibular, curso NOVO e totalmente diferente, formado por eixos: o aluno escolhe quais eixos faz e paga por quantos escolher (1 eixo paga 1; mais de um, paga a quantidade). VALOR do Eixo NUNCA pelo bot (nem estimativa): só na secretaria ou com o coordenador do Eixo ${EIXO_COORDENADOR_PHONE} (mesmo número pra todas as unidades).`;
  if (!eixoSeletivaAberta(now)) return base;
  return (
    base +
    `\n• SELETIVAS EIXO 2027: inscrições abertas até sexta 27/11 pelo formulário ${EIXO_SELETIVA_URL} · prova sábado 28/11 às 9h · o desconto ganho na Seletiva vale para CADA um dos eixos em que o aluno se matricular. Local da prova, conteúdo e percentual de desconto: não temos aqui — o coordenador do Eixo confirma. É campanha diferente da Seletiva Ideal (colégio).`
  );
}
