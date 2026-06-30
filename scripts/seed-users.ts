// scripts/seed-users.ts
// Cria/atualiza os 4 usuários iniciais. Idempotente: usa upsert por `login`.
// Rode: npx tsx scripts/seed-users.ts
import "dotenv/config";
import { getSupabase } from "../src/db/supabase-client";
import { hashPassword } from "../src/auth/password";

type Seed = { name: string; login: string; email: string | null; role: "admin" | "unit"; unit: string | null; password: string; must: boolean };

const SEEDS: Seed[] = [
  { name: "Admin", login: "admin", email: null, role: "admin", unit: null, password: "Ideal@2090", must: false },
  { name: "Elizangela", login: "elizangela.cruz@grupoideal.com.br", email: "elizangela.cruz@grupoideal.com.br", role: "unit", unit: "AM", password: "senha123", must: true },
  { name: "Ivane", login: "ivane.furtado@grupoideal.com.br", email: "ivane.furtado@grupoideal.com.br", role: "unit", unit: "BC", password: "senha123", must: true },
  { name: "Adriane", login: "adriane.fernandes@grupoideal.com.br", email: "adriane.fernandes@grupoideal.com.br", role: "unit", unit: "CN", password: "senha123", must: true },
];

async function main() {
  const sb = getSupabase();
  for (const s of SEEDS) {
    const now = Date.now();
    const { data: existing } = await sb.from("app_users").select("id").eq("login", s.login).maybeSingle();
    if (existing) {
      console.log(`= já existe: ${s.login} (não sobrescreve senha)`);
      continue;
    }
    const { error } = await sb.from("app_users").insert({
      name: s.name, login: s.login.toLowerCase(), email: s.email,
      password_hash: hashPassword(s.password), role: s.role, unit: s.unit,
      must_change_password: s.must, active: true, created_at: now, updated_at: now,
    });
    if (error) { console.error(`x falha ${s.login}:`, error.message); process.exit(1); }
    console.log(`+ criado: ${s.login} (${s.role}${s.unit ? "/" + s.unit : ""})`);
  }
  console.log("Seed concluído.");
}
main();
