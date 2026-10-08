import { JevClient, JevQuestion, JevResponse } from "../llm/jev";
import { DirectResponse } from "../kb/direct-responses";
import { NIVEL_MILITAR } from "./intent-router";

/**
 * Jev como CURADOR de intenção: lê a conversa e escolhe qual das respostas que
 * o bot JÁ sabe dar é a certa. Substitui (no modo live) a cascata de regex do
 * orquestrador, onde a primeira palavra-chave que bate decide tudo e a ordem
 * dos ifs vale mais que o sentido da frase.
 *
 * Uma chamada só, com 4 perguntas avaliadas em paralelo pelo Jev:
 *   - rota:    Choice entre as respostas do bot (+ cada linha da school_faq)
 *   - unidade: Choice entre as 3 unidades
 *   - nivel:   Choice entre os segmentos
 *   - humano:  Noul — o cliente pediu um atendente?
 *
 * Os ids de rota são os MESMOS rótulos que o orquestrador grava como
 * `legacy_route` no modo sombra, pra comparar regex × Jev direto no banco.
 */

export type JevRoute =
  | "conversa"
  | "humano"
  | "fora_escopo"
  | "passaporte_ideal"
  | "seletiva_resultado"
  | "seletiva_resultado_nao_recebido"
  | "seletiva_prova"
  | "seletiva_edital"
  | "seletiva_agendamento"
  | "seletiva_pagamento_inscricao"
  | "pagamento"
  | "valores"
  | "matricula"
  | "nivel_info"
  | "visita"
  | "unidade_info"
  | "contato"
  | "documento"
  | "rematricula"
  | "transferencia"
  | "resposta_unidade"
  | "bolsa_desconto"
  | "transporte_alimentacao"
  | "evento_calendario"
  | "duvida_geral"
  | "outro";

// Descrições: "cobre" diz o que é; "nao_cobre" separa das rotas vizinhas que
// confundem (a doc do Jev recomenda isso pra opções parecidas). Mudou uma
// resposta do bot? Atualize a descrição aqui — é ela que o Jev lê.
export const ROUTE_CRITERIA: Record<JevRoute, unknown> = {
  conversa: {
    cobre: "cumprimento, dizer o próprio nome, agradecer, 'ok', 'certo', confirmar algo, despedida — sem pergunta concreta",
  },
  humano: {
    cobre: "pede explicitamente para falar com atendente, pessoa, humano, alguém de verdade",
  },
  fora_escopo: {
    cobre: "assunto sem nenhuma relação com escola: futebol, política, piada, propaganda, spam",
  },
  passaporte_ideal: {
    cobre: "Passaporte Ideal, taxa de pré-matrícula, reservar a vaga pagando antes",
  },
  seletiva_resultado: {
    cobre: "resultado da Seletiva / prova de bolsa: quando sai, se passou, qual a nota, qual o desconto que ganhou",
    nao_cobre: "quem diz que NÃO recebeu o e-mail do resultado (seletiva_resultado_nao_recebido)",
  },
  seletiva_resultado_nao_recebido: {
    cobre: "fez a Seletiva e diz que não recebeu o resultado / o e-mail não chegou",
  },
  seletiva_prova: {
    cobre: "dia, horário ou local da prova/teste da Seletiva já agendado; chegar atrasado; o que levar no dia",
  },
  seletiva_edital: {
    cobre: "conteúdo da prova da Seletiva, edital, o que estudar, qual série estudar para a prova",
    nao_cobre: "preparação para vestibular, ENEM ou concurso militar (nivel_info)",
  },
  seletiva_agendamento: {
    cobre: "quer fazer a Seletiva / prova de bolsa, se inscrever, perdeu o prazo, agendar o teste",
    nao_cobre: "bolsa ou desconto em geral sem citar Seletiva/prova (bolsa_desconto)",
  },
  seletiva_pagamento_inscricao: {
    cobre: "já pagou a taxa de inscrição da Seletiva e quer confirmação / comprovante",
  },
  pagamento: {
    cobre: "como ou onde pagar mensalidade, boleto, segunda via de boleto, prova de segunda chamada",
    nao_cobre: "quanto custa (valores)",
  },
  valores: {
    cobre: "preço, mensalidade, quanto custa, valor da matrícula, valor do material, taxa",
  },
  matricula: {
    cobre: "quer matricular um aluno novo / saber como funciona a matrícula, sem pedir preço",
    nao_cobre: "aluno que já estuda no Ideal renovando (rematricula); preço (valores)",
  },
  nivel_info: {
    cobre: "pergunta sobre uma série ou segmento: se tem a série, turno, horário das aulas, o que o segmento oferece; quer se preparar para ENEM, vestibular ou concurso militar (EsPCEx, EFOMM, AFA)",
  },
  visita: {
    cobre: "quer visitar / conhecer a escola, agendar visita, pede 'o link'",
  },
  unidade_info: {
    cobre: "endereço, onde fica, como chegar, estrutura, quadra, laboratório, horário de funcionamento de uma unidade",
  },
  contato: {
    cobre: "pede telefone, número, contato da secretaria ou da coordenação",
  },
  documento: {
    cobre: "boletim, histórico escolar, declaração, atestado, segunda via de documento",
  },
  rematricula: {
    cobre: "aluno que JÁ estuda no Ideal renovando a matrícula, rematrícula, Portal do Aluno",
  },
  transferencia: {
    cobre: "quer transferir o filho de outra escola para o Ideal, mudar de escola",
  },
  resposta_unidade: {
    cobre: "o colégio acabou de perguntar qual unidade e o cliente está só respondendo o nome da unidade",
  },
  bolsa_desconto: {
    cobre: "bolsa de estudos, desconto (irmão, pagamento à vista), negociação, financiamento — sem citar Seletiva",
  },
  transporte_alimentacao: {
    cobre: "transporte escolar, van, ônibus, merenda, alimentação, cantina",
  },
  evento_calendario: {
    cobre: "calendário escolar, reunião de pais, formatura, festa, excursão, início das aulas",
  },
  duvida_geral: {
    cobre: "outra pergunta sobre o colégio que não se encaixa nas opções acima (uniforme, metodologia, Poliedro etc.)",
  },
  outro: "nenhuma opção se aplica",
};

