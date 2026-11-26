import { createClient } from '@supabase/supabase-js';

// These are public browser configuration values, not server secrets.
// Vite environment variables override the committed fallback when provided.
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://wlkqsivehfwogdquodxx.supabase.co';
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'sb_publishable_yVimCHXGHJdSinXgiVbHjw_ZmsXpQ6T';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// The browser client uses only the public publishable key.
// Never expose a service-role or secret key in frontend code.
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
