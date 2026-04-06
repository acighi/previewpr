import { describe, it, expect } from "vitest";
import { createJobToken, verifyJobToken } from "../security.js";

describe("job token auth", () => {
  const secret = "test-webhook-secret";

  it("creates and verifies a valid token", () => {
    const token = createJobToken("job-123", secret);
    expect(verifyJobToken("job-123", token, secret)).toBe(true);
  });

  it("rejects invalid token", () => {
    expect(verifyJobToken("job-123", "invalid-token", secret)).toBe(false);
  });

  it("rejects token for different job ID", () => {
    const token = createJobToken("job-123", secret);
    expect(verifyJobToken("job-456", token, secret)).toBe(false);
  });

  it("rejects empty token", () => {
    expect(verifyJobToken("job-123", "", secret)).toBe(false);
  });
});
