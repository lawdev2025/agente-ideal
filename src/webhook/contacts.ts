/**
 * Monta o mapa `wa_id -> profile.name` a partir do `value` de um change do
 * webhook (formato WhatsApp Cloud API). Nomes vazios são ignorados.
 */
export function buildProfileNameMap(value: any): Record<string, string> {
  const map: Record<string, string> = {};
  const contacts = (value && value.contacts) || [];
  for (const c of contacts) {
    const waId = c && c.wa_id;
    const name = c && c.profile && c.profile.name;
    if (waId && typeof name === "string" && name.trim()) {
      map[waId] = name.trim();
    }
  }
  return map;
}
