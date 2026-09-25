/**
 * Põe no público "Seletiva · pendentes" quem tem tag de matrícula, mandou
 * mensagem no WhatsApp desde a data de corte e ainda não tem status na
 * Seletiva. Pedido do usuário (25/09/2026): a campanha de pendentes não pode
 * deixar de fora quem estava pensando em matrícula.
 * Só mexe em quem está com seletiva_status nulo — inscrito nunca é rebaixado.
 *
 * Rode:  npx tsx scripts/seletiva-matricula-pendente.ts [--desde=2026-09-01] [--dry-run]
 * Imprime só contagens, nenhum telefone.
 */
import { getSupabase, isSupabaseEnabled } from "../src/db/supabase-client";

const PAGE = 1000;
const CHUNK = 300;

async function pageAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const desdeArg = argv.find((a) => a.startsWith("--desde="))?.slice("--desde=".length) || "2026-09-01";
  const desde = Date.parse(`${desdeArg}T00:00:00-03:00`);
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase não configurado (.env sem SUPABASE_URL/ANON_KEY).");
    process.exit(1);
  }
  const sb = getSupabase();

  const candidatos = await pageAll<{ wa_id: string }>((a, b) =>
    sb.from("contacts").select("wa_id").eq("tag", "matricula").is("seletiva_status", null).order("wa_id").range(a, b)
  );
  const ativos = new Set(
    (await pageAll<{ wa_id: string }>((a, b) =>
      sb.from("messages").select("wa_id").eq("role", "user").gte("created_at", desde).order("id").range(a, b)
    )).map((m) => m.wa_id)
  );
  const alvo = candidatos.map((c) => c.wa_id).filter((w) => ativos.has(w));

  if (!dryRun) {
    const now = Date.now();
    for (let i = 0; i < alvo.length; i += CHUNK) {
      const { error } = await sb.from("contacts")
        .update({ seletiva_status: "pendente", seletiva_at: now })
        .in("wa_id", alvo.slice(i, i + CHUNK))
        .is("seletiva_status", null);
      if (error) throw error;
    }
  }

  const { count } = await sb.from("contacts").select("*", { count: "exact", head: true }).eq("seletiva_status", "pendente");
  console.log(`✅ Matrícula desde ${desdeArg} → pendente${dryRun ? " (DRY-RUN: nada gravado)" : ""}`);
  console.log(`   Marcados agora: ${alvo.length}`);
  console.log(`   Pendentes no total: ${count ?? "?"}`);
}

main().catch((e) => {
  console.error("❌ Erro:", e?.message || e);
  process.exit(1);
});
