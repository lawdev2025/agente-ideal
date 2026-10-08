import { tokenSet } from "../learning/normalize";

/**
 * ALERTA DE CLIENTE INSATISFEITO (CRM).
 *
 * Em vez de mostrar a nota de satisfação de todo mundo, o CRM só destaca a
 * conversa que está dando problema: uma faixa embaixo da mensagem ("Cliente
 * irritado há 12 min · repetiu a pergunta 3× sem resposta útil") com o botão
 * "Assumir conversa", que desliga o bot e abre o chat.
 *
 * Tudo aqui é puro (sem banco/rede) pra ser testado caso a caso. Quem grava é
 * o orquestrador; quem desenha é public/app/app.js (alertHtml).
 */

// Uma mensagem sozinha já abre alerta se a nota dela for até isto
// ("que absurdo, já perguntei 3 vezes" lê ~0,9).
export const ALERTA_LEITURA_GRAVE = 1.5;
// Insatisfação sustentada: média do contato E mensagem atual abaixo disto.
export const ALERTA_MEDIA_RUIM = 2.5;
// Mesma pergunta repetida N vezes (contando a atual) abre alerta mesmo com o
// tom neutro — o cliente educado que pergunta 3× também está sendo mal atendido.
export const ALERTA_REPETICOES = 3;
// O alerta fecha sozinho quando o cliente se acalma: mensagem e média voltam a
// pelo menos isto.
export const ALERTA_RECUPERADO = 3;

const TITULO_POR_EMOCAO: Record<string, string> = {
  irritado: "Cliente irritado",
  frustrado: "Cliente frustrado",
  confuso: "Cliente confuso",
  ansioso: "Cliente ansioso",
};

// Texto fixo por motivo escolhido pelo Jev (MOTIVO_CRITERIA em jev-router.ts).
export const MOTIVO_TEXTO: Record<string, string> = {
  sem_resposta_util: "a resposta do bot não resolveu a dúvida",
  quer_valor: "quer o valor da mensalidade e não recebeu",
  ninguem_responde: "reclama que ninguém responde",
  resultado_seletiva: "problema com o resultado da Seletiva",
  quer_pessoa: "quer falar com uma pessoa, não com o robô",
  atendimento_ruim: "reclama do atendimento",
};

export interface AlertaInput {
  /** Nota desta mensagem (0-5), lida pelo Jev. */
  leitura: number;
  /** Média do contato já com esta leitura (nextSatisfaction). */
  media: number;
  emocao: string | null;
  motivo: string | null;
  /** Quantas vezes o cliente fez esta mesma pergunta, contando a atual. */
  repeticoes: number;
  /** Bot pausado = já tem humano na conversa: alerta não faz sentido. */
  botPausado: boolean;
  /** Já existe alerta aberto pra este contato? */
  alertaAberto: boolean;
}

export type AlertaAcao =
  | { acao: "abrir" | "atualizar"; titulo: string; motivo: string }
  | { acao: "encerrar" }
  | { acao: "nada" };

export function avaliarAlerta(i: AlertaInput): AlertaAcao {
  if (i.botPausado) return i.alertaAberto ? { acao: "encerrar" } : { acao: "nada" };

  const problema =
    i.leitura <= ALERTA_LEITURA_GRAVE ||
    (i.media < ALERTA_MEDIA_RUIM && i.leitura < ALERTA_MEDIA_RUIM) ||
    i.repeticoes >= ALERTA_REPETICOES;

  if (problema) {
    return {
      acao: i.alertaAberto ? "atualizar" : "abrir",
      titulo: tituloAlerta(i),
      motivo: motivoAlerta(i),
    };
  }
  if (i.alertaAberto && i.leitura >= ALERTA_RECUPERADO && i.media >= ALERTA_MEDIA_RUIM) {
    return { acao: "encerrar" };
  }
  return { acao: "nada" };
}

function tituloAlerta(i: AlertaInput): string {
  if (i.emocao && TITULO_POR_EMOCAO[i.emocao]) return TITULO_POR_EMOCAO[i.emocao];
  return i.leitura <= ALERTA_LEITURA_GRAVE ? "Cliente irritado" : "Cliente insatisfeito";
}

function motivoAlerta(i: AlertaInput): string {
  if (i.repeticoes >= 2) return `repetiu a pergunta ${i.repeticoes}× sem resposta útil`;
  return (i.motivo && MOTIVO_TEXTO[i.motivo]) || "insatisfeito com o atendimento";
}

// Mensagens anteriores do cliente comparadas com a atual.
const REPETICAO_JANELA = 10;
// Duas perguntas são "a mesma" quando compartilham pelo menos 2 palavras-chave
// e isso cobre metade da menor. Sobreposição pela MENOR (e não Jaccard) porque
// a repetição costuma vir mais longa e reformulada: "qual o valor da
// mensalidade?", "mas quanto é a mensalidade? preciso do valor" e "já é a
// terceira vez que pergunto o valor da mensalidade" são a mesma pergunta
// (com 60% a do meio escapava: 2 de 4 palavras).
const REPETICAO_MIN_COMUNS = 2;
const REPETICAO_COBERTURA = 0.5;

/**
 * Quantas vezes o cliente fez esta pergunta, contando a atual (1 = primeira).
 * Usa as palavras-chave do cache aprendido (sem stopwords, sem acento).
 */
export function contarRepeticoes(
  history: Array<{ role: string; content: string }>,
  userMessage: string
): number {
  const atual = tokenSet(userMessage);
  if (atual.size < REPETICAO_MIN_COMUNS) return 1;
  const anteriores = history.filter((m) => m.role === "user").slice(-REPETICAO_JANELA);
  let n = 1;
  for (const m of anteriores) {
    const t = tokenSet(m.content);
    let comuns = 0;
    for (const w of t) if (atual.has(w)) comuns++;
    const menor = Math.min(t.size, atual.size);
    if (comuns >= REPETICAO_MIN_COMUNS && menor > 0 && comuns / menor >= REPETICAO_COBERTURA) n++;
  }
  return n;
}
