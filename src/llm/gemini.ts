import {
  GoogleGenerativeAI,
  SchemaType,
  FunctionDeclaration,
  Tool,
} from "@google/generative-ai";
import { LLMProvider, GenerateOptions } from "./provider";
import { SYSTEM_PROMPT } from "./prompts/system-prompt";
import { logger } from "../logger";

export class GeminiProvider implements LLMProvider {
  private client: GoogleGenerativeAI;
  private model: string;
  private apiKey: string;

  constructor(apiKey: string, model: string = "gemini-2.0-flash") {
    this.client = new GoogleGenerativeAI(apiKey);
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
    // Modo de Simulação Local quando a chave for fictícia
    if (this.apiKey === "dummy_gemini_key" || this.apiKey.startsWith("dummy_")) {
      logger.info({ userMessage }, "Gemini Mock Mode ativado (chave fictícia detectada)");
      
      let replyMessage = `Olá! Sou a Ana, assistente virtual do Colégio Ideal (Modo Simulado de Depuração).

Como você está sem uma chave de API real no seu arquivo \`.env\`, eu entrei em modo de simulação automática para ajudar você a testar o fluxo completo!

Você enviou a mensagem: "${userMessage}". Como posso te ajudar hoje?`;

      const lower = userMessage.toLowerCase();
      if (lower.includes("mensalidade") || lower.includes("pagar") || lower.includes("preço") || lower.includes("valor")) {
        replyMessage = `Olá! Sou a Ana do Colégio Ideal (Modo Simulado).

Sobre as mensalidades, o valor padrão para o ano letivo de 2026 é de R$ 1.200,00 com vencimento todo dia 05 de cada mês. Pagamentos realizados antecipadamente até o dia 01 possuem 5% de desconto especial!

Deseja saber mais sobre as formas de pagamento?`;
      } else if (lower.includes("aula") || lower.includes("cronograma") || lower.includes("horário") || lower.includes("calendário")) {
        replyMessage = `Olá! Sou a Ana do Colégio Ideal (Modo Simulado).

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
      const functionDeclarations: FunctionDeclaration[] = (tools || []).map(
        (tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: {
            type: SchemaType.OBJECT,
            properties: (tool.inputSchema.properties as Record<string, any>) || {},
            required: (tool.inputSchema.required as string[]) || [],
          },
        })
      );

      const modelTools: Tool[] | undefined =
        functionDeclarations.length > 0
          ? [{ functionDeclarations }]
          : undefined;

      const model = this.client.getGenerativeModel({
        model: this.model,
        systemInstruction: options?.systemPromptOverride ?? SYSTEM_PROMPT,
        tools: modelTools,
      });

      const chat = model.startChat({
        history: conversationHistory.map((msg) => ({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        })),
      });

      const response = await chat.sendMessage(userMessage);

      // Get text content
      let text = "";
      const contentResponse = response.response;
      if (contentResponse && contentResponse.text) {
        text = contentResponse.text();
      }

      // Extract function calls if any
      let toolCalls: Array<{
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      }> | undefined;

      const functionCalls = contentResponse?.functionCalls?.();
      if (functionCalls && functionCalls.length > 0) {
        toolCalls = functionCalls.map((call) => ({
          id: call.name,
          name: call.name,
          arguments: (call.args as Record<string, unknown>) || {},
        }));
      }

      logger.info(
        {
          toolCalls: toolCalls?.length || 0,
          messageLength: text.length,
        },
        "Gemini response generated"
      );

      return {
        message: text,
        toolCalls,
      };
    } catch (error) {
      logger.error({ error }, "Error generating message with Gemini");
      throw error;
    }
  }
}
