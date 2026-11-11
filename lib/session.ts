import { randomBytes } from "crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "zilla_session";

export function isSessionId(value: string | undefined | null): value is string {
  return Boolean(value && /^[a-f0-9]{32}$/.test(value));
}

export function createSessionId(): string {
  return randomBytes(16).toString("hex");
}

export async function ensureSession(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(SESSION_COOKIE)?.value;
  if (isSessionId(existing)) return existing;
  const id = createSessionId();
  jar.set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return id;
}
