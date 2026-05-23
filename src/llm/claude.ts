import Anthropic from "@anthropic-ai/sdk";
import { LLMProvider, GenerateOptions } from "./provider";
import { SYSTEM_PROMPT } from "./prompts/system-prompt";
import { logger } from "../logger";

/**
 * Anthropic Claude provider.
 *
 * Prompt caching is enabled on the system prompt — Anthropic charges 90% less
 * for cache reads (US$ 0.10/MTok vs US$ 1.00/MTok), which more than offsets
 * the 25% write premium for any conversation longer than ~2 turns. With the
 * SYSTEM_PROMPT around 500 tokens and most production traffic hitting it
 * repeatedly within the 5-minute cache TTL, this typically cuts input cost
 * by 60-80% in practice.
 */
export class ClaudeProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;
  private apiKey: string;

  constructor(
    apiKey: string,
    model: string = "claude-haiku-4-5-20251001"
  ) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
    this.apiKey = apiKey;
  }

  async generateMessage(
    userMessage: string,
    conversationHistory: Array<{ role: string; content: string }>,
    tools?: Array<{
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }>,
    options?: GenerateOptions
  ): Promise<{
    message: string;
    toolCalls?: Array<{
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }>;
  }> {
    // Modo de Simulação Local quando a chave do Claude for fictícia
    if (this.apiKey === "dummy_claude_key" || this.apiKey.startsWith("dummy_")) {
      logger.info({ userMessage, model: this.model }, "Claude Mock Mode ativado (chave fictícia detectada)");
      
      let replyMessage = `Olá! Sou a Ana, assistente virtual do Colégio Ideal (Modo Simulado - Claude Haiku).

Como você está sem uma chave da Anthropic real no seu arquivo \`.env\`, eu entrei no modo de simulação do **Claude Haiku** para ajudar você a testar o fluxo de forma local e ágil!

Você enviou a mensagem: "${userMessage}". Como posso te ajudar hoje?`;

      const lower = userMessage.toLowerCase();
      if (lower.includes("mensalidade") || lower.includes("pagar") || lower.includes("preço") || lower.includes("valor")) {
        replyMessage = `Olá! Sou a Ana do Colégio Ideal (Modo Simulado - Claude Haiku).

Sobre as mensalidades, o valor padrão para o ano letivo de 2026 é de R$ 1.200,00 com vencimento todo dia 05 de cada mês. Pagamentos realizados antecipadamente até o dia 01 possuem 5% de desconto especial!

Deseja saber mais sobre as formas de pagamento?`;
      } else if (lower.includes("aula") || lower.includes("cronograma") || lower.includes("horário") || lower.includes("calendário")) {
        replyMessage = `Olá! Sou a Ana do Colégio Ideal (Modo Simulado - Claude Haiku).

As nossas aulas ocorrem de segunda a sexta-feira nos seguintes horários:
- **Ensino Fundamental**: 07:30 às 12:00
- **Ensino Médio**: 13:15 às 17:45

O calendário letivo e de provas está disponível no portal do aluno. Gostaria de tirar mais alguma dúvida?`;
      } else if (lower.includes("suporte") || lower.includes("atendente") || lower.includes("humano") || lower.includes("falar com alguém")) {
        replyMessage = `Entendido! Estou acionando a nossa equipe de suporte humana neste momento. Um especialista entrará em contato com você diretamente pelo WhatsApp! (Simulação de escalação para suporte via Telegram ativada com sucesso).`;
      }

      // Adiciona um pequeno delay de 600ms para simular a latência natural de uma chamada de IA
      await new Promise((resolve) => setTimeout(resolve, 600));

      return {
        message: replyMessage,
      };
    }

    try {
      const systemText = options?.systemPromptOverride ?? SYSTEM_PROMPT;

      // Anthropic expects messages in user/assistant turns. The orchestrator
      // stores "tool" roles for tool results; we fold those into the previous
      // assistant turn as plain text so Claude sees the data without us
      // needing to model formal tool_use/tool_result blocks for the legacy
      // history. New tool calls in THIS turn still use the proper schema.
      const messages = this.buildMessages(conversationHistory, userMessage);

      const anthropicTools = (tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      }));

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: [
          {
            type: "text",
            text: systemText,
            // Cache the system prompt — it's identical across calls and
            // dominates the input on short conversations.
            cache_control: { type: "ephemeral" },
          },
        ],
        messages,
        ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
      });

      let text = "";
      const toolCalls: Array<{
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      }> = [];

      for (const block of response.content) {
        if (block.type === "text") {
          text += block.text;
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: (block.input as Record<string, unknown>) ?? {},
          });
        }
      }

      logger.info(
        {
          model: this.model,
          toolCalls: toolCalls.length,
          messageLength: text.length,
          inputTokens: response.usage.input_tokens,
          cachedTokens: response.usage.cache_read_input_tokens ?? 0,
          outputTokens: response.usage.output_tokens,
        },
        "Claude response generated"
      );

      return {
        message: text,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    } catch (error) {
      logger.error({ error }, "Error generating message with Claude");
      throw error;
    }
  }

  private buildMessages(
    history: Array<{ role: string; content: string }>,
    currentUserMessage: string
  ): Anthropic.MessageParam[] {
    const out: Anthropic.MessageParam[] = [];
    let pendingAssistantText: string[] = [];

    const flushAssistant = () => {
      if (pendingAssistantText.length === 0) return;
      out.push({
        role: "assistant",
        content: pendingAssistantText.join("\n").trim(),
      });
      pendingAssistantText = [];
    };

    for (const m of history) {
      if (m.role === "user") {
        flushAssistant();
        out.push({ role: "user", content: m.content });
      } else if (m.role === "assistant") {
        pendingAssistantText.push(m.content);
      } else if (m.role === "tool") {
        // Fold tool results into the assistant turn that consumed them.
        // For the orchestrator's deterministic flow, the phrasing call is
        // expected to read from the history, so the tool output landing
        // here as assistant context is sufficient.
        pendingAssistantText.push(`[Resultado da ferramenta] ${m.content}`);
      }
    }
    flushAssistant();

    // Anthropic requires the conversation to end with a user turn. If the
    // last history message was already a user turn (rare), we append the
    // current message on top of the prior user turn merged — otherwise we
    // just push it as a new user turn.
    const last = out[out.length - 1];
    if (last && last.role === "user") {
      last.content = `${last.content}\n\n${currentUserMessage}`;
    } else {
      out.push({ role: "user", content: currentUserMessage });
    }

    // Anthropic also requires that messages start with a user turn. If the
    // first turn is assistant (because the bot greeted first), prepend a
    // synthetic empty user turn — never happens in our flow but defensive.
    if (out.length > 0 && out[0].role !== "user") {
      out.unshift({ role: "user", content: "(início da conversa)" });
    }

    return out;
  }
}
