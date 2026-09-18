import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { WhatsAppClient } from "../src/whatsapp/client";

// Modelo com cabeçalho de imagem: a foto aprovada pela Meta é só exemplo, cada
// envio precisa repetir a URL. Errar isso faz a Meta recusar a mensagem — e
// como template é a única mensagem PAGA, a falha só aparece no disparo.
describe("sendTemplate", () => {
  let post: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    post = vi.fn().mockResolvedValue({ data: { messages: [{ id: "wamid.1" }] } });
    vi.spyOn(axios, "create").mockReturnValue({ post } as any);
  });

  const cliente = () => new WhatsAppClient("token", "123", "456");

  it("não manda components quando o modelo é só texto", async () => {
    await cliente().sendTemplate("5591988887777", "convite", "pt_BR");
    expect(post.mock.calls[0][1].template.components).toBeUndefined();
  });

  it("manda o header de imagem com a URL pública", async () => {
    await cliente().sendTemplate("5591988887777", "convite", "pt_BR", [], "https://cdn/foto.jpg");
    const { components } = post.mock.calls[0][1].template;
    expect(components).toEqual([
      { type: "header", parameters: [{ type: "image", image: { link: "https://cdn/foto.jpg" } }] },
    ]);
  });

  it("põe o header antes do body quando o modelo tem imagem e variáveis", async () => {
    await cliente().sendTemplate("5591988887777", "convite", "pt_BR", ["João"], "https://cdn/foto.jpg");
    const { components } = post.mock.calls[0][1].template;
    expect(components.map((c: any) => c.type)).toEqual(["header", "body"]);
    expect(components[1].parameters).toEqual([{ type: "text", text: "João" }]);
  });

  it("ignora imagem vazia — modelo de texto não pode ganhar header à toa", async () => {
    await cliente().sendTemplate("5591988887777", "convite", "pt_BR", ["João"], null);
    const { components } = post.mock.calls[0][1].template;
    expect(components.map((c: any) => c.type)).toEqual(["body"]);
  });
});
