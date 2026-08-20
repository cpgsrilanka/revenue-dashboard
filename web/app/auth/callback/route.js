import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// The magic-link email points here (via emailRedirectTo) instead of
// straight to /dashboard. This matters for SSR: Supabase's magic link
// carries a one-time `code` query param that has to be exchanged for a
// session on the SERVER, so the resulting cookie exists before the
// dashboard's middleware check runs on the next request. Redirecting
// straight to /dashboard would only set the session in the browser's
// client-side state, which middleware can't see.
export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  const loginUrl = new URL("/login", origin);
  loginUrl.searchParams.set("error", "auth_failed");
  return NextResponse.redirect(loginUrl);
}
