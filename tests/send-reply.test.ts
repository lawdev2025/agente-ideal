import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { WhatsAppClient } from "../src/whatsapp/client";
import { config } from "../src/config";

// "Responder" do /app: sem context.message_id a mensagem chega solta pro
// cliente, sem a citação em cima.
describe("responder mensagem (context.message_id)", () => {
  let post: ReturnType<typeof vi.fn>;
  const dryRunOriginal = config.whatsapp.dryRun;

  beforeEach(() => {
    (config.whatsapp as any).dryRun = false;
    post = vi.fn().mockResolvedValue({ data: { messages: [{ id: "wamid.out" }] } });
    vi.spyOn(axios, "create").mockReturnValue({ post } as any);
    return () => { (config.whatsapp as any).dryRun = dryRunOriginal; };
  });

  const cliente = () => new WhatsAppClient("token", "123", "456");

  it("texto citando: manda o wamid da mensagem respondida e devolve o id novo", async () => {
    const { messageId } = await cliente().sendMessage("5591988887777", "Oi!", "wamid.in");
    expect(post.mock.calls[0][1].context).toEqual({ message_id: "wamid.in" });
    expect(messageId).toBe("wamid.out");
  });

  it("texto sem citar: payload sem context", async () => {
    await cliente().sendMessage("5591988887777", "Oi!");
    expect(post.mock.calls[0][1].context).toBeUndefined();
  });

  it("mídia citando: imagem, documento, vídeo e áudio levam o context", async () => {
    const c = cliente();
    await c.sendImage("5591988887777", "https://cdn/a.jpg", "legenda", "wamid.in");
    await c.sendDocument("5591988887777", "https://cdn/a.pdf", "a.pdf", "wamid.in");
    await c.sendVideo("5591988887777", "https://cdn/a.mp4", undefined, "wamid.in");
    await c.sendAudio("5591988887777", "https://cdn/a.ogg", "wamid.in");
    for (const call of post.mock.calls) expect(call[1].context).toEqual({ message_id: "wamid.in" });
  });
});
