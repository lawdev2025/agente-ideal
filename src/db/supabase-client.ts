import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config";

let _client: SupabaseClient | null = null;

/**
 * Cliente Supabase server-side (singleton por invocacao).
 * Em ambiente Vercel, cada function tem seu proprio modulo, entao o singleton
 * vive durante o tempo de vida da function (warm). Em cold start, recria.
 */
export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  const url = config.database.supabaseUrl;
  const key = config.database.supabaseAnonKey;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL ou SUPABASE_ANON_KEY ausentes — configure no .env (ou Vercel env vars)"
    );
  }
  _client = createClient(url, key, {
    auth: { persistSession: false },
  });
  return _client;
}

/**
 * Indica se as credenciais Supabase estao presentes. Em prod no Vercel,
 * sempre true. Em dev local sem .env, false (e o codigo deve cair pro fallback
 * de knowledge base JSON local).
 */
export function isSupabaseEnabled(): boolean {
  return !!(config.database.supabaseUrl && config.database.supabaseAnonKey);
}
