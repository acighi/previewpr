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

  // Rate limiting
  await app.register(rateLimit, {
    global: false,
  });

  // Raw body parsing for webhook signature verification
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body, done) => {
      try {
        const json = JSON.parse(body as string);
        // Attach raw body to request
        (req as any).rawBody = body;
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

  // Installation callback
  app.get<{ Querystring: { installation_id?: string } }>(
    "/install/callback",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const installationId = request.query.installation_id;
      if (!installationId) {
        return reply.code(400).send({ error: "Missing installation_id" });
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

  // Job status endpoint
  app.get<{ Params: { jobId: string } }>(
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
      const job = getJob(db, request.params.jobId);
      if (!job) {
        return reply.code(404).send({ error: "Job not found" });
      }
      return reply.send(job);
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
