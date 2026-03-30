import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

// --- Constants ---

const CF_PAGES_PROJECT = "previewpr-reviews";
const CF_API_BASE = "https://api.cloudflare.com/client/v4";

// The review-app source lives alongside the worker package
const REVIEW_APP_SRC = path.resolve(import.meta.dirname, "../../review-app");

// --- Types ---

export interface DeployOptions {
  changesJsonPath: string;
  screenshotsDir: string;
  cfApiToken: string;
  cfAccountId: string;
  jobId: string;
}

interface CfApiResponse<T = unknown> {
  success: boolean;
  result: T;
  errors: Array<{ code: number; message: string }>;
}

interface CfDeploymentResult {
  url: string;
  id: string;
}

// --- CF Pages API helpers ---

export async function ensureCfPagesProject(
  cfApiToken: string,
  cfAccountId: string,
  projectName: string,
): Promise<void> {
  const url = `${CF_API_BASE}/accounts/${cfAccountId}/pages/projects/${projectName}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${cfApiToken}` },
  });

  if (resp.ok) return; // project exists

  if (resp.status === 404) {
    const createUrl = `${CF_API_BASE}/accounts/${cfAccountId}/pages/projects`;
    const createResp = await fetch(createUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfApiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: projectName,
        production_branch: "main",
      }),
    });

    if (!createResp.ok) {
      const body = await createResp.text();
      throw new Error(
        `Failed to create CF Pages project "${projectName}": ${createResp.status} ${body}`,
      );
    }
    return;
  }

  throw new Error(
    `Failed to check CF Pages project "${projectName}": ${resp.status}`,
  );
}

// --- Build logic ---

export function buildReviewApp(
  changesJsonPath: string,
  screenshotsDir: string,
  outputDir: string,
): string {
  // 1. Copy review-app source to a temp build directory
  const buildDir = path.join(outputDir, "review-app-build");
  mkdirSync(buildDir, { recursive: true });
  cpSync(REVIEW_APP_SRC, buildDir, {
    recursive: true,
    filter: (src: string) => {
      const basename = path.basename(src);
      // Skip node_modules, dist, and .git from source
      return (
        basename !== "node_modules" &&
        basename !== "dist" &&
        basename !== ".git"
      );
    },
  });

  // 2. Copy changes.json as review-data/data.json in public/
  const publicReviewData = path.join(buildDir, "public", "review-data");
  mkdirSync(publicReviewData, { recursive: true });
  const changesData = readFileSync(changesJsonPath, "utf-8");
  writeFileSync(path.join(publicReviewData, "data.json"), changesData);

  // 3. Copy screenshots into public/review-data/screenshots/
  // Screenshots come from our pipeline (not user-controlled), but sanitize
  // filenames to prevent path traversal if the pipeline is ever compromised
  if (existsSync(screenshotsDir)) {
    const destScreenshots = path.join(publicReviewData, "screenshots");
    cpSync(screenshotsDir, destScreenshots, {
      recursive: true,
      filter: (src: string) => {
        const name = path.basename(src);
        // Block path traversal and non-image files
        return !name.includes("..") && !name.startsWith(".");
      },
    });
  }

  // 4. Install deps and run vite build
  execFileSync("npm", ["ci", "--ignore-scripts"], {
    cwd: buildDir,
    timeout: 120_000,
    stdio: "pipe",
  });

  execFileSync("npx", ["vite", "build"], {
    cwd: buildDir,
    timeout: 60_000,
    stdio: "pipe",
  });

  const distDir = path.join(buildDir, "dist");
  if (!existsSync(distDir)) {
    throw new Error(`Vite build did not produce dist/ at ${distDir}`);
  }

  return distDir;
}

// --- Deploy logic ---

/**
 * Recursively collect all files in a directory, returning paths relative to root.
 */
function collectFiles(dir: string, root?: string): string[] {
  const base = root ?? dir;
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectFiles(full, base));
    } else {
      files.push(path.relative(base, full));
    }
  }
  return files;
}

export async function deployToPages(
  distDir: string,
  cfApiToken: string,
  cfAccountId: string,
  projectName: string,
): Promise<string> {
  const url = `${CF_API_BASE}/accounts/${cfAccountId}/pages/projects/${projectName}/deployments`;

  // Build multipart form data with all files from dist
  const formData = new FormData();
  const files = collectFiles(distDir);

  for (const relPath of files) {
    const fullPath = path.join(distDir, relPath);
    const content = readFileSync(fullPath);
    const blob = new Blob([content]);
    // CF Pages expects file paths as the field name with "/" prefix
    formData.append(`/${relPath}`, blob, relPath);
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfApiToken}` },
    body: formData,
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`CF Pages deploy failed: ${resp.status} ${body}`);
  }

  const data = (await resp.json()) as CfApiResponse<CfDeploymentResult>;
  if (!data.success) {
    throw new Error(
      `CF Pages deploy error: ${data.errors.map((e) => e.message).join(", ")}`,
    );
  }

  return data.result.url;
}

// --- Main function ---

export async function deployReviewApp(options: DeployOptions): Promise<string> {
  const { changesJsonPath, screenshotsDir, cfApiToken, cfAccountId } = options;

  // 1. Build review app with injected data
  const outputDir = path.dirname(changesJsonPath);
  const distDir = buildReviewApp(changesJsonPath, screenshotsDir, outputDir);

  // 2. Ensure CF Pages project exists
  await ensureCfPagesProject(cfApiToken, cfAccountId, CF_PAGES_PROJECT);

  // 3. Deploy to CF Pages
  const deploymentUrl = await deployToPages(
    distDir,
    cfApiToken,
    cfAccountId,
    CF_PAGES_PROJECT,
  );

  return deploymentUrl;
}
