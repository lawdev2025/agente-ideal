import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageOrchestrator } from "../src/worker/orchestrator";
import { LLMProvider } from "../src/llm/provider";
import { StateRepository } from "../src/state/repository";
import { WhatsAppClient } from "../src/whatsapp/client";
import { EscalationHandler } from "../src/handoff/telegram";

describe("Message Orchestrator", () => {
  let orchestrator: MessageOrchestrator;
  let mockLLM: LLMProvider;
  let mockStateRepo: StateRepository;
  let mockWhatsApp: WhatsAppClient;
  let mockEscalation: EscalationHandler;

  beforeEach(() => {
    mockLLM = {
      generateMessage: vi.fn(async () => ({
        message: "Test response",
        toolCalls: [],
      })),
    };

    mockStateRepo = {
      getConversation: vi.fn(async () => [
        { role: "user", content: "Hello", timestamp: new Date(), metadata: {} },
      ]),
      addMessage: vi.fn(async () => {}),
      getMessageHistory: vi.fn(async () => []),
      getContactInfo: vi.fn(async () => ({ phone: "123" })),
    } as unknown as StateRepository;

    mockWhatsApp = {
      sendMessage: vi.fn(async () => ({ messageId: "msg123" })),
      sendImage: vi.fn(async () => ({ messageId: "msg123" })),
      sendDocument: vi.fn(async () => ({ messageId: "msg123" })),
      markAsRead: vi.fn(async () => {}),
    } as unknown as WhatsAppClient;

    mockEscalation = {
      escalateToGroup: vi.fn(async () => ({ messageId: "esc123" })),
    } as unknown as EscalationHandler;

    orchestrator = new MessageOrchestrator(
      mockLLM,
      mockStateRepo,
      mockWhatsApp,
      mockEscalation
    );
  });

  it("should process message and send response", async () => {
    await orchestrator.processMessage("user123", "What is my balance?", "user123");

    expect(mockLLM.generateMessage).toHaveBeenCalled();
    expect(mockStateRepo.addMessage).toHaveBeenCalled();
    expect(mockWhatsApp.sendMessage).toHaveBeenCalled();
  });

  it("should handle tool calls", async () => {
    const mockLLMWithTools = {
      generateMessage: vi
        .fn()
        .mockResolvedValueOnce({
          message: "Let me check your balance",
          toolCalls: [
            {
              id: "call1",
              name: "get_tuition_info",
              arguments: { student_id: "STU001" },
            },
          ],
        })
        .mockResolvedValueOnce({
          message: "Your balance is R$ 500",
          toolCalls: [],
        }),
    };

    orchestrator = new MessageOrchestrator(
      mockLLMWithTools,
      mockStateRepo,
      mockWhatsApp,
      mockEscalation
    );

    await orchestrator.processMessage("user123", "What is my balance?", "user123");

    expect(mockLLMWithTools.generateMessage).toHaveBeenCalledTimes(2);
  });

  it("should escalate on error", async () => {
    const errorLLM = {
      generateMessage: vi.fn(async () => {
        throw new Error("LLM error");
      }),
    };

    orchestrator = new MessageOrchestrator(
      errorLLM,
      mockStateRepo,
      mockWhatsApp,
      mockEscalation
    );

    await orchestrator.processMessage("user123", "Hello", "user123");

    expect(mockEscalation.escalateToGroup).toHaveBeenCalled();
    expect(mockWhatsApp.sendMessage).toHaveBeenCalled();
  });

  it("should store conversation history", async () => {
    await orchestrator.processMessage("user123", "Hello", "user123");

    expect(mockStateRepo.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "user123",
        role: expect.any(String),
      })
    );
  });
});
