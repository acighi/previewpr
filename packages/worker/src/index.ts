import path from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import {
  initGitHubApp,
  getCloneToken,
  postPrComment,
  updatePrComment,
  createDb,
  createWorkerProcessor,
  createLogger,
  updateJobStatus,
  scrubSecrets,
  type PipelineJobData,
} from "@previewpr/shared";
import { loadEnv } from "./env.js";
import {
  runPipeline,
  PIPELINE_TIMEOUT,
  type PipelineContext,
} from "./pipeline.js";

const log = createLogger();

const env = loadEnv();

initGitHubApp(env.GITHUB_APP_ID, env.GITHUB_PRIVATE_KEY);
const db = createDb(env.DATABASE_PATH);
mkdirSync(env.JOBS_DIR, { recursive: true });

// Clean up orphaned containers from previous crashes
try {
  const orphans = execFileSync(
    "docker",
    ["ps", "-aq", "--filter", "name=ppr-"],
    {
      encoding: "utf-8",
    },
  ).trim();
  if (orphans) {
    const ids = orphans.split("\n").filter(Boolean);
    execFileSync("docker", ["rm", "-f", ...ids]);
    log.warn("Cleaned up orphaned containers", { count: ids.length });
  }
} catch {
  // Docker not available or no orphans — safe to continue
}

async function processJob(job: PipelineJobData): Promise<void> {
  const jobLog = createLogger({ jobId: job.jobId });
  jobLog.info("Processing job", { repo: job.repoFullName, pr: job.prNumber });

  try {
    const cloneToken = await getCloneToken(job.installationGithubId);
    const jobDir = path.join(env.JOBS_DIR, job.jobId);

    const ctx: PipelineContext = {
      db,
      jobDir,
      cloneToken,
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      cfApiToken: env.CF_API_TOKEN,
      cfAccountId: env.CF_ACCOUNT_ID,
    };

    const timeoutErr = new Error(
      `Pipeline timed out after ${PIPELINE_TIMEOUT / 1000}s`,
    );
    const reviewUrl = await Promise.race([
      runPipeline(job, ctx),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(timeoutErr), PIPELINE_TIMEOUT),
      ),
    ]);

    const [owner, repo] = job.repoFullName.split("/");
    const body = `## PreviewPR Review Ready\n\nVisual review is ready: ${reviewUrl}`;
    if (job.commentId) {
      await updatePrComment(
        job.installationGithubId,
        owner,
        repo,
        job.commentId,
        body,
      );
    } else {
      await postPrComment(
        job.installationGithubId,
        owner,
        repo,
        job.prNumber,
        body,
      );
    }

    jobLog.info("Job completed", { reviewUrl });
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    const message = scrubSecrets(rawMessage);
    jobLog.error("Job failed", { error: message });
    updateJobStatus(db, job.jobId, "failed", { error_message: message });

    try {
      const [owner, repo] = job.repoFullName.split("/");
      const body = `## PreviewPR Error\n\nPipeline failed. Check the dashboard for details.`;
      if (job.commentId) {
        await updatePrComment(
          job.installationGithubId,
          owner,
          repo,
          job.commentId,
          body,
        );
      }
      // If no commentId, don't post a new comment — avoids duplicates on retry
    } catch (commentErr) {
      jobLog.error("Failed to update error comment", {
        error:
          commentErr instanceof Error ? commentErr.message : String(commentErr),
      });
    }

    throw err;
  }
}

const worker = createWorkerProcessor(env.REDIS_URL, async (bullJob) => {
  await processJob(bullJob.data);
});

const healthServer = createServer(async (req, res) => {
  if (req.url === "/health") {
    const running = worker.isRunning();
    if (running) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "error" }));
    }
  } else {
    res.writeHead(404);
    res.end();
  }
});
healthServer.listen(env.HEALTH_PORT);

log.info("Worker started", {
  redis: new URL(env.REDIS_URL).hostname,
  healthPort: env.HEALTH_PORT,
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    log.info(`Received ${signal}, shutting down worker...`);
    healthServer.close();
    await worker.close();
    db.close();
    process.exit(0);
  });
}
