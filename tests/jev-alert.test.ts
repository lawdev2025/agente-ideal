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

  it("insatisfação sustentada (média e mensagem < 2,5, frustrado) abre alerta", () => {
    const r = avaliarAlerta({ ...base, leitura: 2, media: 2.3, emocao: "frustrado", motivo: "sem_resposta_util" });
    expect(r).toEqual({ acao: "abrir", titulo: "Cliente frustrado", motivo: "a resposta do bot não resolveu a dúvida" });
  });

  // Caso real 15/10/2026: "oi quero saber sobre o resultado da seletiva" numa
  // conversa que antes teve "Exijo atendimento agora" → "Cliente ansioso".
  it("ansioso ou confuso com nota baixa NÃO abre (não é insatisfação)", () => {
    expect(avaliarAlerta({ ...base, leitura: 2.2, media: 2.3, emocao: "ansioso", motivo: "resultado_seletiva" })).toEqual({ acao: "nada" });
    expect(avaliarAlerta({ ...base, leitura: 1.2, media: 2, emocao: "confuso", motivo: "sem_resposta_util" })).toEqual({ acao: "nada" });
  });

  it("nota baixa com emoção neutra NÃO abre (o Jev leu o trecho tenso de antes)", () => {
    expect(avaliarAlerta({ ...base, leitura: 1.4, media: 1.8, emocao: "neutro", motivo: "nenhum" })).toEqual({ acao: "nada" });
  });

  it("repetição abaixo de 3× não aparece no motivo", () => {
    const r = avaliarAlerta({ ...base, leitura: 1, media: 1.5, emocao: "irritado", motivo: "ninguem_responde", repeticoes: 2 });
    expect(r).toMatchObject({ motivo: "reclama que ninguém responde" });
  });

  it("uma mensagem morna isolada (2,0) com histórico bom NÃO abre", () => {
    expect(avaliarAlerta({ ...base, leitura: 2, media: 2.8 })).toEqual({ acao: "nada" });
  });

  it("mesma pergunta 3× abre mesmo com tom neutro, e o motivo diz a repetição", () => {
    expect(avaliarAlerta({ ...base, repeticoes: 3 })).toEqual({
      acao: "abrir",
      titulo: "Cliente sem resposta",
      motivo: "repetiu a pergunta 3× sem resposta útil",
    });
  });

  it("alerta já aberto e problema continua → atualizar (não reabre nem repete o push)", () => {
    expect(avaliarAlerta({ ...base, leitura: 1, media: 1.5, emocao: "irritado", alertaAberto: true })).toMatchObject({ acao: "atualizar" });
  });

  it("cliente voltou a um tom neutro → encerrar, mesmo com média ainda baixa", () => {
    expect(avaliarAlerta({ ...base, leitura: 4.5, media: 3, alertaAberto: true })).toEqual({ acao: "encerrar" });
    expect(avaliarAlerta({ ...base, leitura: 3, media: 2, alertaAberto: true })).toEqual({ acao: "encerrar" });
  });

  it("ainda frustrado, mesmo com nota média → mantém (nada)", () => {
    expect(avaliarAlerta({ ...base, leitura: 2.8, media: 2.6, emocao: "frustrado", alertaAberto: true })).toEqual({ acao: "nada" });
  });

  it("bot pausado: humano já está na conversa → encerra o aberto, não abre novo", () => {
    expect(avaliarAlerta({ ...base, leitura: 0.5, media: 1, botPausado: true, alertaAberto: true })).toEqual({ acao: "encerrar" });
    expect(avaliarAlerta({ ...base, leitura: 0.5, media: 1, botPausado: true })).toEqual({ acao: "nada" });
  });

  it("sem emoção de insatisfação, só a repetição abre", () => {
    expect(avaliarAlerta({ ...base, leitura: 1, media: 1, emocao: null })).toEqual({ acao: "nada" });
    expect(avaliarAlerta({ ...base, leitura: 2, media: 2, emocao: "confuso", repeticoes: 3 })).toMatchObject({ titulo: "Cliente sem resposta" });
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

  // Casos reais de 15/10/2026 que abriam alerta falso.
  it("nome da unidade repetido (o bot perguntou 2×) não é repetição", () => {
    expect(contarRepeticoes([u("Batista Campos"), b("Qual unidade?")], "Batista Campos")).toBe(1);
  });

  it("mesmo assunto com frases diferentes (data, inscrição) não é repetição", () => {
    const hist = [u("Boa tarde ja encerrou as inscrições do dia 20/10?"), b("Não, ainda estão abertas.")];
    expect(contarRepeticoes(hist, "Minha filha já fez a inscrição para o dia 20/10")).toBe(1);
  });

  it("a mesma pergunta mandada de novo conta", () => {
    const q = "Outro ponto importante: quais são as disciplinas e assuntos da prova?";
    expect(contarRepeticoes([u(q), b("As inscrições foram encerradas."), u(q), b("As inscrições foram encerradas.")], q)).toBe(3);
  });

  it("mensagens do bot não contam", () => {
    expect(contarRepeticoes([b("valor da mensalidade"), b("valor da mensalidade")], "valor da mensalidade?")).toBe(1);
  });
});