export const NIVEL_CRITERIA: Record<string, unknown> = {
  infantil: "Educação Infantil, maternal, jardim, creche, Ideal Júnior",
  fundamental_1: "1º ao 5º ano, Fundamental 1, primário",
  fundamental_2: "6º ao 9º ano, Fundamental 2",
  medio: "Ensino Médio, 1ª ou 2ª série",
  pre_enem: "3º ano do médio, terceirão, Pré-Enem, Eixo, cursinho, vestibular",
  militar: "o cliente cita concurso ou carreira militar: EsPCEx, EFOMM, AFA, IME, ITA, Colégio Naval, Exército",
  nenhum: "a conversa NÃO cita série, ano nem segmento",
};

const NIVEL_LABEL: Record<string, string | undefined> = {
  infantil: "Educação Infantil",
  fundamental_1: "Fundamental 1",
  fundamental_2: "Fundamental 2",
  medio: "Ensino Médio",
  pre_enem: "Pré-Enem",
  militar: NIVEL_MILITAR,
  nenhum: undefined,
};

export const UNIDADE_CRITERIA: Record<string, unknown> = {
  batista_campos: "Batista Campos (sede)",
  augusto_montenegro: "Augusto Montenegro",
  cidade_nova: "Cidade Nova / Ananindeua",
  nenhuma: "a conversa não indica unidade",
};

const UNIDADE_LABEL: Record<string, string | undefined> = {
  batista_campos: "Batista Campos",
  augusto_montenegro: "Augusto Montenegro",
  cidade_nova: "Cidade Nova",
  nenhuma: undefined,
};

const FAQ_PREFIX = "faq:";
const STATE_TURNS = 6;
const STATE_CHARS_PER_TURN = 500;

