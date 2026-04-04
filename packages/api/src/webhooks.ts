import crypto from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { Queue } from "bullmq";
import type Database from "better-sqlite3";
import type { PipelineJobData } from "@previewpr/shared";
import {
  getInstallation,
  insertInstallation,
  insertJob,
  incrementPrCount,
  removeInstallation,
  updateInstallationRepos,
  createLogger,
  createJobToken,
} from "@previewpr/shared";

const logger = createLogger();

export function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature) return false;

  const expected = Buffer.from(
    "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex"),
  );
  const received = Buffer.from(signature);

  if (expected.length !== received.length) return false;

  return crypto.timingSafeEqual(expected, received);
}

interface WebhookDeps {
  db: Database.Database;
  queue: Queue<PipelineJobData>;
  webhookSecret: string;
  postPrComment: (
    installationId: number,
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
  ) => Promise<void>;
}

interface WebhookRequest extends FastifyRequest {
  rawBody: string;
}

export function createWebhookHandler(deps: WebhookDeps) {
  return async (request: WebhookRequest, reply: FastifyReply) => {
    const { db, queue, webhookSecret, postPrComment } = deps;

    // Verify signature
    const signature = (request.headers["x-hub-signature-256"] as string) || "";
    if (!verifyWebhookSignature(request.rawBody, signature, webhookSecret)) {
      return reply.code(401).send({ error: "Invalid signature" });
    }

    const event = request.headers["x-github-event"] as string;
    const payload = request.body as Record<string, any>;

    // Route by event type
    if (event === "installation") {
      if (payload.action === "created") {
        const inst = payload.installation;
        const account = inst.account;
        insertInstallation(db, {
          github_id: inst.id,
          account_login: account.login,
          account_type: account.type,
          repos: "all",
          plan: "free",
        });
        logger.info("Installation created", {
          github_id: inst.id,
          account: account.login,
        });
        return reply.send({ ok: true });
      }

      if (payload.action === "deleted") {
        removeInstallation(db, payload.installation.id);
        logger.info("Installation removed", {
          github_id: payload.installation.id,
        });
        return reply.send({ ok: true });
      }

      return reply.send({ ok: true, skipped: true });
    }

    if (event === "installation_repositories") {
      const githubId = payload.installation.id;
      if (payload.action === "added" || payload.action === "removed") {
        // Gather current repo list from payload
        const repos = (
          payload.repositories_added ||
          payload.repositories ||
          []
        ).map((r: { full_name: string }) => r.full_name);
        updateInstallationRepos(db, githubId, repos);
        logger.info("Installation repos updated", {
          github_id: githubId,
          action: payload.action,
        });
      }
      return reply.send({ ok: true });
    }

    if (event === "pull_request") {
      const action = payload.action;

      // Only handle relevant PR actions
      if (!["opened", "synchronize", "reopened"].includes(action)) {
        return reply.send({ ok: true, skipped: true });
      }

      const installationGithubId = payload.installation?.id;
      if (!installationGithubId) {
        return reply.code(400).send({ error: "Missing installation ID" });
      }

      const installation = getInstallation(db, installationGithubId);
      if (!installation) {
        return reply.code(404).send({ error: "Installation not found" });
      }

      // Check free tier limit
      if (installation.plan === "free" && installation.pr_count_month >= 50) {
        const [owner, repo] = payload.repository.full_name.split("/");
        await postPrComment(
          installationGithubId,
          owner,
          repo,
          payload.pull_request.number,
          "You've reached the free tier limit of 3 PRs/month. " +
            "[Upgrade to Pro](https://previewpr.com/pricing) for unlimited visual reviews.",
        );
        return reply.send({
          ok: true,
          skipped: true,
          reason: "free_tier_limit",
        });
      }

      // Insert job and increment PR count
      const pr = payload.pull_request;
      const repoFullName = payload.repository.full_name;
      const jobId = insertJob(db, {
        installation_id: installation.id,
        repo_full_name: repoFullName,
        pr_number: pr.number,
        pr_branch: pr.head.ref,
        base_branch: pr.base.ref,
        head_sha: pr.head.sha,
      });

      incrementPrCount(db, installation.id);

      // Enqueue to BullMQ
      await queue.add("pipeline", {
        jobId,
        installationGithubId,
        repoFullName,
        prNumber: pr.number,
        prBranch: pr.head.ref,
        baseBranch: pr.base.ref,
        headSha: pr.head.sha,
      });

      // Generate HMAC token for the job status URL
      const jobToken = createJobToken(jobId, webhookSecret);

      // Post "generating..." comment with authenticated status link
      const [owner, repo] = repoFullName.split("/");
      await postPrComment(
        installationGithubId,
        owner,
        repo,
        pr.number,
        `Generating visual review... This usually takes 1-2 minutes.\n\n[Check status](https://api.previewpr.com/jobs/${jobId}?token=${jobToken})`,
      );

      logger.info("Job created for PR", {
        jobId,
        repo: repoFullName,
        pr: pr.number,
      });

      return reply.send({ ok: true, jobId });
    }

    // All other events
    return reply.send({ ok: true, skipped: true });
  };
}
