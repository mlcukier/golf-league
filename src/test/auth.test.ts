import { describe, expect, it } from "vitest";
import {
  PASSWORD_RESET_TOKEN_TTL_MS,
  generateToken,
  hashPassword,
  isPasswordResetTokenExpired,
  signSession,
  verifyPassword,
  verifySession,
} from "../core/auth.js";
import type { PasswordResetToken } from "../types.js";

describe("hashPassword / verifyPassword", () => {
  it("round-trips a correct password", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects an incorrect password", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("wrong password", stored)).toBe(false);
  });

  it("salts each hash differently, even for the same password", () => {
    expect(hashPassword("same password")).not.toBe(hashPassword("same password"));
  });

  it("rejects a malformed stored hash instead of throwing", () => {
    expect(verifyPassword("anything", "not-a-real-hash")).toBe(false);
  });
});

describe("generateToken", () => {
  it("produces distinct, non-trivial tokens", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});

describe("session cookies", () => {
  const secret = "test-secret";

  it("round-trips a signed session", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const cookie = signSession({ participantId: "p1", passwordSetAt: null }, secret, now);
    const payload = verifySession(cookie, secret, now);
    expect(payload?.participantId).toBe("p1");
  });

  it("rejects a tampered payload", () => {
    const cookie = signSession({ participantId: "p1", passwordSetAt: null }, secret);
    const [payloadB64, sig] = cookie.split(".");
    const tampered = `${payloadB64}x.${sig}`;
    expect(verifySession(tampered, secret)).toBeNull();
  });

  it("rejects a cookie signed with a different secret", () => {
    const cookie = signSession({ participantId: "p1", passwordSetAt: null }, secret);
    expect(verifySession(cookie, "a-different-secret")).toBeNull();
  });

  it("rejects a cookie older than the max age", () => {
    const issuedAt = new Date("2026-01-01T00:00:00Z");
    const cookie = signSession({ participantId: "p1", passwordSetAt: null }, secret, issuedAt);
    const thirtyOneDaysLater = new Date(issuedAt.getTime() + 31 * 24 * 60 * 60 * 1000);
    expect(verifySession(cookie, secret, thirtyOneDaysLater)).toBeNull();
  });

  it("rejects garbage input instead of throwing", () => {
    expect(verifySession("not-a-cookie", secret)).toBeNull();
    expect(verifySession("", secret)).toBeNull();
  });

  it("carries passwordSetAt through so the caller can detect a password change", () => {
    const cookie = signSession({ participantId: "p1", passwordSetAt: "2026-01-01T00:00:00Z" }, secret);
    const payload = verifySession(cookie, secret);
    expect(payload?.passwordSetAt).toBe("2026-01-01T00:00:00Z");
  });
});

describe("isPasswordResetTokenExpired", () => {
  const token: PasswordResetToken = {
    token: "abc",
    participantId: "p1",
    expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS).toISOString(),
  };

  it("is not expired right after creation", () => {
    expect(isPasswordResetTokenExpired(token)).toBe(false);
  });

  it("is expired once the expiry time has passed", () => {
    const later = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS + 1000);
    expect(isPasswordResetTokenExpired(token, later)).toBe(true);
  });
});
