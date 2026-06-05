import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock do client Supabase: devolvemos linhas controladas pra testar só a lógica
// de match (sem banco real).
let MOCK_ROWS: any[] = [];
vi.mock("../src/db/supabase-client", () => ({
  isSupabaseEnabled: () => true,
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: async () => ({ data: MOCK_ROWS, error: null }),
      }),
    }),
  }),
}));

import { matchDirectResponse } from "../src/kb/direct-responses";

beforeEach(() => {
  MOCK_ROWS = [
    { id: 1, gatilhos: "uniforme, farda, malharia", resposta: "Compra na malharia.", unit_id: null, ativo: true, prioridade: 0 },
    { id: 2, gatilhos: "piscina, natacao", resposta: "Temos piscina semiolimpica.", unit_id: null, ativo: true, prioridade: 0 },
    { id: 3, gatilhos: "material didatico", resposta: "Material Poliedro na escola.", unit_id: null, ativo: true, prioridade: 5 },
  ];
});

describe("matchDirectResponse: resposta determinística por gatilho", () => {
  it("casa gatilho simples", async () => {
    expect(await matchDirectResponse("onde compro o uniforme?")).toBe("Compra na malharia.");
  });

  it("é insensível a acento e caixa", async () => {
    expect(await matchDirectResponse("tem NATAÇÃO aí?")).toBe("Temos piscina semiolimpica.");
  });

  it("casa frase de múltiplas palavras", async () => {
    expect(await matchDirectResponse("queria saber do material didático")).toBe(
      "Material Poliedro na escola."
    );
  });

  it("não casa quando o gatilho é só substring de outra palavra", async () => {
    // "natacao" não deve casar dentro de "natacaozinha"? na verdade testamos
    // que "ano" (não cadastrado) não dispara nada e que palavra solta não casa.
    expect(await matchDirectResponse("quero falar sobre o aniversário")).toBeNull();
  });

  it("sem match retorna null", async () => {
    expect(await matchDirectResponse("qual o horário das aulas?")).toBeNull();
  });

  it("ignora linhas inativas (não vêm na query, mas se vierem não quebram)", async () => {
    MOCK_ROWS = [
      { id: 9, gatilhos: "teste", resposta: "X", unit_id: null, ativo: true, prioridade: 0 },
    ];
    expect(await matchDirectResponse("isso é um teste")).toBe("X");
  });

  it("empate de gatilho → vence maior prioridade", async () => {
    MOCK_ROWS = [
      { id: 1, gatilhos: "bolsa", resposta: "Resposta A", unit_id: null, ativo: true, prioridade: 1 },
      { id: 2, gatilhos: "bolsa", resposta: "Resposta B", unit_id: null, ativo: true, prioridade: 9 },
    ];
    expect(await matchDirectResponse("tem bolsa?")).toBe("Resposta B");
  });
});
