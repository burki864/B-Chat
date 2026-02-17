
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

let supabaseClient: SupabaseClient | null = null;

if (supabaseUrl && supabaseAnonKey && supabaseUrl !== 'undefined' && supabaseAnonKey !== 'undefined') {
  try {
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
  } catch (e) {
    console.error("Failed to initialize Supabase client:", e);
  }
}

// We export a proxy or a nullable client, but isSupabaseConfigured is the source of truth
export const supabase = supabaseClient as SupabaseClient;
export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey && supabaseClient && supabaseUrl !== 'undefined');
