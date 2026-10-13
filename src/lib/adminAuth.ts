import crypto from "node:crypto";
import { cookies } from "next/headers";

// The admin area is protected by one shared password, set in the ADMIN_PASSWORD environment
// variable. If it isn't set the admin area is switched off. A login sets a signed, expiring
// cookie; changing the password invalidates every session.

export const ADMIN_COOKIE = "storytime_admin";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

export const adminEnabled = () => Boolean(process.env.ADMIN_PASSWORD);

const sha = (s: string) => crypto.createHash("sha256").update(s).digest();

function signingKey(): Buffer {
  return sha(`storytime-admin-session:${process.env.ADMIN_PASSWORD ?? ""}`);
}

export function passwordMatches(candidate: string): boolean {
  const real = process.env.ADMIN_PASSWORD;
  if (!real) return false;
  return crypto.timingSafeEqual(sha(candidate), sha(real));
}

export function makeSessionValue(now = Date.now()): string {
  const expires = String(now + SESSION_MS);
  const mac = crypto.createHmac("sha256", signingKey()).update(expires).digest("base64url");
  return `${expires}.${mac}`;
}

export function sessionValueValid(value: string | undefined, now = Date.now()): boolean {
  if (!value || !adminEnabled()) return false;
  const [expires, mac] = value.split(".");
  if (!expires || !mac || Number(expires) < now) return false;
  const expected = crypto.createHmac("sha256", signingKey()).update(expires).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** True if the current request carries a valid admin session cookie. */
export async function isAdmin(): Promise<boolean> {
  return sessionValueValid((await cookies()).get(ADMIN_COOKIE)?.value);
}

export const sessionMaxAgeSeconds = SESSION_MS / 1000;

// Slow down password guessing: after too many recent failures, refuse for a while.
const failures: number[] = [];
const WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILURES = 8;

export function loginLockedOut(now = Date.now()): boolean {
  while (failures.length && failures[0] < now - WINDOW_MS) failures.shift();
  return failures.length >= MAX_FAILURES;
}

export function recordLoginFailure(now = Date.now()) {
  failures.push(now);
}

export function clearLoginFailures() {
  failures.length = 0;
}
