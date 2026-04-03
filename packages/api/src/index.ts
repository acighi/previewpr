import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import {
  createDb,
  createQueue,
  initGitHubApp,
  postPrComment,
  getJob,
  insertInstallation,
  createLogger,
  scrubSecrets,
  verifyJobToken,
} from "@previewpr/shared";
import { loadEnv } from "./env.js";
import { createWebhookHandler } from "./webhooks.js";

const logger = createLogger();

async function main() {
  const env = loadEnv();

  // Initialize dependencies
  const db = createDb(env.DATABASE_PATH);
  const queue = createQueue(env.REDIS_URL);
  initGitHubApp(env.GITHUB_APP_ID, env.GITHUB_PRIVATE_KEY);

  const app = Fastify({ logger: false });

  // Rate limiting — global by default, individual routes can override
  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: "1 minute",
  });

  // Raw body parsing for webhook signature verification
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (req, body, done) => {
      try {
        const rawBody = (body as Buffer).toString("utf-8");
        const json = JSON.parse(rawBody);
        // Attach raw body to request for HMAC signature verification
        (req as any).rawBody = rawBody;
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // Health check
  app.get("/health", async () => {
    return { status: "ok" };
  });

  // Webhook endpoint with stricter rate limit
  const webhookHandler = createWebhookHandler({
    db,
    queue,
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
    postPrComment,
  });

  app.post(
    "/webhooks/github",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
    },
    webhookHandler as any,
  );

  // Installation callback — validates with GitHub OAuth code exchange
  app.get<{
    Querystring: { installation_id?: string; code?: string; state?: string };
  }>(
    "/install/callback",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const installationId = request.query.installation_id;
      const code = request.query.code;

      if (!installationId) {
        return reply.code(400).send({ error: "Missing installation_id" });
      }

      // If we have an OAuth code, exchange it to verify the request is authentic
      if (code) {
        try {
          const tokenResp = await fetch(
            "https://github.com/login/oauth/access_token",
            {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                client_id: env.GITHUB_CLIENT_ID,
                client_secret: env.GITHUB_CLIENT_SECRET,
                code,
              }),
            },
          );
          const tokenData = (await tokenResp.json()) as Record<string, unknown>;
          if (tokenData.error || !tokenData.access_token) {
            logger.warn("OAuth code exchange failed", {
              error: tokenData.error,
            });
            return reply.code(403).send({ error: "Invalid OAuth code" });
          }
        } catch (err) {
          logger.error("OAuth verification failed", {
            error: scrubSecrets(String(err)),
          });
          return reply.code(500).send({ error: "OAuth verification failed" });
        }
      }

      // Store minimal installation record; webhook will fill details
      insertInstallation(db, {
        github_id: Number(installationId),
        account_login: "pending",
        account_type: "User",
        repos: "all",
        plan: "free",
      });

      logger.info("Installation callback received", {
        installation_id: installationId,
      });

      return reply.redirect("https://previewpr.com/install/success");
    },
  );

  // Job status endpoint — requires HMAC-signed token for access
  app.get<{ Params: { jobId: string }; Querystring: { token?: string } }>(
    "/jobs/:jobId",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const { jobId } = request.params;
      const token = request.query.token;

      if (!token || !verifyJobToken(jobId, token, env.GITHUB_WEBHOOK_SECRET)) {
        return reply.code(403).send({ error: "Invalid or missing token" });
      }

      const job = getJob(db, jobId);
      if (!job) {
        return reply.code(404).send({ error: "Job not found" });
      }

      // Return safe subset — never expose raw error_message to external callers
      return reply.send({
        id: job.id,
        repo_full_name: job.repo_full_name,
        pr_number: job.pr_number,
        status: job.status,
        review_url: job.review_url,
        created_at: job.created_at,
        completed_at: job.completed_at,
      });
    },
  );

  // Start server
  await app.listen({ host: "0.0.0.0", port: env.PORT });
  logger.info(`API server listening on port ${env.PORT}`);
}

main().catch((err) => {
  logger.error("Failed to start API server", { error: String(err) });
  process.exit(1);
});
