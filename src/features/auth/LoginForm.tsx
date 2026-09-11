"use client";

import { useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

const PRIVACY_TEXT = "我们非常重视您的隐私保护。当您使用我们的服务时，我们会收集和使用您的相关信息。我们将按照法律法规要求，采取相应安全保护措施，尽力保护您的个人信息安全可控。";

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/board";
  if (value.startsWith("/login") || value.startsWith("/api")) return "/board";
  return value;
}

async function responseMessage(response: Response, fallback: string) {
  try {
    const body = await response.json() as { error?: unknown; message?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
    if (typeof body.message === "string" && body.message) return body.message;
  } catch {
    // Keep the stable fallback for non-JSON errors.
  }
  return fallback;
}

export function LoginForm() {
  const searchParams = useSearchParams();
  const destination = useMemo(() => safeNext(searchParams.get("next")), [searchParams]);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [showTerms, setShowTerms] = useState(false);
  const emailValid = email.trim().includes("@") && email.trim().length >= 3;

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/session", { cache: "no-store", credentials: "include" }).then((response) => {
      if (cancelled) return;
      if (response.ok) {
        window.location.replace(destination);
      } else {
        setChecking(false);
      }
    }).catch(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [destination]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [countdown]);

  const sendCode = async () => {
    if (!emailValid || sending || countdown > 0) return;
    setSending(true); setError(""); setHint("");
    try {
      const response = await fetch("/api/auth/otp", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }) });
      if (!response.ok) throw new Error(await responseMessage(response, "验证码发送失败"));
      setCountdown(60);
      setHint(`验证码已发送到 ${email.trim()}，请检查邮箱和垃圾箱`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "验证码发送失败");
    } finally {
      setSending(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!emailValid || !code.trim() || !agreed || verifying) return;
    setVerifying(true); setError("");
    try {
      const response = await fetch("/api/auth/verify", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), code: code.trim() }) });
      if (!response.ok) throw new Error(await responseMessage(response, "验证码错误或已过期"));
      window.location.replace(destination);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "登录失败");
    } finally {
      setVerifying(false);
    }
  };

  if (checking) return <div className="grid min-h-dvh place-items-center bg-[var(--ms-app-bg)] text-xs text-[var(--ms-text-secondary)]">正在检查登录状态…</div>;

  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--ms-app-bg)] px-4 py-8">
      <form onSubmit={submit} className="w-full max-w-[380px] rounded-[12px] border border-[var(--ms-separator)] bg-[var(--ms-card-bg)] p-6 shadow-[0_24px_70px_rgb(0_0_0/55%)]">
        <div className="text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-[12px] bg-[var(--ms-brand)] text-lg font-black text-black">M</div>
          <p className="text-[24px] font-extrabold tracking-[-0.03em] text-[var(--ms-brand)]">Marsoon</p>
          <h1 className="mt-2 text-xl font-bold text-[var(--ms-text-primary)]">华语订单流社区</h1>
          <p className="mt-1 text-[12px] text-[var(--ms-text-secondary)]">使用邮箱验证码登录（注意垃圾箱）</p>
        </div>

        <label className="mt-6 block text-[11px] font-semibold text-[var(--ms-text-secondary)]">邮箱</label>
        <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" className="ms-control mt-1 h-11 w-full px-3 text-sm text-[var(--ms-text-primary)] outline-none focus:border-[var(--ms-brand)]" />

        <label className="mt-3 block text-[11px] font-semibold text-[var(--ms-text-secondary)]">验证码</label>
        <div className="mt-1 flex gap-2">
          <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="输入邮箱验证码" className="ms-control h-11 min-w-0 flex-1 px-3 text-sm text-[var(--ms-text-primary)] outline-none focus:border-[var(--ms-brand)]" />
          <button type="button" onClick={() => void sendCode()} disabled={!emailValid || sending || countdown > 0} className="ms-control w-[106px] text-[12px] font-semibold text-[var(--ms-text-primary)] disabled:cursor-not-allowed disabled:opacity-40">{sending ? "发送中…" : countdown > 0 ? `${countdown}s` : "获取验证码"}</button>
        </div>

        {error ? <p role="alert" className="mt-3 text-[12px] text-[var(--ms-danger)]">{error}</p> : null}
        {hint ? <p role="status" className="mt-3 text-[12px] text-[var(--ms-success)]">{hint}</p> : null}

        <label className="mt-4 flex items-start gap-2 text-[11px] leading-5 text-[var(--ms-text-secondary)]">
          <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} className="mt-1 accent-[var(--ms-brand)]" />
          <span>我已阅读并同意 <button type="button" onClick={() => setShowTerms(true)} className="text-[var(--ms-brand)] hover:underline">《用户协议》</button> 和 <button type="button" onClick={() => setShowTerms(true)} className="text-[var(--ms-brand)] hover:underline">《隐私政策》</button></span>
        </label>

        <button type="submit" disabled={!emailValid || !code.trim() || !agreed || verifying} className="ms-primary mt-5 h-11 w-full rounded-[10px] text-sm disabled:cursor-not-allowed disabled:opacity-40">{verifying ? "登录中…" : "登录"}</button>
      </form>

      {showTerms ? <div className="fixed inset-0 z-[10000] grid place-items-center bg-black/70 px-4" onPointerDown={() => setShowTerms(false)}>
        <section role="dialog" aria-modal="true" aria-label="隐私政策" onPointerDown={(event) => event.stopPropagation()} className="w-full max-w-[420px] rounded-[12px] border border-[var(--ms-separator)] bg-[var(--ms-card-bg)] p-5 shadow-2xl">
          <h2 className="text-sm font-bold text-[var(--ms-text-primary)]">隐私政策</h2>
          <p className="mt-3 text-[12px] leading-6 text-[var(--ms-text-secondary)]">{PRIVACY_TEXT}</p>
          <button type="button" onClick={() => setShowTerms(false)} className="ms-primary mt-5 h-9 w-full rounded-[9px] text-xs">我知道了</button>
        </section>
      </div> : null}
    </main>
  );
}
