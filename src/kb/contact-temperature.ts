/**
 * TEMPERATURA do contato — prioridade de atendimento, não intenção.
 *
 * Fica FORA de ContactTag (matrícula/rematrícula/seletiva/…) de propósito: a
 * intenção diz o que a pessoa quer, a temperatura diz quem merece atenção
 * primeiro hoje. Por isso não entra no donut do painel — é filtro de fila.
 *
 *   quente → conversou, foi qualificado (o bot já mandou um LINK) e parou aí.
 *            É o lead mais caro da lista: só falta alguém ligar.
 *   morno  → conversou mas parou ANTES de chegar no link. Engajou e travou.
 *   frio   → mandou uma mensagem e sumiu, nunca respondeu ao bot.
 *
 * A temperatura é derivada do SILÊNCIO, e silêncio não gera evento — por isso
 * não dá pra carimbar no webhook como as outras tags. Quem calcula é o job
 * /api/jobs/temperature (de hora em hora). Este módulo é a regra em TS, que os
 * testes cobrem; o SQL em public/admin/supabase-contact-temperature.sql é o
 * espelho set-based que roda de fato. Se mexer em um, mexa no outro.
 */
export type Temperature = "quente" | "morno" | "frio";

/** Silêncio a partir do qual a conversa deixa de ser "viva". */
export const COLD_AFTER_MS = 60 * 60 * 1000; // 1h

export interface ConversationStats {
  /** Quantas mensagens o CLIENTE mandou na conversa inteira. */
  userMsgs: number;
  /** Quantas mensagens do BOT continham link (visita, calendário, seletiva). */
  botLinkMsgs: number;
  /** Timestamp (ms) da última mensagem, de qualquer lado. */
  lastAt: number;
  /** De quem foi a última mensagem. */
  lastRole: "user" | "assistant";
}

/**
 * A SEQUÊNCIA é a regra — cada degrau só é avaliado se o anterior não bateu:
 *
 *   0. última mensagem é do CLIENTE → null. Quem deve resposta somos nós; isso
 *      é fila de atendimento (needs_reply), não lead esfriando. Sem este
 *      degrau, mandaríamos "ainda está aí?" pra quem está esperando resposta.
 *   1. silêncio menor que o limite  → null. Conversa ainda viva.
 *   2. só 1 mensagem do cliente     → frio.
 *   3. bot já mandou link           → quente.
 *   4. resto                        → morno.
 */
export function classifyTemperature(
  stats: ConversationStats,
  now: number,
  coldAfterMs: number = COLD_AFTER_MS
): Temperature | null {
  if (stats.lastRole === "user") return null;
  if (now - stats.lastAt < coldAfterMs) return null;
  if (stats.userMsgs <= 1) return "frio";
  if (stats.botLinkMsgs > 0) return "quente";
  return "morno";
}

// =====================================================================
// FOLLOW-UP automático — só para os FRIOS
// =====================================================================
/**
 * Por que só frio: quente e morno são leads que já engajaram e valem uma
 * pessoa de verdade, não um robô insistindo. Frio mandou uma mensagem e
 * sumiu — é exatamente o caso onde um empurrão automático custa nada.
 *
 * JANELA DE 24H DA META: a Cloud API só deixa mandar mensagem livre dentro de
 * 24h contadas a partir da ÚLTIMA mensagem DO CLIENTE. Fora disso exige
 * template aprovado, que este projeto não usa. Todo o cronograma abaixo vive
 * dentro dessa janela — e FREE_WINDOW_MS é a trava final.
 */
export const FREE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 1º empurrão: 1h de silêncio. */
export const FOLLOWUP_1_AFTER_MS = COLD_AFTER_MS;

/**
 * 2º empurrão: 22h DEPOIS do primeiro (≈23h da mensagem do cliente).
 *
 * O pedido original era 23h (fechando 24h redondas), mas 24h é exatamente o
 * instante em que a janela FECHA. Somando a granularidade horária do cron e o
 * atraso normal do agendador (5–15 min), a mensagem cairia do lado de fora e
 * a Meta recusaria. 22h entrega o mesmo efeito — último empurrão no fim da
 * janela — com ~1h de folga. É só mudar esta constante pra ajustar.
 */
export const FOLLOWUP_2_AFTER_MS = 22 * 60 * 60 * 1000;

/** Estágio máximo: depois do 2º empurrão a janela fecha e paramos. */
export const FOLLOWUP_MAX_STAGE = 2;

export const FOLLOWUP_MESSAGES: Record<1 | 2, string> = {
  1:
    "Oi! 😊 Vi que você chegou a mandar uma mensagem aqui no *Grupo Ideal* " +
    "mas acabamos não conversando.\n" +
    "Ainda posso te ajudar com informações sobre turmas, unidades ou a " +
    "matrícula 2027? É só me dizer o que você precisa. 🏫",
  2:
    "Oi! Passando só pra deixar o canal aberto. 🏫✨\n" +
    "Se quiser saber sobre turmas, valores ou agendar uma visita pra conhecer " +
    "a escola, é só responder aqui que eu te ajudo na hora. 😊",
};

export interface FollowupCandidate {
  temperature: string | null;
  botPaused: boolean;
  /** Timestamp (ms) da última mensagem DO CLIENTE — origem da janela de 24h. */
  lastUserAt: number;
  /** Timestamp (ms) da última mensagem de qualquer lado. */
  lastAt: number;
  /** Quantos empurrões já foram mandados (0, 1 ou 2). */
  followupStage: number;
  /** Timestamp (ms) do último empurrão, se houve. */
  followupAt: number | null;
}

/**
 * Qual empurrão mandar agora — ou null pra não mandar nada.
 *
 * A ordem também é a regra: as travas de segurança (bot pausado, janela da
 * Meta, estágio esgotado) vêm ANTES do cronograma, porque nenhuma delas pode
 * ser vencida por "já está na hora".
 */
export function nextFollowupStage(
  c: FollowupCandidate,
  now: number
): 1 | 2 | null {
  // Só frio recebe empurrão automático.
  if (c.temperature !== "frio") return null;
  // Humano assumiu a conversa — o robô não fala por cima.
  if (c.botPaused) return null;
  // Já mandamos os dois; não existe terceiro.
  if (c.followupStage >= FOLLOWUP_MAX_STAGE) return null;
  // Fora da janela de 24h da Meta a mensagem livre é recusada. Vale pros dois
  // estágios, inclusive pra leads antigos que já nasceram fora da janela.
  if (now - c.lastUserAt >= FREE_WINDOW_MS) return null;

  if (c.followupStage === 0) {
    return now - c.lastAt >= FOLLOWUP_1_AFTER_MS ? 1 : null;
  }
  // Estágio 1 → o 2º conta a partir do empurrão anterior, não do silêncio.
  const since = c.followupAt ?? c.lastAt;
  return now - since >= FOLLOWUP_2_AFTER_MS ? 2 : null;
}
