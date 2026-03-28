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

    log.info("Step 4: TODO - analyzeDiff");
    log.info("Step 5: TODO - captureScreenshots");
    log.info("Step 6: TODO - generateDiffs");
    log.info("Step 7: TODO - summarizeChanges");
    log.info("Step 8: TODO - deployReviewApp");

    const reviewUrl = `https://previewpr.com/review/${job.jobId}`;
    updateJobStatus(ctx.db, job.jobId, "completed", { review_url: reviewUrl });

    return reviewUrl;
  } finally {
    cleanup(mainContainer, prContainer, ctx.jobDir);
  }
}
