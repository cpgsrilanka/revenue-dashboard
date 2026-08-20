"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (searchParams.get("error") === "auth_failed") {
      setStatus("error");
      setErrorMessage("That sign-in link didn't work — it may have expired. Request a new one below.");
    }
  }, [searchParams]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim()) {
      setStatus("error");
      setErrorMessage("Enter your email address");
      return;
    }

    if (!isSupabaseConfigured) {
      setStatus("error");
      setErrorMessage("Supabase isn't configured yet — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      return;
    }

    setStatus("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` }
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    setStatus("sent");
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <p className="font-display text-2xl mb-1">Revenue dashboard</p>
        <p className="text-sm text-slate mb-8">Sign in with your work email to continue.</p>

        {status === "sent" ? (
          <p className="text-sm text-ink">
            Check your inbox — we sent a sign-in link to <span className="font-medium">{email}</span>.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@crystalpropertygroup.com"
              className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-white"
            />
            {status === "error" && <p className="text-xs text-brick">{errorMessage}</p>}
            <button
              type="submit"
              disabled={status === "sending"}
              className="w-full bg-ink text-paper rounded-lg px-3 py-2 text-sm font-medium"
            >
              {status === "sending" ? "Sending link…" : "Send sign-in link"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