// Acima disto a mensagem é tratada como continuação (o cliente só entregou o
// que o colégio pediu) e quem responde é o LLM com o contexto — a rota de
// assunto é ignorada. Calibrado na avaliação de 08/10/2026 (scripts/jev-eval.ts).
export const CONTINUACAO_MIN = 0.8;
// Pedido de humano PAUSA o bot, então só vale com o Noul bem alto. Abaixo
// disto ("vou passar aí pra conversarmos" deu 0,90) usamos a 2ª rota.
export const HUMANO_MIN = 0.95;

export interface JevDecision {
  /**
   * Ação final: uma JevRoute, "faq:<id>" (linha da school_faq) ou
   * "continuacao". Já aplica CONTINUACAO_MIN e HUMANO_MIN sobre `rawRoute`.
   */
  route: string;
  /** A opção que o Jev escolheu na pergunta `rota`, antes das regras. */
  rawRoute: string;
  confidence: number;
  /** Probabilidade (0-1) de a mensagem só continuar a conversa. */
  continuacao: number;
  /** As 3 rotas mais prováveis, pra auditoria. */
  top: Array<{ route: string; p: number }>;
  unit?: string;
  unitConfidence: number;
  nivel?: string;
  nivelConfidence: number;
  /** Probabilidade (0-1) de o cliente ter pedido um humano. */
  humano: number;
  model: string;
  latencyMs: number;
  inputTokens: number | null;
}

export interface JevState {
  ultima_fala_do_colegio: string | null;
  mensagem_atual_do_cliente: string;
  conversa_anterior: Array<{ quem: string; texto: string }>;
}

/**
 * Conversa no formato que o Jev lê. A última fala do colégio vai num campo
 * PRÓPRIO: é comparando "o que o colégio pediu" com "o que o cliente mandou"
 * que o Jev reconhece uma continuação ("Dela", um e-mail, "enviei"). Numa lista
 * corrida ele só via o assunto da conversa e escolhia a rota do assunto.
 * Mensagens de tool ficam de fora: são ruído pra decidir intenção.
 */
export function buildJevState(
  history: Array<{ role: string; content: string }>,
  userMessage: string
): JevState {
  const turns = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-STATE_TURNS)
    .map((m) => ({
      quem: m.role === "user" ? "cliente" : "colegio",
      texto: m.content.slice(0, STATE_CHARS_PER_TURN),
    }));
  const last = turns[turns.length - 1];
  const ultimaDoColegio = last?.quem === "colegio" ? turns.pop()!.texto : null;
  return {
    ultima_fala_do_colegio: ultimaDoColegio,
    mensagem_atual_do_cliente: userMessage.slice(0, STATE_CHARS_PER_TURN),
    conversa_anterior: turns,
  };
}

export function buildJevQuestions(faqs: DirectResponse[] = []): Record<string, JevQuestion> {
  const rotaCriteria: Record<string, unknown> = { ...ROUTE_CRITERIA };
  for (const f of faqs) {
    if (!f.resposta) continue;
    rotaCriteria[`${FAQ_PREFIX}${f.id}`] = {
      cobre: `pergunta sobre: ${String(f.gatilhos || "").replace(/\s+/g, " ").slice(0, 200)}`,
      resposta_cadastrada: f.resposta.replace(/\s+/g, " ").slice(0, 200),
    };
  }
  return {
    rota: {
      type: "choice",
      instructions:
        "Conversa de WhatsApp com o Colégio Ideal (escola em Belém-PA). Qual opção responde a `mensagem_atual_do_cliente`? Use `ultima_fala_do_colegio` e `conversa_anterior` só como contexto.",
      criteria: rotaCriteria as Record<string, never>,
    },
    unidade: {
      type: "choice",
      instructions: "Qual unidade do Colégio Ideal o cliente quer, considerando a conversa toda?",
      criteria: UNIDADE_CRITERIA as Record<string, never>,
    },
    nivel: {
      type: "choice",
      instructions: "Qual série ou segmento o cliente citou na conversa? Se nenhuma série/segmento foi citado, escolha nenhum.",
      criteria: NIVEL_CRITERIA as Record<string, never>,
    },
    humano: {
      type: "noul",
      instructions: "Em `mensagem_atual_do_cliente`, o cliente pede para falar com um atendente humano por aqui?",
      criteria: {
        true: "pede atendente, pessoa, humano ou alguém específico para falar com ele agora",
        false: "qualquer outra coisa, inclusive dizer que vai passar na escola, agradecer ou se despedir",
      },
    },
    continuacao: {
      type: "noul",
      instructions:
        "A `mensagem_atual_do_cliente` apenas responde ou entrega o que o colégio pediu em `ultima_fala_do_colegio` (um e-mail, um nome, 'dela', 'enviei', 'ok', 'sim'), sem trazer pergunta nem assunto novo?",
      criteria: {
        true: "só entrega o dado pedido, confirma ou responde à pergunta do colégio",
        false: "faz uma pergunta nova, muda de assunto, pede algo novo ou o colégio não tinha perguntado nada",
      },
    },
  };
}

