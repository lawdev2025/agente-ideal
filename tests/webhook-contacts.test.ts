import { describe, it, expect } from "vitest";
import { buildProfileNameMap } from "../src/webhook/contacts";

describe("buildProfileNameMap", () => {
  it("mapeia wa_id para profile.name", () => {
    const value = {
      contacts: [{ wa_id: "5511999990001", profile: { name: "Maria Souza" } }],
      messages: [],
    };
    expect(buildProfileNameMap(value)).toEqual({ "5511999990001": "Maria Souza" });
  });

  it("ignora contato sem nome", () => {
    const value = { contacts: [{ wa_id: "5511999990001", profile: {} }] };
    expect(buildProfileNameMap(value)).toEqual({});
  });

  it("faz trim no nome", () => {
    const value = { contacts: [{ wa_id: "1", profile: { name: "  João  " } }] };
    expect(buildProfileNameMap(value)).toEqual({ "1": "João" });
  });

  it("retorna objeto vazio quando não há contacts", () => {
    expect(buildProfileNameMap({})).toEqual({});
    expect(buildProfileNameMap(undefined)).toEqual({});
  });
});
