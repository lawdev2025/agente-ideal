import { describe, it, expect } from "vitest";
import {
  phoneKey,
  extractPhoneKeys,
  pickPhoneColumns,
  isSeletivaInterestMessage,
  decideSeletivaUpdates,
  leadWaId,
} from "../src/kb/seletiva-match";

// A chave é DDD + últimos 8 dígitos: é o que sobra igual entre o wa_id da Meta
// (55 + DDD + 8, sem o 9) e o que a família digita no formulário.
describe("phoneKey: formatos do mesmo número viram a mesma chave", () => {
  const mesmoNumero = [
    "559188887777", // wa_id legado, 12 dígitos
    "5591988887777", // wa_id com o 9
    "(91) 98888-7777",
    "91 98888-7777",
    "+55 91 98888-7777",
    "91988887777",
    "091988887777", // zero de interurbano
    "98888-7777", // sem DDD → assume 91 (Belém/Ananindeua)
    "988887777",
    91988887777, // célula numérica do Excel
  ];
  for (const n of mesmoNumero) {
    it(`${JSON.stringify(n)} → 9188887777`, () => expect(phoneKey(n)).toBe("9188887777"));
  }

  it("DDD diferente gera chave diferente", () => {
    expect(phoneKey("(11) 98888-7777")).toBe("1188887777");
  });

  it("DDD 55 (RS) com 11 dígitos não perde o DDD", () => {
    expect(phoneKey("55999998888")).toBe("5599998888");
  });

  it("lixo, vazio e notação científica do Excel → null", () => {
    expect(phoneKey("")).toBeNull();
    expect(phoneKey(null)).toBeNull();
    expect(phoneKey("abc")).toBeNull();
    expect(phoneKey("1234")).toBeNull();
    expect(phoneKey("9.19889E+10")).toBeNull();
  });
});

describe("extractPhoneKeys: célula com mais de um telefone", () => {
  it("separa por barra, 'ou', ponto e vírgula", () => {
    expect(extractPhoneKeys("(91) 98888-7777 / (91) 99999-1111")).toEqual(["9188887777", "9199991111"]);
    expect(extractPhoneKeys("91988887777 ou 91999991111")).toEqual(["9188887777", "9199991111"]);
    expect(extractPhoneKeys("91988887777; 91999991111")).toEqual(["9188887777", "9199991111"]);
  });
  it("célula vazia → []", () => expect(extractPhoneKeys("")).toEqual([]));
});

describe("pickPhoneColumns: acha a coluna de telefone mesmo com cadastro diferente", () => {
  it("pelo cabeçalho (vários nomes, com e sem acento)", () => {
    const rows = [
      ["Nome", "CPF", "Telefone do Responsável", "E-mail", "Celular/WhatsApp"],
      ["Ana", "123.456.789-09", "(91) 98888-7777", "a@a.com", "91999991111"],
    ];
    expect(pickPhoneColumns(rows).columns).toEqual([2, 4]);
    expect(pickPhoneColumns(rows).headerRow).toBe(0);
  });

  it("cabeçalho não está na primeira linha", () => {
    const rows = [
      ["Relatório de inscrições — Seletiva 2027"],
      [],
      ["Candidato", "Fone"],
      ["Ana", "(91) 98888-7777"],
    ];
    const r = pickPhoneColumns(rows);
    expect(r.headerRow).toBe(2);
    expect(r.columns).toEqual([1]);
  });

  it("sem cabeçalho reconhecível → escolhe pelo conteúdo, ignorando CPF", () => {
    const rows = [
      ["Nome", "CPF", "Contato 1"],
      ["Ana", "123.456.789-09", "(91) 98888-7777"],
      ["Bia", "987.654.321-00", "91 99999-1111"],
      ["Caio", "111.222.333-44", "91977776666"],
    ];
    // "Contato" é cabeçalho de telefone; força o caminho de conteúdo com nomes neutros:
    const neutro = [["Nome", "CPF", "Campo X"], ...rows.slice(1)];
    expect(pickPhoneColumns(neutro).columns).toEqual([2]);
  });

  it("override por nome de coluna (--coluna)", () => {
    const rows = [["Nome", "Tel. fixo", "Numero do zap"], ["Ana", "3222-1111", "91988887777"]];
    expect(pickPhoneColumns(rows, "zap").columns).toEqual([2]);
  });
});

