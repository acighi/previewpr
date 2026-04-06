import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

// --- Constants ---

const CF_PAGES_PROJECT = "previewpr-reviews";

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

// --- Deploy logic using wrangler CLI ---

export function deployToPages(
  distDir: string,
  cfApiToken: string,
  cfAccountId: string,
  projectName: string,
): string {
  // wrangler pages deploy handles the full upload flow:
  // BLAKE3 hashing, check-missing, upload, upsert-hashes, create deployment
  const output = execFileSync(
    "npx",
    [
      "wrangler",
      "pages",
      "deploy",
      distDir,
      `--project-name=${projectName}`,
      "--commit-dirty=true",
    ],
    {
      timeout: 120_000,
      stdio: "pipe",
      // Use distDir's parent as cwd so wrangler can create its .wrangler/ cache
      // (the default /app/ cwd is root-owned in Docker, node user can't write there)
      cwd: path.dirname(distDir),
      env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: cfApiToken,
        CLOUDFLARE_ACCOUNT_ID: cfAccountId,
      },
    },
  );

  const text = output.toString("utf-8");

  // Extract deployment URL from wrangler output
  // Format: "✨ Deployment complete! Take a peek over at https://xxx.project.pages.dev"
  const urlMatch = text.match(/https:\/\/[^\s]+\.pages\.dev/);
  if (!urlMatch) {
    throw new Error(
      `Could not find deployment URL in wrangler output:\n${text}`,
    );
  }

  return urlMatch[0];
}

// --- Main function ---

export async function deployReviewApp(options: DeployOptions): Promise<string> {
  const { changesJsonPath, screenshotsDir, cfApiToken, cfAccountId } = options;

  // 1. Build review app with injected data
  const outputDir = path.dirname(changesJsonPath);
  const distDir = buildReviewApp(changesJsonPath, screenshotsDir, outputDir);

  // 2. Deploy to CF Pages via wrangler
  const deploymentUrl = deployToPages(
    distDir,
    cfApiToken,
    cfAccountId,
    CF_PAGES_PROJECT,
  );

  return deploymentUrl;
}
