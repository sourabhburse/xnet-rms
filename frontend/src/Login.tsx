import { type FormEvent, useState } from "react";

import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";

import { formatApiError } from "./api";
import { User } from "./types";
import { BrandMark } from "@/components/shell/BrandMark";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface LoginProps {
  onLoginSuccess: (user: User) => void;
  api: (path: string, method?: string, data?: unknown) => Promise<any>;
}

export default function Login({ onLoginSuccess, api }: LoginProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState(() => localStorage.getItem("xnet_remember_email") || "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem("xnet_remember_email") !== null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!email.trim() || !password) { setError("Enter your email address and password."); return; }
    setLoading(true);
    try {
      const result = await api("auth/login", "POST", { email, password });
      if (rememberMe) localStorage.setItem("xnet_remember_email", email); else localStorage.removeItem("xnet_remember_email");
      onLoginSuccess(result.user);
    } catch (err) { setError(formatApiError(err).message || "Authentication failed"); } finally { setLoading(false); }
  };

  return (
    <main className="min-h-screen bg-[#f8fafc] lg:grid lg:grid-cols-2">
      <section
        className="relative hidden min-h-screen overflow-hidden px-10 py-10 text-white lg:flex lg:flex-col xl:px-16"
        style={{ background: "linear-gradient(145deg, #070a12 0%, #0c1527 50%, #152238 100%)" }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-80"
          style={{
            backgroundImage: "radial-gradient(rgba(56, 189, 248, 0.11) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 top-1/4 size-[520px] rounded-full bg-[#2e5496]/20 blur-3xl" />

        <div className="relative z-10 flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-6 text-center">
            <BrandMark className="h-16 w-[165px]" />
            <span className="font-display text-3xl font-semibold tracking-[-0.03em] text-white">XNET RMS</span>
          </div>
        </div>
      </section>

      <section className="flex min-h-screen items-center justify-center bg-[#f8fafc] px-5 py-8 sm:px-8 lg:bg-white lg:px-12">
        <Card className="w-full max-w-[384px] border-border bg-white shadow-sm lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
          <CardContent className="p-7 sm:p-10 lg:p-0">
            <div className="mb-10 lg:hidden">
              <div className="flex items-center gap-3">
                <BrandMark className="h-9 w-[93px]" />
                <span className="text-lg font-semibold tracking-tight text-slate-900">XNET RMS</span>
              </div>
            </div>

            <div className="mb-8">
              <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900">Welcome back</h2>
              <p className="mt-2 text-sm text-slate-500">Sign in to manage your routers</p>
            </div>

            {error && (
              <div role="alert" className="mb-5 rounded-lg border border-down-border bg-down-bg px-3.5 py-3 text-[12px] leading-5 text-down">
                {error}
              </div>
            )}

            <form onSubmit={onSubmit} className="space-y-5">
              <div>
                <label htmlFor="login-email" className="mb-2 block text-[13px] font-medium text-slate-700">Email address</label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="name@company.com"
                    autoFocus
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="h-11 rounded-lg border-slate-300 bg-white pl-10 focus-visible:border-[#0284c7] focus-visible:ring-[#0284c7]/20"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="login-password" className="mb-2 block text-[13px] font-medium text-slate-700">Password</label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••••••"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="h-11 rounded-lg border-slate-300 bg-white pl-10 pr-10 focus-visible:border-[#0284c7] focus-visible:ring-[#0284c7]/20"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-700"
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              <label className="flex items-center gap-2 text-[13px] text-slate-500">
                <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} className="size-4 rounded accent-[#2e5496]" />
                Remember me
              </label>

              <Button type="submit" className="h-11 w-full rounded-lg bg-[#2e5496] font-semibold hover:bg-[#203864]" disabled={loading}>
                {loading ? "Signing in…" : <>Sign in <ArrowRight className="size-4" /></>}
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
