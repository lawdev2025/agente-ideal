import { describe, it, expect } from "vitest";
import {
  canonicalKey,
  tokenSet,
  jaccard,
  bestMatch,
  shouldPromote,
  type LearnedEntry,
} from "../src/learning/normalize";

describe("canonicalKey", () => {
  it("baixa caixa, tira acento e pontuação", () => {
    expect(canonicalKey("Quero o VALOR do Médio!!!")).toBe(
      canonicalKey("quero o valor do medio")
    );
  });

  it("remove stopwords e ordena tokens (mesma chave pra reordenações)", () => {
    expect(canonicalKey("valor do medio")).toBe(canonicalKey("medio o valor"));
  });

  it("dedupe de tokens repetidos", () => {
    expect(canonicalKey("medio medio valor")).toBe(canonicalKey("valor medio"));
  });

  it("string vazia / só stopwords vira chave vazia", () => {
    expect(canonicalKey("o a de")).toBe("");
    expect(canonicalKey("   ")).toBe("");
  });
});

describe("tokenSet", () => {
  it("devolve tokens significativos sem stopwords", () => {
    const s = tokenSet("Quero saber o valor do medio");
    expect(s.has("valor")).toBe(true);
    expect(s.has("medio")).toBe(true);
    expect(s.has("o")).toBe(false);
    expect(s.has("do")).toBe(false);
  });
});

describe("jaccard", () => {
  it("conjuntos idênticos = 1", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
  });
  it("disjuntos = 0", () => {
    expect(jaccard(new Set(["a"]), new Set(["b"]))).toBe(0);
  });
  it("sobreposição parcial", () => {
    // {a,b,c} ∩ {b,c,d} = {b,c} (2); ∪ = {a,b,c,d} (4) → 0.5
    expect(jaccard(new Set(["a", "b", "c"]), new Set(["b", "c", "d"]))).toBe(0.5);
  });
  it("dois vazios = 0 (sem divisão por zero)", () => {
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
});

function entry(partial: Partial<LearnedEntry>): LearnedEntry {
  return {
    canonical_key: "valor medio",
    tokens: ["valor", "medio"],
    intent_kind: "enrollment_info",
    regex_hits: 0,
    positive_outcomes: 0,
    negative_outcomes: 0,
    status: "active",
    ...partial,
  };
}

describe("bestMatch", () => {
  const entries = [
    entry({ canonical_key: "valor medio", tokens: ["valor", "medio"] }),
    entry({
      canonical_key: "telefone sede",
      tokens: ["telefone", "sede"],
      intent_kind: "enrollment_contact",
    }),
  ];

  it("match exato pela chave canônica vence (score 1)", () => {
    const m = bestMatch(new Set(["valor", "medio"]), entries, 0.7);
    expect(m?.entry.intent_kind).toBe("enrollment_info");
    expect(m?.score).toBe(1);
  });

  it("overlap acima do limiar casa", () => {
    // {quero, valor, medio} vs {valor, medio} → ∩2 ∪3 = 0.666... abaixo de 0.6?
    // usamos limiar 0.6 aqui pra validar o caminho de overlap
    const m = bestMatch(new Set(["quero", "valor", "medio"]), entries, 0.6);
    expect(m?.entry.intent_kind).toBe("enrollment_info");
    expect(m?.score).toBeGreaterThanOrEqual(0.6);
    expect(m?.score).toBeLessThan(1);
  });

  it("abaixo do limiar não casa", () => {
    const m = bestMatch(new Set(["preco", "fundamental"]), entries, 0.7);
    expect(m).toBeNull();
  });

  it("ignora entradas não-ativas no caller (recebe só ativas) — lista vazia = null", () => {
    expect(bestMatch(new Set(["valor"]), [], 0.7)).toBeNull();
  });
});

describe("shouldPromote", () => {
  it("promove com 3 hits, 2 positivos, 0 negativos", () => {
    expect(
      shouldPromote(entry({ regex_hits: 3, positive_outcomes: 2, negative_outcomes: 0 }))
    ).toBe(true);
  });

  it("não promove com hits insuficientes", () => {
    expect(
      shouldPromote(entry({ regex_hits: 2, positive_outcomes: 5, negative_outcomes: 0 }))
    ).toBe(false);
  });

  it("não promove com positivos insuficientes", () => {
    expect(
      shouldPromote(entry({ regex_hits: 5, positive_outcomes: 1, negative_outcomes: 0 }))
    ).toBe(false);
  });

  it("não promove se há qualquer negativo", () => {
    expect(
      shouldPromote(entry({ regex_hits: 5, positive_outcomes: 5, negative_outcomes: 1 }))
    ).toBe(false);
  });
});
