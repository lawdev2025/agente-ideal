/**
 * Reclassifica contacts.tag relendo o histórico com as regras de HOJE.
 *
 * POR QUE EXISTE: a tag é gravada pelo webhook no instante da mensagem
 * (api/webhook.ts → applyContactSignals). Quando o classificador melhora, quem
 * já conversou continua com a tag antiga para sempre — o donut de Interesse
 * mostra a regra de ontem. Foi assim que "planos esportivos" ficou marcado como
 * matrícula depois de `esportivo` entrar no regex.
 *
 * Rode:  npx tsx scripts/retag-contacts.ts [--dry-run]
 *
 * Espelha o webhook: varre as mensagens do cliente em ordem e a ÚLTIMA com
 * sinal claro vence. Mensagem sem sinal não apaga a tag existente.
 *
 * Imprime só o resumo — nenhuma mensagem, nenhum telefone.
 */
import { getSupabase } from "../src/db/supabase-client";
import { classifyContactTag } from "../src/kb/contact-tags";

const PAGE = 1000;
const CHUNK = 300;
const fmt = (n: number) => n.toLocaleString("pt-BR");

async function pageAll<T>(build: (de: number, ate: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += PAGE) {
    const { data, error } = await build(de, de + PAGE - 1);
    if (error) throw error;
    out.push(...((data || []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const sb = getSupabase();

  const msgs = await pageAll<{ wa_id: string; content: string }>((de, ate) =>
    sb.from("messages").select("wa_id, content").eq("role", "user").order("id").range(de, ate)
  );
  const contatos = await pageAll<{ wa_id: string; tag: string | null }>((de, ate) =>
    sb.from("contacts").select("wa_id, tag").order("wa_id").range(de, ate)
  );

  // Última mensagem com sinal vence, igual ao webhook.
  const nova = new Map<string, string>();
  for (const m of msgs) {
    const tag = classifyContactTag(m.content || "");
    if (tag) nova.set(m.wa_id, tag);
  }

  const mudancas = new Map<string, string[]>(); // tagNova → wa_ids
  const de_para: Record<string, number> = {};
  for (const c of contatos) {
    const alvo = nova.get(c.wa_id);
    if (!alvo || alvo === c.tag) continue;
    if (!mudancas.has(alvo)) mudancas.set(alvo, []);
    mudancas.get(alvo)!.push(c.wa_id);
    const chave = `${c.tag ?? "(sem tag)"} → ${alvo}`;
    de_para[chave] = (de_para[chave] || 0) + 1;
  }

  let gravados = 0;
  if (!dryRun) {
    for (const [tag, waIds] of mudancas) {
      for (let i = 0; i < waIds.length; i += CHUNK) {
        const { error } = await sb.from("contacts").update({ tag }).in("wa_id", waIds.slice(i, i + CHUNK));
        if (error) throw error;
        gravados += waIds.slice(i, i + CHUNK).length;
      }
    }
  }

  const total = [...mudancas.values()].reduce((s, v) => s + v.length, 0);
  console.log(`\n✅ Reclassificação${dryRun ? " (DRY-RUN: nada gravado)" : ""}`);
  console.log(`   Mensagens de cliente lidas: ${fmt(msgs.length)}`);
  console.log(`   Contatos: ${fmt(contatos.length)} · mudam de tag: ${fmt(total)}${dryRun ? "" : ` · gravados: ${fmt(gravados)}`}`);
  if (!total) { console.log("   Nada a mudar — as tags já refletem as regras de hoje."); return; }
  console.log("   Mudanças:");
  Object.entries(de_para).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`     ${k}: ${fmt(v)}`));

  const depois: Record<string, number> = {};
  for (const c of contatos) {
    const t = nova.get(c.wa_id) ?? c.tag ?? "(sem tag)";
    depois[t] = (depois[t] || 0) + 1;
  }
  console.log("   Donut depois:");
  Object.entries(depois).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`     ${k}: ${fmt(v)}`));
}

main().catch((e) => {
  console.error("❌ Erro:", e?.message || e);
  process.exit(1);
});
