import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  validateOAuthCode,
  getStoredToken,
  storeToken,
  clearToken,
  githubApiFetch,
} from "../lib/github";
import { TokenExpiredError } from "../types";

describe("validateOAuthCode", () => {
  it("rejects empty string", () => {
    expect(validateOAuthCode("")).toBe(false);
  });

  it("rejects code longer than 40 chars", () => {
    const longCode = "a".repeat(41);
    expect(validateOAuthCode(longCode)).toBe(false);
  });

  it("rejects non-hex characters", () => {
    expect(validateOAuthCode("ghijklmnop")).toBe(false);
  });

  it("rejects uppercase hex", () => {
    expect(validateOAuthCode("ABCDEF1234")).toBe(false);
  });

  it("accepts valid hex code", () => {
    expect(validateOAuthCode("abc123def456")).toBe(true);
  });

  it("accepts 40-char hex code", () => {
    const code = "a1b2c3d4e5".repeat(4);
    expect(validateOAuthCode(code)).toBe(true);
  });
});

describe("token storage", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("returns null when no token stored", () => {
    expect(getStoredToken()).toBeNull();
  });

  it("stores and retrieves token", () => {
    storeToken("test-token-123");
    expect(getStoredToken()).toBe("test-token-123");
  });

  it("clears token", () => {
    storeToken("test-token-123");
    clearToken();
    expect(getStoredToken()).toBeNull();
  });
});

describe("githubApiFetch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws TokenExpiredError on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 401 }),
    );
    await expect(
      githubApiFetch("https://api.github.com/user", "bad-token"),
    ).rejects.toThrow(TokenExpiredError);
  });

  it("returns response on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ login: "test" }), { status: 200 }),
    );
    const resp = await githubApiFetch(
      "https://api.github.com/user",
      "good-token",
    );
    expect(resp.status).toBe(200);
  });
});
