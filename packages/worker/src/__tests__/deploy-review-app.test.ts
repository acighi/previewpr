import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildReviewApp } from "../pipeline/deploy-review-app.js";

// We test buildReviewApp's file-copy logic only (no vite build).
// To avoid running `npm ci` + `npx vite build`, we mock execFileSync.

import { vi } from "vitest";
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn((cmd: string, args: string[], opts: { cwd?: string }) => {
    // When "vite build" is called, create a fake dist/ directory
    if (cmd === "npx" && args?.[0] === "vite" && opts?.cwd) {
      mkdirSync(path.join(opts.cwd, "dist"), { recursive: true });
      writeFileSync(
        path.join(opts.cwd, "dist", "index.html"),
        "<html>built</html>",
      );
    }
  }),
}));

describe("buildReviewApp", () => {
  let tmpDir: string;
  let changesJsonPath: string;
  let screenshotsDir: string;
  let outputDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "ppr-deploy-test-"));

    // Create mock changes.json
    const changesDir = path.join(tmpDir, "pipeline-output");
    mkdirSync(changesDir, { recursive: true });
    changesJsonPath = path.join(changesDir, "changes.json");
    const mockData = {
      head_sha: "abc123",
      changes: [{ id: "change-1", title: "Test change" }],
      screenshots: {},
    };
    writeFileSync(changesJsonPath, JSON.stringify(mockData));

    // Create mock screenshots directory
    screenshotsDir = path.join(changesDir, "screenshots");
    mkdirSync(path.join(screenshotsDir, "change-1"), { recursive: true });
    writeFileSync(
      path.join(screenshotsDir, "change-1", "before.png"),
      "fake-png-before",
    );
    writeFileSync(
      path.join(screenshotsDir, "change-1", "after.png"),
      "fake-png-after",
    );

    outputDir = path.join(tmpDir, "build-output");
    mkdirSync(outputDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  it("copies review-app source to build directory", () => {
    buildReviewApp(changesJsonPath, screenshotsDir, outputDir);

    const buildDir = path.join(outputDir, "review-app-build");
    expect(existsSync(buildDir)).toBe(true);
    // Should have package.json from the review app source
    expect(existsSync(path.join(buildDir, "package.json"))).toBe(true);
    expect(existsSync(path.join(buildDir, "index.html"))).toBe(true);
    expect(existsSync(path.join(buildDir, "vite.config.ts"))).toBe(true);
  });

  it("copies changes.json as review-data/data.json into public/", () => {
    buildReviewApp(changesJsonPath, screenshotsDir, outputDir);

    const dataJsonPath = path.join(
      outputDir,
      "review-app-build",
      "public",
      "review-data",
      "data.json",
    );
    expect(existsSync(dataJsonPath)).toBe(true);

    const content = JSON.parse(readFileSync(dataJsonPath, "utf-8"));
    expect(content.head_sha).toBe("abc123");
    expect(content.changes).toHaveLength(1);
    expect(content.changes[0].id).toBe("change-1");
  });

  it("copies screenshots to public/review-data/screenshots/", () => {
    buildReviewApp(changesJsonPath, screenshotsDir, outputDir);

    const screenshotsDest = path.join(
      outputDir,
      "review-app-build",
      "public",
      "review-data",
      "screenshots",
    );
    expect(existsSync(screenshotsDest)).toBe(true);
    expect(
      existsSync(path.join(screenshotsDest, "change-1", "before.png")),
    ).toBe(true);
    expect(
      existsSync(path.join(screenshotsDest, "change-1", "after.png")),
    ).toBe(true);

    // Verify content
    const content = readFileSync(
      path.join(screenshotsDest, "change-1", "before.png"),
      "utf-8",
    );
    expect(content).toBe("fake-png-before");
  });

  it("handles missing screenshots directory gracefully", () => {
    const nonExistentDir = path.join(tmpDir, "no-screenshots");

    // Should not throw
    buildReviewApp(changesJsonPath, nonExistentDir, outputDir);

    const dataJsonPath = path.join(
      outputDir,
      "review-app-build",
      "public",
      "review-data",
      "data.json",
    );
    expect(existsSync(dataJsonPath)).toBe(true);

    // Screenshots dir should not exist in build output
    const screenshotsDest = path.join(
      outputDir,
      "review-app-build",
      "public",
      "review-data",
      "screenshots",
    );
    expect(existsSync(screenshotsDest)).toBe(false);
  });
});
