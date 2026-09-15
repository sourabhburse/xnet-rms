import { type FormEvent, useState } from "react";

import { ArrowRight, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";

import { formatApiError } from "./api";
import { User } from "./types";
import { BrandMark } from "@/components/shell/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface LoginProps {
  onLoginSuccess: (user: User) => void;
  api: (path: string, method?: string, data?: unknown) => Promise<any>;
}

const platformServices = ["RMS core", "Tunnel broker", "Telemetry ingest"];

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
    <main className="grid min-h-dvh bg-background lg:grid-cols-[minmax(360px,0.85fr)_minmax(520px,1.15fr)]">
      <section className="hidden min-h-dvh flex-col bg-sidebar px-10 py-10 text-sidebar-foreground lg:flex xl:px-16">
        <div className="flex items-center gap-3"><BrandMark variant="dark" className="h-7 w-auto" /><span className="font-display text-[15px] font-semibold tracking-[0.08em] text-sidebar-primary">XNET RMS</span></div>
        <div className="flex flex-1 items-center"><div className="max-w-[420px]"><div className="mb-5 font-mono text-[11px] uppercase tracking-[0.16em] text-sidebar-muted">Remote management platform</div><h1 className="max-w-[460px] font-display text-[36px] font-semibold leading-[1.15] tracking-[-0.04em] text-sidebar-primary text-balance">Secure access to every router you operate.</h1><p className="mt-5 max-w-[390px] text-[14px] leading-6 text-sidebar-foreground text-pretty">Monitor fleet health, manage enrollment, and open authorized remote sessions from one controlled workspace.</p></div></div>
        <div className="border-t border-sidebar-border pt-5"><div className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-sidebar-muted">Platform status</div><div className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-1">{platformServices.map((service) => <div key={service} className="flex items-center gap-2 text-[12px]"><span className="size-1.5 rounded-full bg-sidebar-muted" /><span className="flex-1">{service}</span><span className="font-mono text-[10px] text-sidebar-muted">Protected</span></div>)}</div></div>
      </section>

      <section className="flex min-h-dvh items-center justify-center px-5 py-8 sm:px-8 lg:px-16 xl:px-24">
        <div className="w-full max-w-[420px]">
          <div className="mb-12 flex items-center gap-3 lg:hidden"><BrandMark variant="light" className="h-8 w-auto" /><span className="font-display text-[15px] font-semibold tracking-[0.08em] text-foreground">XNET RMS</span></div>
          <div className="mb-8"><div className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-primary">Customer operations console</div><h2 className="font-display text-[28px] font-semibold tracking-[-0.03em] text-foreground text-balance">Sign in</h2><p className="mt-2 text-[14px] text-muted-foreground text-pretty">Use your RMS account to continue to the fleet workspace.</p></div>

          {error && <div role="alert" className="mb-5 rounded-lg border border-down-border bg-down-bg px-3.5 py-3 text-[12px] leading-5 text-down">{error}</div>}

          <form onSubmit={onSubmit} className="space-y-5">
            <div><label htmlFor="login-email" className="mb-2 block text-[13px] font-medium text-foreground">Email address</label><div className="relative"><Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="login-email" type="email" placeholder="name@company.com" autoFocus autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="h-11 pl-10" /></div></div>
            <div><label htmlFor="login-password" className="mb-2 block text-[13px] font-medium text-foreground">Password</label><div className="relative"><LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="login-password" type={showPassword ? "text" : "password"} placeholder="Enter your password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 pl-10 pr-10" /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div></div>
            <label className="flex items-center gap-2 text-[13px] text-muted-foreground"><input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} className="size-4 rounded accent-primary" />Remember me</label>
            <Button type="submit" className="h-11 w-full font-semibold" disabled={loading}>{loading ? "Signing in…" : <>Sign in <ArrowRight className="size-4" /></>}</Button>
          </form>
          <div className="mt-8 flex items-start gap-2 border-t border-border pt-5 text-[12px] leading-5 text-muted-foreground"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /><span>Accounts are provisioned by your RMS administrator. Contact them if you need access.</span></div>
        </div>
      </section>
    </main>
  );
}
