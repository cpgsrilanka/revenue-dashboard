import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Use this in Server Components / route handlers that need to know who's
// signed in, or that need to query Supabase with the user's own
// permissions (so Row Level Security applies as "authenticated user", not
// as an anonymous request).
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // setAll is called from a Server Component in some cases, where
          // cookies can't be written — safe to ignore as long as
          // middleware.js is also refreshing the session on every request.
        }
      },
    },
  });
}
