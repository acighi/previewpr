import path from "node:path";
import { mkdirSync } from "node:fs";
import {
  initGitHubApp,
  getCloneToken,
  postPrComment,
  createDb,
  createWorkerProcessor,
  createLogger,
  updateJobStatus,
  scrubSecrets,
  type PipelineJobData,
} from "@previewpr/shared";
import { loadEnv } from "./env.js";
import { runPipeline, type PipelineContext } from "./pipeline.js";

const log = createLogger();

const env = loadEnv();

initGitHubApp(env.GITHUB_APP_ID, env.GITHUB_PRIVATE_KEY);
const db = createDb(env.DATABASE_PATH);
mkdirSync(env.JOBS_DIR, { recursive: true });

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

    const reviewUrl = await runPipeline(job, ctx);

    const [owner, repo] = job.repoFullName.split("/");
    await postPrComment(
      job.installationGithubId,
      owner,
      repo,
      job.prNumber,
      `## PreviewPR Review Ready\n\nVisual review is ready: ${reviewUrl}`,
    );

    jobLog.info("Job completed", { reviewUrl });
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    const message = scrubSecrets(rawMessage);
    jobLog.error("Job failed", { error: message });
    updateJobStatus(db, job.jobId, "failed", { error_message: message });

    try {
      const [owner, repo] = job.repoFullName.split("/");
      await postPrComment(
        job.installationGithubId,
        owner,
        repo,
        job.prNumber,
        `## PreviewPR Error\n\nPipeline failed. Check the dashboard for details.`,
      );
    } catch (commentErr) {
      jobLog.error("Failed to post error comment", {
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

log.info("Worker started", { redis: env.REDIS_URL });

process.on("SIGTERM", async () => {
  log.info("Shutting down worker...");
  await worker.close();
  db.close();
  process.exit(0);
});
