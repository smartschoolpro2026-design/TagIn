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

// Some Android WebViews expose an unreliable Web Locks implementation.
// Supabase Auth uses a lock around storage/session updates; serialize those
// operations in this tab so setSession cannot wait forever on navigator.locks.
const authQueues = new Map<string, Promise<void>>();
async function browserAuthLock<T>(name: string, _acquireTimeout: number, fn: () => Promise<T>): Promise<T> {
  const previous = authQueues.get(name) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => gate);
  authQueues.set(name, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (authQueues.get(name) === tail) authQueues.delete(name);
  }
}

// The browser client uses only the public publishable key.
// Never expose a service-role or secret key in frontend code.
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, { auth: { lock: browserAuthLock } })
  : null;
