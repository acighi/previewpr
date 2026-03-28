import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  updateJobStatus,
  createLogger,
  type PipelineJobData,
} from "@previewpr/shared";
import {
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

export const PIPELINE_TIMEOUT = 300_000; // 5 minutes

export interface PipelineContext {
  db: Database.Database;
  jobDir: string;
  cloneToken: string;
  anthropicApiKey: string;
  cfApiToken: string;
  cfAccountId: string;
}

function cloneRepos(
  jobDir: string,
  cloneUrl: string,
  baseBranch: string,
  prBranch: string,
): void {
  const mainDir = path.join(jobDir, "main");
  const prDir = path.join(jobDir, "pr");
  mkdirSync(mainDir, { recursive: true });
  mkdirSync(prDir, { recursive: true });

  execFileSync(
    "git",
    ["clone", "--depth", "1", "--branch", baseBranch, cloneUrl, mainDir],
    { timeout: 60_000, stdio: "pipe" },
  );

  execFileSync(
    "git",
    ["clone", "--depth", "1", "--branch", prBranch, cloneUrl, prDir],
    { timeout: 60_000, stdio: "pipe" },
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

  runInstall(mainDir, `${mainName}-install`);
  runInstall(prDir, `${prName}-install`);

  const mainContainer = startContainer(mainDir, mainName, mainPort);
  const prContainer = startContainer(prDir, prName, prPort);

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

    const cloneUrl = `https://x-access-token:${ctx.cloneToken}@github.com/${job.repoFullName}.git`;
    cloneRepos(ctx.jobDir, cloneUrl, job.baseBranch, job.prBranch);

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
    log.info("Step 8: TODO - deployReviewApp");

    const reviewUrl = `https://previewpr.com/review/${job.jobId}`;
    updateJobStatus(ctx.db, job.jobId, "completed", { review_url: reviewUrl });

    return reviewUrl;
  } finally {
    cleanup(mainContainer, prContainer, ctx.jobDir);
  }
}
