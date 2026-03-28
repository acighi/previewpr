import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  classifyFile,
  estimateImpact,
  groupByDirectory,
  parseDiffOutput,
  analyzeDiff,
  type ReviewConfig,
} from "../pipeline/analyze-diff.js";

const DEFAULT_CONFIG: ReviewConfig = {
  frontend_paths: ["src/pages/", "src/components/"],
  backend_paths: ["src/api/", "src/server/"],
  ignore_paths: ["node_modules/", "dist/", ".git/"],
  screenshot_base_url: "http://localhost:5173",
  routes: ["/"],
};

describe("classifyFile", () => {
  it("classifies .tsx as frontend", () => {
    expect(classifyFile("src/App.tsx", DEFAULT_CONFIG)).toBe("frontend");
  });

  it("classifies .service.ts as backend", () => {
    expect(classifyFile("src/auth.service.ts", DEFAULT_CONFIG)).toBe("backend");
  });

  it("classifies .json as shared", () => {
    expect(classifyFile("package.json", DEFAULT_CONFIG)).toBe("shared");
  });

  it("classifies files in frontend_paths as frontend", () => {
    expect(classifyFile("src/pages/home.ts", DEFAULT_CONFIG)).toBe("frontend");
  });

  it("classifies files in backend_paths as backend", () => {
    expect(classifyFile("src/api/users.ts", DEFAULT_CONFIG)).toBe("backend");
  });

  it("classifies files matching both frontend and backend as shared", () => {
    // A .tsx file in a backend path matches both
    expect(classifyFile("src/api/form.tsx", DEFAULT_CONFIG)).toBe("shared");
  });
});

describe("estimateImpact", () => {
  it('returns "visual" for CSS files', () => {
    expect(estimateImpact(["src/styles/main.css"])).toBe("visual");
  });

  it('returns "visual" for TSX files', () => {
    expect(estimateImpact(["src/App.tsx"])).toBe("visual");
  });

  it('returns "data" for migration files', () => {
    expect(estimateImpact(["db/migration_001.sql"])).toBe("data");
  });

  it('returns "config" for JSON files', () => {
    expect(estimateImpact(["tsconfig.json"])).toBe("config");
  });

  it('returns "behavioral" for plain TS files', () => {
    expect(estimateImpact(["src/utils/helper.ts"])).toBe("behavioral");
  });
});

describe("groupByDirectory", () => {
  it("groups files by parent directory", () => {
    const groups = groupByDirectory([
      "src/pages/home.tsx",
      "src/pages/about.tsx",
      "src/api/users.ts",
    ]);

    expect(groups.get("src/pages")).toEqual([
      "src/pages/home.tsx",
      "src/pages/about.tsx",
    ]);
    expect(groups.get("src/api")).toEqual(["src/api/users.ts"]);
  });

  it("groups root-level files under '.'", () => {
    const groups = groupByDirectory(["package.json", "README.md"]);
    expect(groups.get(".")).toEqual(["package.json", "README.md"]);
  });
});

describe("parseDiffOutput", () => {
  it("parses 'Files ... differ' lines", () => {
    const output = "Files /tmp/main/src/app.ts and /tmp/pr/src/app.ts differ\n";
    const result = parseDiffOutput(output, "/tmp/main", "/tmp/pr");
    expect(result).toEqual(["src/app.ts"]);
  });

  it("parses 'Only in' lines for new files", () => {
    const output = "Only in /tmp/pr/src: newfile.ts\n";
    const result = parseDiffOutput(output, "/tmp/main", "/tmp/pr");
    expect(result).toEqual(["src/newfile.ts"]);
  });

  it("parses 'Only in' lines for deleted files", () => {
    const output = "Only in /tmp/main/src: old.ts\n";
    const result = parseDiffOutput(output, "/tmp/main", "/tmp/pr");
    expect(result).toEqual(["src/old.ts"]);
  });

  it("handles mixed output", () => {
    const output = [
      "Files /tmp/main/a.ts and /tmp/pr/a.ts differ",
      "Only in /tmp/pr/src: new.ts",
      "Only in /tmp/main: deleted.ts",
    ].join("\n");
    const result = parseDiffOutput(output, "/tmp/main", "/tmp/pr");
    expect(result).toEqual(["a.ts", "src/new.ts", "deleted.ts"]);
  });
});

describe("analyzeDiff", () => {
  it("produces correct changes.json from two directories with different files", () => {
    const tmpBase = mkdtempSync(path.join(os.tmpdir(), "analyze-diff-test-"));
    const mainDir = path.join(tmpBase, "main");
    const prDir = path.join(tmpBase, "pr");
    const outputDir = path.join(tmpBase, "output");

    try {
      // Set up main directory
      mkdirSync(path.join(mainDir, "src"), { recursive: true });
      writeFileSync(
        path.join(mainDir, "src", "app.tsx"),
        "export const App = () => <div>Hello</div>;\n",
      );
      writeFileSync(
        path.join(mainDir, "src", "utils.ts"),
        "export const add = (a: number, b: number) => a + b;\n",
      );

      // Set up PR directory — modified app.tsx, new file, same utils.ts
      mkdirSync(path.join(prDir, "src"), { recursive: true });
      writeFileSync(
        path.join(prDir, "src", "app.tsx"),
        "export const App = () => <div>Hello World</div>;\n",
      );
      writeFileSync(
        path.join(prDir, "src", "utils.ts"),
        "export const add = (a: number, b: number) => a + b;\n",
      );
      writeFileSync(
        path.join(prDir, "src", "newfile.css"),
        "body { color: red; }\n",
      );

      const result = analyzeDiff(mainDir, prDir, outputDir);

      // Should have found changes
      expect(result.changes.length).toBeGreaterThan(0);
      expect(result.head_sha).toBe("directory-comparison");

      // Verify the output file was written
      const outputPath = path.join(outputDir, "changes.json");
      const written = JSON.parse(readFileSync(outputPath, "utf-8"));
      expect(written.changes).toEqual(result.changes);

      // Find the change unit containing app.tsx
      const allFiles = result.changes.flatMap((c) => c.files);
      expect(allFiles).toContain("src/app.tsx");
      expect(allFiles).toContain("src/newfile.css");

      // utils.ts is identical — should NOT appear
      expect(allFiles).not.toContain("src/utils.ts");

      // Verify structure of a change unit
      for (const change of result.changes) {
        expect(change.id).toMatch(/^(fe|be|sh)-\d{3}$/);
        expect(["frontend", "backend", "shared"]).toContain(change.category);
        expect(change.files.length).toBeGreaterThan(0);
        expect(change.commit_messages).toEqual([]);
        expect(typeof change.diff).toBe("string");
        expect(typeof change.estimated_impact).toBe("string");
      }
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });
});
