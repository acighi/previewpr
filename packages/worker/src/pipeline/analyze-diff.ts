import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { ChangeUnit, AnalysisOutput } from "@previewpr/shared";

// --- Config ---

export interface ReviewConfig {
  frontend_paths: string[];
  backend_paths: string[];
  ignore_paths: string[];
  screenshot_base_url: string;
  routes: string[];
}

const DEFAULT_CONFIG: ReviewConfig = {
  frontend_paths: ["src/pages/", "src/components/"],
  backend_paths: ["src/api/", "src/server/"],
  ignore_paths: ["node_modules/", "dist/", ".git/"],
  screenshot_base_url: "http://localhost:5173",
  routes: ["/"],
};

// --- Config loader ---

export function loadConfig(repoRoot: string): ReviewConfig {
  const configPath = path.join(repoRoot, "review-guide.config.json");
  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

// --- Classification (ported from prototype as-is) ---

export function classifyFile(
  filePath: string,
  config: ReviewConfig,
): "frontend" | "backend" | "shared" {
  const matchesFrontend = checkFrontendMatch(filePath, config);
  const matchesBackend = checkBackendMatch(filePath, config);

  if (matchesFrontend && matchesBackend) return "shared";
  if (isSharedFile(filePath)) return "shared";
  if (matchesFrontend) return "frontend";
  if (matchesBackend) return "backend";
  return "shared";
}

function checkFrontendMatch(filePath: string, config: ReviewConfig): boolean {
  const frontendExtensions = [".tsx", ".jsx", ".css", ".scss", ".html"];
  const matchesPath = config.frontend_paths.some((p) => filePath.startsWith(p));
  const matchesExt = frontendExtensions.some((ext) => filePath.endsWith(ext));
  return matchesPath || matchesExt;
}

function checkBackendMatch(filePath: string, config: ReviewConfig): boolean {
  const backendPatterns = [".controller.", ".service.", ".model."];
  const matchesPath = config.backend_paths.some((p) => filePath.startsWith(p));
  const matchesPattern = backendPatterns.some((pat) => filePath.includes(pat));
  return matchesPath || matchesPattern;
}

function isSharedFile(filePath: string): boolean {
  const sharedExtensions = [".json", ".env", ".yml", ".toml"];
  return sharedExtensions.some((ext) => filePath.endsWith(ext));
}

// --- Grouping (ported from prototype as-is) ---

export function groupByDirectory(files: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const dir = getParentDirectory(file);
    const existing = groups.get(dir) || [];
    existing.push(file);
    groups.set(dir, existing);
  }
  return groups;
}

function getParentDirectory(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash === -1) return ".";
  return filePath.substring(0, lastSlash);
}

// --- Impact estimation (ported from prototype as-is) ---

export function estimateImpact(files: string[]): string {
  const visualExts = [".css", ".scss", ".svg", ".png", ".jpg", ".tsx", ".jsx"];
  const dataPatterns = ["model", "migration", "schema"];
  const configExts = [".json", ".env", ".yml", ".toml", ".config"];

  const hasVisual = files.some((f) =>
    visualExts.some((ext) => f.endsWith(ext)),
  );
  const hasData = files.some((f) =>
    dataPatterns.some((pat) => f.includes(pat)),
  );
  const hasConfig = files.some((f) =>
    configExts.some((ext) => f.endsWith(ext) || f.includes(ext)),
  );

  if (hasVisual) return "visual";
  if (hasData) return "data";
  if (hasConfig) return "config";
  return "behavioral";
}

// --- Directory comparison (replaces git-based functions) ---

export function getChangedFiles(mainDir: string, prDir: string): string[] {
  try {
    const output = execFileSync("diff", ["-rq", mainDir, prDir], {
      encoding: "utf-8",
      timeout: 30_000,
    });
    return parseDiffOutput(output, mainDir, prDir);
  } catch (err: unknown) {
    // diff exits with code 1 when files differ — that's expected
    if (
      err instanceof Error &&
      "status" in err &&
      (err as { status: number }).status === 1 &&
      "stdout" in err
    ) {
      return parseDiffOutput(
        (err as { stdout: string }).stdout,
        mainDir,
        prDir,
      );
    }
    return [];
  }
}

