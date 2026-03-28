import { describe, it, expect } from "vitest";
import {
  truncateDiff,
  buildPrompt,
  detectRisk,
  fallbackExplanation,
  FRONTEND_PROMPT,
  BACKEND_PROMPT,
} from "../pipeline/summarize-changes.js";

describe("truncateDiff", () => {
  it("truncates strings over 8000 chars", () => {
    const longString = "x".repeat(10_000);
    const result = truncateDiff(longString);

    expect(result.length).toBeLessThan(longString.length);
    expect(result).toContain("... [truncated]");
    expect(result.startsWith("x".repeat(8000))).toBe(true);
  });

  it("returns short strings unchanged", () => {
    const shortString = "hello world";
    const result = truncateDiff(shortString);

    expect(result).toBe(shortString);
  });
});

describe("buildPrompt", () => {
  const baseChange = {
    id: "test-1",
    title: "Test change",
    files: ["src/app.tsx"],
    diff: "some diff content",
    commit_messages: ["fix: button color"],
    estimated_impact: "low",
  };

  it("uses FRONTEND_PROMPT for frontend changes", () => {
    const change = { ...baseChange, category: "frontend" as const };
    const result = buildPrompt(change);

    expect(result).toContain("before/after screenshots");
    expect(result).toContain("some diff content");
    expect(result).toContain("fix: button color");
  });

  it("uses BACKEND_PROMPT for backend changes", () => {
    const change = { ...baseChange, category: "backend" as const };
    const result = buildPrompt(change);

    expect(result).toContain("backend code change");
    expect(result).toContain("some diff content");
    expect(result).toContain("fix: button color");
  });
});

describe("detectRisk", () => {
  it("returns response when it contains a risk keyword", () => {
    const response = "This change carries some risk to the login flow.";
    const result = detectRisk(response);

    expect(result).toBe(response);
  });

  it("returns null for safe responses", () => {
    const response = "This change updates the button color from blue to green.";
    const result = detectRisk(response);

    expect(result).toBeNull();
  });

  it("detects 'breaking' keyword", () => {
    const response = "This is a breaking change to the API.";
    expect(detectRisk(response)).toBe(response);
  });

  it("detects 'side effect' keyword", () => {
    const response = "This may have a side effect on caching.";
    expect(detectRisk(response)).toBe(response);
  });
});

describe("fallbackExplanation", () => {
  it("joins commit messages", () => {
    const messages = ["fix: header", "feat: add logo"];
    const result = fallbackExplanation(messages);

    expect(result).toBe("fix: header. feat: add logo");
  });

  it('returns "No description available." for empty array', () => {
    const result = fallbackExplanation([]);

    expect(result).toBe("No description available.");
  });
});
