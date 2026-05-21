import { LLMProvider } from "../llm/provider";
import { StateRepository } from "../state/repository";
import { executeKBTool, getToolDefinitions } from "../kb/tools";
import { WhatsAppClient } from "../whatsapp/client";
import { EscalationHandler } from "../handoff/telegram";
import { logger } from "../logger";

export interface ConversationMessage {
  role: string;
  content: string;
}

export class MessageOrchestrator {
  constructor(
    private llmProvider: LLMProvider,
    private stateRepository: StateRepository,
    private whatsappClient: WhatsAppClient,
    private escalationHandler: EscalationHandler
  ) {}

  async processMessage(
    conversationId: string,
    userMessage: string,
    studentId: string
  ): Promise<void> {
    try {
      logger.info(
        { conversationId, messageLength: userMessage.length },
        "Processing message"
      );

      // Get conversation history
      const history = await this.stateRepository.getConversation(conversationId);

      // Format conversation for LLM
      const conversationHistory: ConversationMessage[] = history.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      // Generate response with tools
      const tools = getToolDefinitions();
      const response = await this.llmProvider.generateMessage(
        userMessage,
        conversationHistory,
        tools
      );

      // Store assistant message
      await this.stateRepository.addMessage({
        conversationId,
        role: "assistant",
        content: response.message,
        timestamp: new Date(),
        metadata: { hasToolCalls: !!response.toolCalls?.length },
      });

      // Execute tool calls if any
      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const toolCall of response.toolCalls) {
          try {
            logger.info(
              { toolName: toolCall.name, argsLength: Object.keys(toolCall.arguments).length },
              "Executing tool"
            );

            const toolResult = await executeKBTool(
              toolCall.name,
              toolCall.arguments
            );

            // Store tool execution result
            await this.stateRepository.addMessage({
              conversationId,
              role: "system",
              content: `Tool ${toolCall.name} result: ${toolResult}`,
              timestamp: new Date(),
              metadata: {
                type: "tool_result",
                toolName: toolCall.name,
              },
            });

            // Generate follow-up message with tool results
            const updatedHistory = await this.stateRepository.getConversation(
              conversationId
            );
            const updatedConversationHistory: ConversationMessage[] =
              updatedHistory.map((msg) => ({
                role: msg.role,
                content: msg.content,
              }));

            const followUpResponse = await this.llmProvider.generateMessage(
              `Based on the tool results: ${toolResult}`,
              updatedConversationHistory,
              tools
            );

            // Send response to WhatsApp
            await this.whatsappClient.sendMessage(
              studentId,
              followUpResponse.message
            );

            logger.info(
              { conversationId, toolName: toolCall.name },
              "Tool execution completed"
            );
          } catch (toolError) {
            logger.error(
              { error: toolError, toolName: toolCall.name },
              "Tool execution failed"
            );

            // Escalate on tool failure
            await this.escalateToSpecialist(
              conversationId,
              studentId,
              `Tool execution failed: ${toolCall.name}`
            );
          }
        }
      } else {
        // No tools called, send response directly
        await this.whatsappClient.sendMessage(studentId, response.message);

        logger.info({ conversationId }, "Message sent to WhatsApp");
      }
    } catch (error) {
      logger.error({ error, conversationId }, "Error processing message");

      // Escalate on general error
      await this.escalateToSpecialist(
        conversationId,
        studentId,
        `Error processing message: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async escalateToSpecialist(
    conversationId: string,
    studentId: string,
    reason: string
  ): Promise<void> {
    try {
      const history = await this.stateRepository.getConversation(conversationId);
      const context = history
        .slice(-5)
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");

      await this.escalationHandler.escalateToGroup(
        studentId,
        reason,
        context
      );

      // Notify user
      await this.whatsappClient.sendMessage(
        studentId,
        "Sua solicitação foi escalada para um especialista. Você será atendido em breve!"
      );

      logger.info({ conversationId, studentId }, "Issue escalated to specialist");
    } catch (escalationError) {
      logger.error(
        { error: escalationError },
        "Failed to escalate to specialist"
      );
    }
  }
}
