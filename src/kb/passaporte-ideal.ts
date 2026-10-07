/**
 * PASSAPORTE IDEAL = a TAXA DE PRÉ-MATRÍCULA (dono, 06/10/2026).
 *
 * RAIZ DE BUG (06/10, print do cliente): "Estou fazendo matrícula do meu filho
 * e gostaria de saber o que é 'passaporte ideal'?" caía no bloco do resultado
 * da Seletiva — "matrícula" + a campanha da Seletiva no histórico viravam
 * "pergunta de resultado". Por isso a checagem roda ANTES da Seletiva no
 * orquestrador: quem cita o passaporte quer saber do passaporte.
 */
const PASSAPORTE_SIGNAL = /\bpassaporte\b/i;

export function isPassaporteIdealQuestion(text: string): boolean {
  return PASSAPORTE_SIGNAL.test(text || "");
}

export const PASSAPORTE_IDEAL_REPLY =
  "🎟️ O *Passaporte Ideal* é, nada mais nada menos, que a nossa *taxa de pré-matrícula*! 😉\n\n" +
  "Os valores e as condições o nosso time te apresenta na unidade, no momento da matrícula.";

// Linha pro LLM (prompt principal e prompts curtos) — mesma informação da
// resposta fixa, pra follow-up ("e quanto custa?") não inventar nada.
export const PASSAPORTE_IDEAL_LLM =
  "• PASSAPORTE IDEAL: é a TAXA DE PRÉ-MATRÍCULA do colégio — nada além disso. Não invente valor, prazo nem benefício extra; valores e condições são apresentados na unidade.";
