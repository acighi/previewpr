import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  updateJobStatus,
  createLogger,
  validateBranchName,
  type PipelineJobData,
} from "@previewpr/shared";
import {
  detectProjectType,
  getFreePorts,
  runInstall,
  startContainer,
  stopContainer,
  waitForReady,
} from "./docker.js";
import { analyzeDiff } from "./pipeline/analyze-diff.js";
import { captureScreenshots } from "./pipeline/capture-screenshots.js";
import { generateDiffs } from "./pipeline/generate-diffs.js";
import { summarizeChanges } from "./pipeline/summarize-changes.js";
import { deployReviewApp } from "./pipeline/deploy-review-app.js";

export const PIPELINE_TIMEOUT = 300_000; // 5 minutes

export interface PipelineContext {
  db: Database.Database;
  jobDir: string;
  cloneToken: string;
  anthropicApiKey: string;
  cfApiToken: string;
  cfAccountId: string;
}

/**
 * Create a temporary GIT_ASKPASS script that outputs the token.
 * This avoids embedding the token in the clone URL (which leaks via
 * `ps aux`, error messages, and git config).
 */
function createAskPassScript(jobDir: string, token: string): string {
  const scriptPath = path.join(jobDir, ".git-askpass.sh");
  writeFileSync(scriptPath, `#!/bin/sh\necho "${token}"\n`, { mode: 0o700 });
  chmodSync(scriptPath, 0o700);
  return scriptPath;
}

function cloneRepos(
  jobDir: string,
  repoFullName: string,
  baseBranch: string,
  prBranch: string,
  cloneToken: string,
): void {
  // Validate branch names before using them in git commands
  validateBranchName(baseBranch);
  validateBranchName(prBranch);

  const mainDir = path.join(jobDir, "main");
  const prDir = path.join(jobDir, "pr");
  mkdirSync(mainDir, { recursive: true });
  mkdirSync(prDir, { recursive: true });

  // Use GIT_ASKPASS to pass the token securely — never embed in URL
  const askPassScript = createAskPassScript(jobDir, cloneToken);
  const cloneUrl = `https://x-access-token@github.com/${repoFullName}.git`;
  const cloneEnv = {
    ...process.env,
    GIT_ASKPASS: askPassScript,
    GIT_TERMINAL_PROMPT: "0",
  };

  execFileSync(
    "git",
    ["clone", "--depth", "1", "--branch", baseBranch, cloneUrl, mainDir],
    { timeout: 60_000, stdio: "pipe", env: cloneEnv },
  );

  execFileSync(
    "git",
    ["clone", "--depth", "1", "--branch", prBranch, cloneUrl, prDir],
    { timeout: 60_000, stdio: "pipe", env: cloneEnv },
  );
}

async function bootContainers(
  mainDir: string,
  prDir: string,
  jobId: string,
): Promise<{
  mainPort: number;
  prPort: number;
  mainContainer: string;
  prContainer: string;
}> {
  const [mainPort, prPort] = await getFreePorts(2);
  const mainName = `ppr-main-${jobId.slice(0, 8)}`;
  const prName = `ppr-pr-${jobId.slice(0, 8)}`;

  // Detect project type from PR branch (both branches are the same repo)
  const projectType = detectProjectType(prDir);

  runInstall(mainDir, `${mainName}-install`, projectType);
  runInstall(prDir, `${prName}-install`, projectType);

  startContainer(mainDir, mainName, mainPort, projectType);
  startContainer(prDir, prName, prPort, projectType);

  await waitForReady(mainPort);
  await waitForReady(prPort);

  return { mainPort, prPort, mainContainer: mainName, prContainer: prName };
}

function cleanup(
  mainContainer: string | null,
  prContainer: string | null,
  jobDir: string,
): void {
  if (mainContainer) stopContainer(mainContainer);
  if (prContainer) stopContainer(prContainer);
  try {
    rmSync(jobDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

export async function runPipeline(
  job: PipelineJobData,
  ctx: PipelineContext,
): Promise<string> {
  const log = createLogger({ jobId: job.jobId });
  let mainContainer: string | null = null;
  let prContainer: string | null = null;

  try {
    updateJobStatus(ctx.db, job.jobId, "running");

    cloneRepos(
      ctx.jobDir,
      job.repoFullName,
      job.baseBranch,
      job.prBranch,
      ctx.cloneToken,
    );

    const mainDir = path.join(ctx.jobDir, "main");
    const prDir = path.join(ctx.jobDir, "pr");
    const containers = await bootContainers(mainDir, prDir, job.jobId);
    mainContainer = containers.mainContainer;
    prContainer = containers.prContainer;

    // Step 4: Analyze diff between main and PR directories
    const outputDir = path.join(ctx.jobDir, "output");
    const analysis = analyzeDiff(mainDir, prDir, outputDir);
    log.info(`Step 4: analyzed diff — ${analysis.changes.length} change units`);

    // Step 5: Capture before/after screenshots
    const frontendChanges = analysis.changes.filter(
      (c) => c.category === "frontend" || c.estimated_impact === "visual",
    );
    const captureResult = await captureScreenshots({
      changes: frontendChanges,
      routes: [], // TODO: read from repo config
      beforePort: containers.mainPort,
      afterPort: containers.prPort,
      outputDir,
    });
    log.info(
      `Step 5: captured screenshots for ${Object.keys(captureResult.screenshots).length} changes`,
    );

    // Step 6: Generate pixel-diff PNGs
    const screenshotsJsonPath = path.join(outputDir, "screenshots.json");
    await generateDiffs(screenshotsJsonPath, outputDir);
    log.info("Step 6: generated diff images");

    // Step 7: Summarize changes with AI
    const changesJsonPath = path.join(outputDir, "changes.json");
    await summarizeChanges(changesJsonPath, ctx.anthropicApiKey);
    log.info("Step 7: summarized changes");

    // Step 8: Build and deploy review app to CF Pages
    const screenshotsDir = path.join(outputDir, "screenshots");
    const reviewUrl = await deployReviewApp({
      changesJsonPath,
      screenshotsDir,
      cfApiToken: ctx.cfApiToken,
      cfAccountId: ctx.cfAccountId,
      jobId: job.jobId,
    });
    log.info(`Step 8: deployed review app — ${reviewUrl}`);

    updateJobStatus(ctx.db, job.jobId, "completed", { review_url: reviewUrl });

    return reviewUrl;
  } finally {
    cleanup(mainContainer, prContainer, ctx.jobDir);
  }
}
