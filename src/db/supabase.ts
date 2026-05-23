import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import { logger } from '../logger';

let supabase: SupabaseClient | null = null;

export function initSupabase(): SupabaseClient | null {
  if (config.database.provider !== 'supabase') {
    return null;
  }

  const url = config.database.supabaseUrl;
  const key = config.database.supabaseAnonKey;

  if (!url || !key) {
    logger.warn('Supabase URL or Anon Key is missing in configuration. Falling back to SQLite.');
    return null;
  }

  try {
    supabase = createClient(url, key, {
      auth: {
        persistSession: false,
      },
    });
    logger.info({ url }, 'Supabase client initialized successfully');
    return supabase;
  } catch (error) {
    logger.error({ error }, 'Error initializing Supabase client');
    supabase = null;
    return null;
  }
}

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error('Supabase client not initialized. Call initSupabase() first and ensure provider is supabase.');
  }
  return supabase;
}

export function isSupabaseEnabled(): boolean {
  return config.database.provider === 'supabase' && supabase !== null;
}