export function parseJevDecision(res: JevResponse): JevDecision | null {
  const rota = res.answers.rota;
  if (!rota || rota.type !== "choice") return null;
  const unidade = res.answers.unidade;
  const nivel = res.answers.nivel;
  const humano = res.answers.humano;
  const continuacao = res.answers.continuacao;
  const top = Object.entries(rota.probabilities ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([route, p]) => ({ route, p }));
  const pHumano = humano?.type === "noul" ? humano.noul : 0;
  const pContinuacao = continuacao?.type === "noul" ? continuacao.noul : 0;
  return {
    route: finalRoute(rota.choice, top, pHumano, pContinuacao),
    rawRoute: rota.choice,
    confidence: rota.confidence,
    continuacao: pContinuacao,
    top,
    unit: unidade?.type === "choice" ? UNIDADE_LABEL[unidade.choice] : undefined,
    unitConfidence: unidade?.type === "choice" ? unidade.confidence : 0,
    nivel: nivel?.type === "choice" ? NIVEL_LABEL[nivel.choice] : undefined,
    nivelConfidence: nivel?.type === "choice" ? nivel.confidence : 0,
    humano: pHumano,
    model: res.model,
    latencyMs: res.latencyMs,
    inputTokens: res.usage?.input_tokens ?? null,
  };
}

/**
 * Regras sobre a escolha bruta do Jev:
 *  - continuação vence o assunto — exceto resposta_unidade, que É continuação
 *    mas tem handler determinístico próprio (grava a unidade e manda o link);
 *  - "humano" sem Noul alto vira a 2ª rota mais provável.
 */
function finalRoute(
  raw: string,
  top: Array<{ route: string; p: number }>,
  pHumano: number,
  pContinuacao: number
): string {
  if (raw !== "resposta_unidade" && pContinuacao >= CONTINUACAO_MIN) return "continuacao";
  if (raw === "humano" && pHumano < HUMANO_MIN) {
    return top.find((t) => t.route !== "humano")?.route ?? "conversa";
  }
  return raw;
}

export async function classifyWithJev(
  client: JevClient,
  history: Array<{ role: string; content: string }>,
  userMessage: string,
  faqs: DirectResponse[] = []
): Promise<JevDecision | null> {
  const res = await client.evaluate(buildJevState(history, userMessage), buildJevQuestions(faqs));
  return res ? parseJevDecision(res) : null;
}

// Rótulos legados que significam "o LLM respondeu livre" — batem com qualquer
// rota de conversa/dúvida genérica do Jev.
const LIVRE_EQUIVALENTES = new Set(["conversa", "duvida_geral", "outro", "continuacao"]);

/**
 * Regex e Jev escolheram a mesma resposta? Usado só pra métrica do modo sombra.
 * Rótulos fora do domínio de comparação (reiniciar, limite, pausado) → null.
 */
export function routesAgree(legacy: string, jev: string): boolean | null {
  if (legacy === "reiniciar" || legacy === "limite" || legacy === "pausado") return null;
  if (legacy === jev) return true;
  if (legacy === "faq" && jev.startsWith(FAQ_PREFIX)) return true;
  if (legacy === "llm_livre" && LIVRE_EQUIVALENTES.has(jev)) return true;
  return false;
}