describe("isSeletivaInterestMessage", () => {
  it("cliente falando de seletiva/prova de bolsa conta", () => {
    expect(isSeletivaInterestMessage("user", "quero fazer a seletiva")).toBe(true);
    expect(isSeletivaInterestMessage("user", "como funciona a prova de bolsa?")).toBe(true);
  });
  it("cliente falando de outra coisa não conta", () => {
    expect(isSeletivaInterestMessage("user", "qual o valor do sexto ano?")).toBe(false);
  });
  it("bot mandando o link de inscrição conta", () => {
    expect(isSeletivaInterestMessage("assistant", "Inscreva-se: https://grupoideal.com.br/seletivas2027/")).toBe(true);
  });
  it("bot só citando a Seletiva no fim da matrícula NÃO conta (é oferta, não interesse)", () => {
    expect(isSeletivaInterestMessage("assistant", "Aproveite a Seletiva: até 50% de desconto!")).toBe(false);
  });
});

describe("decideSeletivaUpdates", () => {
  const contacts = [
    { wa_id: "559188887777", seletiva_status: null }, // na planilha → inscrito
    { wa_id: "559199991111", seletiva_status: "pendente" }, // pendente que se inscreveu → inscrito
    { wa_id: "559177776666", seletiva_status: "inscrito" }, // já inscrito → nada
    { wa_id: "559166665555", seletiva_status: null }, // interessado fora da planilha → pendente
    { wa_id: "559155554444", seletiva_status: "pendente" }, // já pendente → nada
    { wa_id: "559144443333", seletiva_status: "inscrito" }, // inscrito sumiu da planilha → NÃO rebaixa
    { wa_id: "559133332222", seletiva_status: null }, // sem interesse, fora da planilha → nada
  ];
  const planilha = new Set(["9188887777", "9199991111", "9177776666", "9100000000"]);
  const interessados = new Set(["559166665555", "559155554444", "559144443333", "559188887777"]);

  const r = decideSeletivaUpdates(contacts, planilha, interessados);

  it("promove a inscrito quem está na planilha e ainda não é", () => {
    expect(r.toInscrito.sort()).toEqual(["559188887777", "559199991111"]);
  });
  it("marca pendente só interessado sem status e fora da planilha", () => {
    expect(r.toPendente).toEqual(["559166665555"]);
  });
  it("conta inscritos da planilha que nunca falaram no WhatsApp", () => {
    expect(r.planilhaSemWhatsApp).toBe(1); // 9100000000
    expect(r.inscritosNoCrm).toBe(3); // 3 contatos batem com a planilha
  });
  // Quem está na planilha e não tem contato nenhum no CRM: é a lista que o
  // --criar-leads transforma em contato pra a campanha alcançar.
  it("entrega as chaves da planilha sem contato, não só a contagem", () => {
    expect(r.semContato).toEqual(["9100000000"]);
  });
});

describe("leadWaId", () => {
  // O wa_id precisa sair no MESMO formato que a Meta manda no webhook
  // (55 + DDD + 8 dígitos, sem o 9). Sair diferente cria uma segunda linha
  // pra mesma pessoa no dia em que ela responder.
  it("monta o wa_id de 12 dígitos a partir da chave", () => {
    expect(leadWaId("9188887777")).toBe("559188887777");
  });
  it("recusa chave que não tem 10 dígitos", () => {
    expect(leadWaId("918888777")).toBeNull();
    expect(leadWaId("")).toBeNull();
  });
  it("casa de volta com phoneKey — o contato criado bate com a planilha", () => {
    const wa = leadWaId("9188887777")!;
    expect(phoneKey(wa)).toBe("9188887777");
  });
});
