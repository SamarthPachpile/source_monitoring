import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/env';
import { logger } from '../utils/logger';

let supabaseInstance: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(
    config.SUPABASE_URL &&
    (config.SUPABASE_SERVICE_ROLE_KEY || config.SUPABASE_KEY || config.SUPABASE_ANON_KEY)
  );
}

export function getSupabaseClient(): SupabaseClient {
  if (supabaseInstance) {
    return supabaseInstance;
  }

  const url = config.SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    config.SUPABASE_SERVICE_ROLE_KEY ||
    config.SUPABASE_KEY ||
    config.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'Supabase is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) in .env'
    );
  }

  supabaseInstance = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  logger.info({ url }, 'Supabase client initialized successfully');
  return supabaseInstance;
}
