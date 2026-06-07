export interface GenerateOptions {
  systemPromptOverride?: string;
  /**
   * Rótulo do fluxo que originou a chamada (ex: "phrasing", "chat"). Só serve
   * pra telemetria: aparece nos logs do provider pra medir tokens/cache por
   * fluxo sem alterar comportamento.
   */
  flow?: string;
}

export interface LLMProvider {
  generateMessage(
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
  }>;
}
