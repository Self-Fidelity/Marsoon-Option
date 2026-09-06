import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginForm } from "@/features/auth/LoginForm";

export const metadata: Metadata = { title: "登录" };

export default function LoginPage() {
  return <Suspense fallback={<div className="min-h-dvh bg-[var(--ms-app-bg)]" />}><LoginForm /></Suspense>;
}
