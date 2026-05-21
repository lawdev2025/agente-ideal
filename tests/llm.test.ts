import { describe, it, expect, vi, beforeEach } from "vitest";
import { GeminiProvider } from "../src/llm/gemini";

// Mock the Google Generative AI
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: vi.fn(() => ({
    getGenerativeModel: vi.fn(() => ({
      startChat: vi.fn(() => ({
        sendMessage: vi.fn(async () => ({
          response: {
            text: () => "This is a test response",
            functionCalls: () => null,
          },
        })),
      })),
    })),
  })),
  SchemaType: {
    OBJECT: "OBJECT",
  },
}));

describe("LLM Provider", () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider("test-api-key");
  });

  it("should generate a message", async () => {
    const response = await provider.generateMessage(
      "Hello, what is my balance?",
      [{ role: "user", content: "Hello" }],
      [
        {
          name: "get_balance",
          description: "Get the balance",
          inputSchema: { properties: {}, required: [] },
        },
      ]
    );

    expect(response.message).toBeDefined();
    expect(typeof response.message).toBe("string");
  });

  it("should handle conversation history", async () => {
    const history = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello! How can I help?" },
    ];

    const response = await provider.generateMessage(
      "What is my tuition?",
      history
    );

    expect(response.message).toBeDefined();
  });

  it("should return empty tool calls when none are made", async () => {
    const response = await provider.generateMessage(
      "Just say hello",
      [],
      []
    );

    expect(response.toolCalls).toBeUndefined();
  });
});
