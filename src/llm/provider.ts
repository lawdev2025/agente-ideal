export interface LLMProvider {
  generateMessage(
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
  }>;
}
