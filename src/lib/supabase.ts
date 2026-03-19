import { createClient } from "@supabase/supabase-js";
import { config } from "../config/index.js";

// Service-role client — bypasses RLS, use only in backend logic
export const supabase = createClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey,
  { auth: { persistSession: false } }
);
