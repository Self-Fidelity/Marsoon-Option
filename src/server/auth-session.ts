export const AUTH_SESSION_COOKIE = "marsoon_session";
export const AUTH_ACCESS_COOKIE = "marsoon_access";
export const AUTH_REFRESH_COOKIE = "marsoon_refresh";

export interface AuthUser { id: string; email: string }
export interface AuthSession { sub: string; email: string; exp: number }

const encoder = new TextEncoder();

function secret() {
  const configured = process.env.AUTH_SESSION_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV !== "production") return "marsoon-options-local-development-session-secret";
  throw new Error("AUTH_SESSION_SECRET is required in production");
}

function encodeBase64URL(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64URL(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signature(payload: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return encodeBase64URL(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
}

function equalConstantTime(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function signAuthSession(session: AuthSession) {
  const payload = encodeBase64URL(encoder.encode(JSON.stringify(session)));
  return `${payload}.${await signature(payload)}`;
}

export async function verifyAuthSession(value: string | undefined, nowUnix = Math.floor(Date.now() / 1000)): Promise<AuthSession | null> {
  if (!value) return null;
  const [payload, received, extra] = value.split(".");
  if (!payload || !received || extra || !equalConstantTime(received, await signature(payload))) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(decodeBase64URL(payload))) as Partial<AuthSession>;
    return typeof parsed.sub === "string" && parsed.sub.length > 0 && typeof parsed.email === "string" && typeof parsed.exp === "number" && parsed.exp > nowUnix
      ? parsed as AuthSession
      : null;
  } catch {
    return null;
  }
}

export function accessTokenExpiration(token: string): number | undefined {
  try {
    const payload = token.split(".")[1];
    if (!payload) return undefined;
    const parsed = JSON.parse(new TextDecoder().decode(decodeBase64URL(payload))) as { exp?: unknown };
    return typeof parsed.exp === "number" && parsed.exp > 0 ? parsed.exp : undefined;
  } catch {
    return undefined;
  }
}
