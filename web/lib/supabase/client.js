import { createBrowserClient } from "@supabase/ssr";

// Use this client anywhere in the browser (Client Components) that needs
// auth — e.g. the login page's magic-link sign-in. Unlike a plain
// @supabase/supabase-js client, this one stores the session in cookies
// (not just localStorage), which is what lets middleware.js and Server
// Components see whether the user is signed in.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
