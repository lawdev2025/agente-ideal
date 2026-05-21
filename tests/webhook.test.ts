import { describe, it, expect, beforeEach, vi } from "vitest";
import { validateMetaSignature, generateMetaSignature } from "../src/webhook/signature";

describe("Webhook Signature", () => {
  const secret = "test-secret";
  const payload = JSON.stringify({ test: "data" });

  it("should generate valid signature", () => {
    const signature = generateMetaSignature(payload, secret);
    expect(signature).toBeDefined();
    expect(signature).toHaveLength(64);
  });

  it("should validate correct signature", () => {
    const signature = generateMetaSignature(payload, secret);
    const isValid = validateMetaSignature(payload, signature, secret);
    expect(isValid).toBe(true);
  });

  it("should reject invalid signature", () => {
    const validSignature = generateMetaSignature(payload, secret);
    const invalidSignature = "0".repeat(64);
    const isValid = validateMetaSignature(payload, invalidSignature, secret);
    expect(isValid).toBe(false);
  });

  it("should reject signature with wrong payload", () => {
    const signature = generateMetaSignature(payload, secret);
    const differentPayload = JSON.stringify({ different: "data" });
    const isValid = validateMetaSignature(differentPayload, signature, secret);
    expect(isValid).toBe(false);
  });

  it("should reject signature with wrong secret", () => {
    const signature = generateMetaSignature(payload, secret);
    const wrongSecret = "wrong-secret";
    const isValid = validateMetaSignature(payload, signature, wrongSecret);
    expect(isValid).toBe(false);
  });
});

describe("Webhook Server", () => {
  it("should accept valid webhook configuration", () => {
    const config = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "123",
          time: Date.now(),
          messaging: [
            {
              sender: { id: "user123" },
              recipient: { id: "bot123" },
              timestamp: Date.now(),
              message: {
                mid: "msg123",
                text: "Hello",
              },
            },
          ],
        },
      ],
    };

    expect(config.object).toBe("whatsapp_business_account");
    expect(config.entry).toHaveLength(1);
    expect(config.entry[0].messaging).toHaveLength(1);
    expect(config.entry[0].messaging[0].message?.text).toBe("Hello");
  });

  it("should parse Meta message structure", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "entry123",
          time: 1234567890,
          messaging: [
            {
              sender: { id: "sender123" },
              recipient: { id: "recipient123" },
              timestamp: 1234567890,
              message: {
                mid: "mid123",
                text: "Test message",
              },
            },
          ],
        },
      ],
    };

    expect(payload.entry[0].messaging[0].sender.id).toBe("sender123");
    expect(payload.entry[0].messaging[0].message?.text).toBe("Test message");
  });
});
