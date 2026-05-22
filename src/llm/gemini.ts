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
