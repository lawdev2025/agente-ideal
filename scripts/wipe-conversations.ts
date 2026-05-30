/**
 * Limpa TODAS as conversas anteriores: apaga as tabelas `messages` e
 * `contacts` no Supabase. NÃO toca na base de conhecimento (school_*).
 *
 * Usa as credenciais do .env (mesmo cliente do bot). Idempotente.
 *
 * Rode com:  npx tsx scripts/wipe-conversations.ts
 */
import { getSupabase, isSupabaseEnabled } from "../src/db/supabase-client";

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase não configurado (.env sem SUPABASE_URL/ANON_KEY).");
    process.exit(1);
  }
  const sb = getSupabase();

  // Conta antes
  const before = await Promise.all([
    sb.from("messages").select("*", { count: "exact", head: true }),
    sb.from("contacts").select("*", { count: "exact", head: true }),
  ]);
  console.log(`Antes → messages: ${before[0].count ?? "?"} · contacts: ${before[1].count ?? "?"}`);

  // Apaga tudo. O filtro .neq("wa_id","") casa todas as linhas (wa_id é NOT NULL
  // e nunca vazio), contornando a proteção do supabase-js contra delete sem filtro.
  const delMsgs = await sb.from("messages").delete().not("id", "is", null);
  if (delMsgs.error) throw delMsgs.error;
  const delContacts = await sb.from("contacts").delete().neq("wa_id", "");
  if (delContacts.error) throw delContacts.error;

  // Conta depois
  const after = await Promise.all([
    sb.from("messages").select("*", { count: "exact", head: true }),
    sb.from("contacts").select("*", { count: "exact", head: true }),
  ]);
  console.log(`Depois → messages: ${after[0].count ?? "?"} · contacts: ${after[1].count ?? "?"}`);
  console.log("✅ Conversas anteriores limpas (base de conhecimento intacta).");
}

main().catch((e) => {
  console.error("Falhou:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
