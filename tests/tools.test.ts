import { describe, it, expect } from "vitest";
import { getKBTools, getToolDefinitions, executeKBTool } from "../src/kb/tools";

describe("KB Tools", () => {
  it("expõe as 4 ferramentas atuais, com escalate por último", () => {
    const tools = getKBTools();
    expect(tools).toHaveLength(4);
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      "get_enrollment_info",
      "get_unit_info",
      "get_enrollment_contact",
      "escalate_to_specialist",
    ]);
  });

  it("definições têm name/description/inputSchema", () => {
    const defs = getToolDefinitions();
    expect(defs).toHaveLength(4);
    for (const def of defs) {
      expect(def).toHaveProperty("name");
      expect(def).toHaveProperty("description");
      expect(def).toHaveProperty("inputSchema");
    }
  });

  it("get_enrollment_info confirma o nível e NUNCA expõe valor em R$", async () => {
    const result = await executeKBTool("get_enrollment_info", { nivel: "Fundamental 1" });
    expect(result).toMatch(/Fundamental/i);
    expect(result).toMatch(/secretaria/i);
    expect(result).not.toMatch(/R\$/);
  });

  it("escalate_to_specialist devolve confirmação de encaminhamento", async () => {
    const result = await executeKBTool("escalate_to_specialist", {
      reason: "other",
      student_id: "u1",
    });
    expect(result).toMatch(/escalad|especialista|contato/i);
  });

  it("ferramenta inexistente lança erro", async () => {
    await expect(executeKBTool("get_tuition_info", {})).rejects.toThrow(/not found/i);
  });
});
