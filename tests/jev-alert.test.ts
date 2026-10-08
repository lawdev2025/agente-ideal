import { describe, it, expect } from "vitest";
import { avaliarAlerta, contarRepeticoes, AlertaInput } from "../src/worker/jev-alert";

const base: AlertaInput = {
  leitura: 3,
  media: 3.5,
  emocao: "neutro",
  motivo: "nenhum",
  repeticoes: 1,
  botPausado: false,
  alertaAberto: false,
};

describe("avaliarAlerta", () => {
  it("conversa tranquila → nada", () => {
    expect(avaliarAlerta(base)).toEqual({ acao: "nada" });
  });

  it("uma mensagem muito negativa abre alerta sozinha, com título pela emoção", () => {
    expect(avaliarAlerta({ ...base, leitura: 0.9, media: 2.2, emocao: "irritado", motivo: "quer_valor" })).toEqual({
      acao: "abrir",
      titulo: "Cliente irritado",
      motivo: "quer o valor da mensalidade e não recebeu",
    });
  });

  it("insatisfação sustentada (média e mensagem < 2,5) abre alerta", () => {
    const r = avaliarAlerta({ ...base, leitura: 2, media: 2.3, emocao: "confuso", motivo: "sem_resposta_util" });
    expect(r).toMatchObject({ acao: "abrir", titulo: "Cliente confuso" });
  });

  it("uma mensagem morna isolada (2,0) com histórico bom NÃO abre", () => {
    expect(avaliarAlerta({ ...base, leitura: 2, media: 2.8 })).toEqual({ acao: "nada" });
  });

  it("mesma pergunta 3× abre mesmo com tom neutro, e o motivo diz a repetição", () => {
    expect(avaliarAlerta({ ...base, repeticoes: 3 })).toEqual({
      acao: "abrir",
      titulo: "Cliente insatisfeito",
      motivo: "repetiu a pergunta 3× sem resposta útil",
    });
  });

  it("alerta já aberto e problema continua → atualizar (não reabre nem repete o push)", () => {
    expect(avaliarAlerta({ ...base, leitura: 1, media: 1.5, alertaAberto: true })).toMatchObject({ acao: "atualizar" });
  });

  it("cliente se acalmou (mensagem e média ≥ 3 / 2,5) → encerrar", () => {
    expect(avaliarAlerta({ ...base, leitura: 4.5, media: 3, alertaAberto: true })).toEqual({ acao: "encerrar" });
  });

  it("melhorou um pouco mas média ainda ruim → mantém (nada)", () => {
    expect(avaliarAlerta({ ...base, leitura: 3, media: 2, alertaAberto: true })).toEqual({ acao: "nada" });
  });

  it("bot pausado: humano já está na conversa → encerra o aberto, não abre novo", () => {
    expect(avaliarAlerta({ ...base, leitura: 0.5, media: 1, botPausado: true, alertaAberto: true })).toEqual({ acao: "encerrar" });
    expect(avaliarAlerta({ ...base, leitura: 0.5, media: 1, botPausado: true })).toEqual({ acao: "nada" });
  });

  it("sem emoção reconhecida: título pela nota", () => {
    expect(avaliarAlerta({ ...base, leitura: 1, media: 1, emocao: null })).toMatchObject({ titulo: "Cliente irritado" });
    expect(avaliarAlerta({ ...base, leitura: 2, media: 2, emocao: "neutro" })).toMatchObject({ titulo: "Cliente insatisfeito" });
  });
});

describe("contarRepeticoes", () => {
  const u = (content: string) => ({ role: "user", content });
  const b = (content: string) => ({ role: "assistant", content });

  it("conta a pergunta atual + as anteriores parecidas, mesmo reformuladas", () => {
    const hist = [
      u("qual o valor da mensalidade?"),
      b("Os valores são informados presencialmente."),
      u("mas quanto é a mensalidade? preciso do valor"),
      b("Os valores são informados presencialmente."),
    ];
    expect(contarRepeticoes(hist, "Já é a terceira vez que pergunto e ninguém responde direito o valor da mensalidade.")).toBe(3);
  });

  it("perguntas diferentes não contam", () => {
    const hist = [u("qual o endereço da unidade Batista Campos?"), u("tem aula de natação?")];
    expect(contarRepeticoes(hist, "qual o valor da mensalidade?")).toBe(1);
  });

  it("mensagem curta (ok, sim) nunca vira repetição", () => {
    expect(contarRepeticoes([u("ok"), u("ok")], "ok")).toBe(1);
  });

  it("mensagens do bot não contam", () => {
    expect(contarRepeticoes([b("valor da mensalidade"), b("valor da mensalidade")], "valor da mensalidade?")).toBe(1);
  });
});
