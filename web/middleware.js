import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

// Runs on every matched request (see `matcher` below). Two jobs:
//   1. Refresh the Supabase session cookie so it doesn't silently expire
//      mid-visit (required — Supabase's SSR docs are explicit that this
//      has to happen in middleware, not just on login).
//   2. Redirect unauthenticated visitors away from /dashboard to /login,
//      and signed-in visitors away from /login to /dashboard.
export async function middleware(request) {
  let response = NextResponse.next({ request });

  // If Supabase isn't configured yet (e.g. running purely on mock data
  // locally with no env vars set), don't block anything — let the app's
  // own mock-data fallback handle it.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  // IMPORTANT: this call is what actually refreshes the session — don't
  // remove it even though the return value isn't used directly below.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && pathname.startsWith("/dashboard")) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  if (user && pathname === "/login") {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/dashboard";
    return NextResponse.redirect(dashboardUrl);
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/login"],
};
