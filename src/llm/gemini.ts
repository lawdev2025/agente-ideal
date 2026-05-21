import { GoogleGenerativeAI } from "@google/generative-ai";
import { LLMProvider } from "./provider";
import { SYSTEM_PROMPT } from "./prompts/system-prompt";
import { logger } from "../logger";

export class GeminiProvider implements LLMProvider {
  private client: GoogleGenerativeAI;
  private model: string;

  constructor(apiKey: string, model: string = "gemini-2.0-flash") {
    this.client = new GoogleGenerativeAI(apiKey);
    this.model = model;
  }

  async generateMessage(
    userMessage: string,
    conversationHistory: Array<{ role: string; content: string }>,
    tools?: Array<{
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }>
  ): Promise<{
    message: string;
    toolCalls?: Array<{
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }>;
  }> {
    try {
      const model = this.client.getGenerativeModel({
        model: this.model,
        systemInstruction: SYSTEM_PROMPT,
        tools: tools
          ? [
              {
                functionDeclarations: tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  parameters: {
                    type: "OBJECT",
                    properties: tool.inputSchema.properties || {},
                    required: tool.inputSchema.required || [],
                  },
                })),
              },
            ]
          : undefined,
      });

      const chat = model.startChat({
        history: conversationHistory.map((msg) => ({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        })),
      });

      const response = await chat.sendMessage(userMessage);
      const text = response.text();

      // Extract function calls if any
      const toolCalls = response.functionCalls()?.map((call) => ({
        id: call.name,
        name: call.name,
        arguments: call.args as Record<string, unknown>,
      }));

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