/**
 * Parse `diff -rq` output into relative file paths.
 *
 * Output lines look like:
 * - "Files /a/foo.ts and /b/foo.ts differ"
 * - "Only in /a/src: bar.ts"       (deleted in PR)
 * - "Only in /b/src: baz.ts"       (added in PR)
 */
export function parseDiffOutput(
  output: string,
  mainDir: string,
  prDir: string,
): string[] {
  const files: string[] = [];
  const normalizedMain = mainDir.endsWith("/") ? mainDir : `${mainDir}/`;
  const normalizedPr = prDir.endsWith("/") ? prDir : `${prDir}/`;

  for (const line of output.split("\n")) {
    if (line.startsWith("Files ")) {
      // "Files /a/foo.ts and /b/foo.ts differ"
      const match = line.match(/^Files (.+) and (.+) differ$/);
      if (match) {
        const relPath = match[1].startsWith(normalizedMain)
          ? match[1].slice(normalizedMain.length)
          : match[2].slice(normalizedPr.length);
        files.push(relPath);
      }
    } else if (line.startsWith("Only in ")) {
      // "Only in /a/src: bar.ts"
      const match = line.match(/^Only in (.+): (.+)$/);
      if (match) {
        const dir = match[1];
        const name = match[2];
        const fullPath = `${dir}/${name}`;
        if (fullPath.startsWith(normalizedMain)) {
          files.push(fullPath.slice(normalizedMain.length));
        } else if (fullPath.startsWith(normalizedPr)) {
          files.push(fullPath.slice(normalizedPr.length));
        }
      }
    }
  }

  return files;
}

export function getDiffContent(
  mainDir: string,
  prDir: string,
  file: string,
): string {
  const mainFile = path.join(mainDir, file);
  const prFile = path.join(prDir, file);

  // Handle files that only exist in one directory
  if (!existsSync(mainFile)) {
    return readFileSync(prFile, "utf-8")
      .split("\n")
      .map((l) => `+${l}`)
      .join("\n");
  }
  if (!existsSync(prFile)) {
    return readFileSync(mainFile, "utf-8")
      .split("\n")
      .map((l) => `-${l}`)
      .join("\n");
  }

  try {
    return execFileSync("diff", ["-u", mainFile, prFile], {
      encoding: "utf-8",
      timeout: 10_000,
    });
  } catch (err: unknown) {
    // diff exits 1 when files differ — stdout has the diff
    if (err instanceof Error && "stdout" in err) {
      return (err as { stdout: string }).stdout;
    }
    return "";
  }
}

function filterIgnoredFiles(files: string[], ignorePaths: string[]): string[] {
  return files.filter(
    (file) => !ignorePaths.some((pattern) => file.startsWith(pattern)),
  );
}

// --- Main analysis function ---

export function analyzeDiff(
  mainDir: string,
  prDir: string,
  outputDir: string,
): AnalysisOutput {
  const config = loadConfig(prDir);
  const allFiles = getChangedFiles(mainDir, prDir);
  const files = filterIgnoredFiles(allFiles, config.ignore_paths);

  const groups = groupByDirectory(files);
  const changes: ChangeUnit[] = [];
  let index = 0;

  for (const [_dir, groupFiles] of groups) {
    const category = classifyFile(groupFiles[0], config);
    const prefix =
      category === "frontend" ? "fe" : category === "backend" ? "be" : "sh";
    const id = `${prefix}-${String(index + 1).padStart(3, "0")}`;

    const diffs = groupFiles
      .map((f) => getDiffContent(mainDir, prDir, f))
      .join("\n");

    const unit: ChangeUnit = {
      id,
      category,
      title: path.basename(groupFiles[0]),
      files: groupFiles,
      diff: diffs,
      commit_messages: [], // Not available in two-directory mode
      estimated_impact: estimateImpact(groupFiles),
    };

    changes.push(unit);
    index++;
  }

  const output: AnalysisOutput = {
    head_sha: "directory-comparison",
    changes,
  };

  mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "changes.json");
  writeFileSync(outputPath, JSON.stringify(output, null, 2));

  return output;
}
