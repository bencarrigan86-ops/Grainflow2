// The Supabase client, shared by the whole app.
//
// Loaded from a CDN as an ES module because Grainflow has no build step and is
// better off keeping it that way — edit, refresh, done. A bundler arrives at
// Phase 3 when PowerSync forces one, and not before.
//
// On the key below: it is *supposed* to be here. A publishable key ships to
// every browser that loads the app and is committed to this repo on purpose.
// Row-level security is what protects the data — the 47 policies in
// supabase/migrations/20260831130000_rls_policies.sql — not secrecy about a
// string that has to reach the client anyway.
//
// The one that must never appear in this folder, this repo, or anything
// deployed to Cloudflare is the SECRET key (sb_secret_...). It bypasses RLS
// entirely and belongs only inside Edge Functions, which arrive at Phase 2.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SUPABASE_URL = 'https://mvrlvytoplpwglgkxqpp.supabase.co';

// Publishable — safe in the browser. See the note above.
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_v8t04o3uoNx-Dt9VMVvyow_2Q17cG6V';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    // Keep the session in localStorage so closing the app does not sign the
    // user out — a driver should not have to log in at every silo.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * Who is signed in, or null. Async by necessity — this is the one place the
 * app talks to the network before it can render anything.
 *
 * Note this is deliberately NOT how the rest of the app reads data. The db
 * interface in storage.js stays synchronous so the eight views never change;
 * see step 1.3 in the runbook.
 */
export async function currentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data?.user ?? null;
}
