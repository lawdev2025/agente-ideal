import { logger } from "../logger";

/**
 * Cliente do Jev (TypeSafe, "System One"). O Jev NÃO escreve texto: recebe um
 * `state` (aqui, o trecho da conversa) e perguntas fechadas, e devolve a opção
 * escolhida com probabilidades e confiança. É barato (US$ 0,042 / 1M tokens de
 * entrada, saída grátis) e rápido (~200-600 ms), então serve de "curador" entre
 * a mensagem do cliente e a resposta: decide QUAL resposta dar, e o texto
 * continua vindo dos handlers determinísticos / do LLM.
 *
 * Docs: https://docs.typesafe.ai/api
 *
 * Best-effort por contrato: qualquer erro, HTTP != 200 ou timeout devolve null.
 * O caller cai no roteador por regex — o Jev nunca derruba o atendimento.
 */

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export type JevCriteria = string | Record<string, unknown> | unknown[] | null;

export type JevQuestion =
  | { type: "choice"; instructions: JevCriteria; criteria: Record<string, JevCriteria> }
  | { type: "score"; instructions: JevCriteria; criteria: JevCriteria[] }
  | { type: "noul"; instructions: JevCriteria; criteria?: { true?: JevCriteria; false?: JevCriteria } };

export type JevAnswer =
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "score"; score: number; confidence: number; probabilities: Record<string, number> }
  | { type: "noul"; noul: number };

export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens: number; output_tokens: number };
  /** Medido por nós (ida e volta HTTP), não vem da API. */
  latencyMs: number;
}

export interface JevClientOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** Injetável pra teste. */
  fetchImpl?: typeof fetch;
}

export class JevClient {
  constructor(private opts: JevClientOptions) {}

  async evaluate(
    state: unknown,
    questions: Record<string, JevQuestion>
  ): Promise<JevResponse | null> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const started = Date.now();
    try {
      const res = await fetchImpl(JEV_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: this.opts.model, state, questions }),
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        logger.warn({ status: res.status, body: body.slice(0, 300) }, "Jev: HTTP != 200");
        return null;
      }
      const json = (await res.json()) as Omit<JevResponse, "latencyMs">;
      if (!json || typeof json.answers !== "object") {
        logger.warn("Jev: resposta sem answers");
        return null;
      }
      return { ...json, latencyMs: Date.now() - started };
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), ms: Date.now() - started },
        "Jev: chamada falhou (seguindo sem Jev)"
      );
      return null;
    }
  }
}
