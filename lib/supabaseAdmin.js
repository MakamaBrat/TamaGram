// lib/supabaseAdmin.js
//
// Этот клиент использует service_role ключ — он обходит RLS.
// Импортируется ТОЛЬКО в серверных файлах (/api/*).
// Никогда не отправляйте этот ключ в Unity/клиент.

import { createClient } from '@supabase/supabase-js';

export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);
