"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";

export function LogoutButton() {
  const [pending, setPending] = useState(false);
  const logout = async () => {
    if (pending) return;
    setPending(true);
    try { await fetch("/api/auth/logout", { method: "POST", credentials: "include" }); } finally { window.location.assign("/login"); }
  };
  return <button type="button" onClick={() => void logout()} disabled={pending} className="ms-control flex h-9 w-full items-center gap-2 px-2.5 text-[12px] font-semibold text-[var(--ms-text-secondary)] hover:border-[var(--ms-brand)] hover:text-[var(--ms-brand)] disabled:opacity-40"><LogOut size={14} strokeWidth={1.5} />{pending ? "退出中…" : "退出登录"}</button>;
}
