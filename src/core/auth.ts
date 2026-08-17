import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { PasswordResetToken } from "../types.js";

const SCRYPT_KEYLEN = 64;

/** Session cookies are honored for up to 30 days after issue. */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Password set/reset links expire 1 hour after being emailed. */
export const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(str: string): Buffer {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s + pad, "base64");
}

/**
 * Stores as `scrypt$<saltHex>$<hashHex>`. Deliberately synchronous — scrypt
 * blocking the event loop for ~100ms per call is a non-issue at this app's
 * scale (a handful of participants), and it keeps this module free of
 * async/await for trivial-to-test pure logic.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, saltHex, hashHex] = parts;
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A random, unguessable password-reset token (hex-encoded). */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function isPasswordResetTokenExpired(
  token: PasswordResetToken,
  now: Date = new Date()
): boolean {
  return new Date(token.expiresAt).getTime() <= now.getTime();
}

export interface SessionPayload {
  participantId: string;
  /** The participant's passwordSetAt at signing time — see verifySession. */
  passwordSetAt: string | null;
  issuedAtMs: number;
}

function sign(payloadB64: string, secret: string): string {
  return base64UrlEncode(createHmac("sha256", secret).update(payloadB64).digest());
}

/**
 * Stateless, signed session cookie — no server-side session store. Embeds
 * the participant's `passwordSetAt` at issue time; `verifySession` alone
 * can't detect a password change (it has no store access), so the caller
 * must compare the returned payload's `passwordSetAt` against the
 * participant's *current* value and reject on mismatch. That's what makes
 * changing your password invalidate every other active session.
 */
export function signSession(
  payload: { participantId: string; passwordSetAt: string | null },
  secret: string,
  now: Date = new Date()
): string {
  const full: SessionPayload = { ...payload, issuedAtMs: now.getTime() };
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(full), "utf8"));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/** Verifies signature + expiry and returns the embedded payload. Does not know about live participant state. */
export function verifySession(
  cookie: string,
  secret: string,
  now: Date = new Date(),
  maxAgeMs: number = SESSION_MAX_AGE_MS
): SessionPayload | null {
  const parts = cookie.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signatureB64] = parts;
  if (!payloadB64 || !signatureB64) return null;

  const expected = base64UrlDecode(sign(payloadB64, secret));
  const actual = base64UrlDecode(signatureB64);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.participantId !== "string" || typeof payload.issuedAtMs !== "number") {
    return null;
  }
  if (now.getTime() - payload.issuedAtMs > maxAgeMs) return null;

  return payload;
}
