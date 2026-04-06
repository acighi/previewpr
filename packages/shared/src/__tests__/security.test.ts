import { describe, it, expect } from "vitest";
import {
  validateBranchName,
  scrubSecrets,
  validateRoutes,
} from "../security.js";

describe("validateBranchName", () => {
  it("accepts valid branch names", () => {
    expect(() => validateBranchName("main")).not.toThrow();
    expect(() => validateBranchName("feature/my-branch")).not.toThrow();
    expect(() => validateBranchName("fix/issue-123")).not.toThrow();
  });

  it("rejects branches with --", () => {
    expect(() => validateBranchName("--option")).toThrow();
  });

  it("rejects branches with ..", () => {
    expect(() => validateBranchName("../../etc/passwd")).toThrow();
  });

  it("rejects empty branch names", () => {
    expect(() => validateBranchName("")).toThrow();
  });
});

describe("scrubSecrets", () => {
  it("scrubs GitHub tokens in clone URLs", () => {
    const input = "x-access-token:ghs_abc123def456xyz@github.com";
    expect(scrubSecrets(input)).not.toContain("ghs_abc123def456xyz");
    expect(scrubSecrets(input)).toContain("x-access-token:***@");
  });

  it("scrubs Bearer tokens", () => {
    const input =
      "Authorization: Bearer sk-ant-api03-longkeyvaluehere1234567890";
    expect(scrubSecrets(input)).not.toContain("sk-ant-api03");
  });

  it("scrubs AWS keys", () => {
    const input = "key=AKIAIOSFODNN7EXAMPLE";
    expect(scrubSecrets(input)).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("passes through safe strings unchanged", () => {
    const input = "Job completed successfully for repo owner/name";
    expect(scrubSecrets(input)).toBe(input);
  });

  it("scrubs Redis URLs with passwords", () => {
    const input = "redis://:secretpass@redis-host:6379";
    expect(scrubSecrets(input)).not.toContain("secretpass");
    expect(scrubSecrets(input)).toContain("redis://:[REDACTED]@");
  });
});

describe("validateRoutes", () => {
  it("returns default ['/'] for non-array input", () => {
    expect(validateRoutes("not-array")).toEqual(["/"]);
    expect(validateRoutes(null)).toEqual(["/"]);
  });

  it("accepts valid routes", () => {
    expect(validateRoutes(["/", "/about", "/api/users"])).toEqual([
      "/",
      "/about",
      "/api/users",
    ]);
  });

  it("rejects routes with ..", () => {
    expect(validateRoutes(["/../secret"])).toEqual(["/"]);
  });

  it("limits to 20 routes", () => {
    const routes = Array.from({ length: 25 }, (_, i) => `/page${i}`);
    expect(validateRoutes(routes)).toHaveLength(20);
  });
});
