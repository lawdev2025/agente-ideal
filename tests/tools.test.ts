import { describe, it, expect } from "vitest";
import {
  getKBTools,
  getToolDefinitions,
  executeKBTool,
} from "../src/kb/tools";

describe("KB Tools", () => {
  it("should return all available tools", () => {
    const tools = getKBTools();
    expect(tools).toHaveLength(5);
    expect(tools.map((t) => t.name)).toContain("get_tuition_info");
    expect(tools.map((t) => t.name)).toContain("get_schedule");
    expect(tools.map((t) => t.name)).toContain("get_study_materials");
    expect(tools.map((t) => t.name)).toContain("get_contact_info");
    expect(tools.map((t) => t.name)).toContain("escalate_to_specialist");
  });

  it("should return valid tool definitions", () => {
    const definitions = getToolDefinitions();
    expect(definitions).toHaveLength(5);

    const tuitionTool = definitions.find((t) => t.name === "get_tuition_info");
    expect(tuitionTool?.description).toBeDefined();
    expect(tuitionTool?.inputSchema).toBeDefined();
  });

  it("should execute get_tuition_info tool", async () => {
    const result = await executeKBTool("get_tuition_info", {
      student_id: "STU001",
    });
    expect(result).toContain("STU001");
    expect(result).toContain("Mensalidade");
  });

  it("should execute get_schedule tool", async () => {
    const result = await executeKBTool("get_schedule", {
      student_id: "STU001",
    });
    expect(result).toContain("STU001");
    expect(result).toContain("Cronograma");
  });

  it("should execute get_study_materials tool", async () => {
    const result = await executeKBTool("get_study_materials", {
      student_id: "STU001",
    });
    expect(result).toContain("STU001");
    expect(result).toContain("Materiais");
  });

  it("should execute get_study_materials with subject filter", async () => {
    const result = await executeKBTool("get_study_materials", {
      student_id: "STU001",
      subject: "Matemática",
    });
    expect(result).toContain("Matemática");
  });

  it("should execute get_contact_info tool", async () => {
    const result = await executeKBTool("get_contact_info", {
      type: "support",
    });
    expect(result).toContain("suporte");
  });

  it("should execute escalate_to_specialist tool", async () => {
    const result = await executeKBTool("escalate_to_specialist", {
      reason: "billing",
      student_id: "STU001",
      message: "Dúvida sobre pagamento",
    });
    expect(result).toContain("especialista");
  });

  it("should throw error for unknown tool", async () => {
    await expect(
      executeKBTool("unknown_tool", { param: "value" })
    ).rejects.toThrow("not found");
  });
});
