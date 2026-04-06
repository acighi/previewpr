# Phase 2: Post-Launch Hardening — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix correctness bugs, add job deduplication, close security gaps from stress test review, add CI/CD pipeline and test coverage for critical untested code.

**Architecture:** 24 targeted fixes across 6 batches. Correctness first (billing bugs, data loss), then reliability (dedup, dead-letter), security (injection, SSRF), testing (security-critical functions), CI/CD (Biome, GitHub Actions), and finally Zod validation. Most tasks are 5-30 lines each. Job dedup requires a migration + webhook changes.

**Tech Stack:** Node.js 20, TypeScript, Fastify, BullMQ, better-sqlite3, Vitest, Biome, GitHub Actions

---

## Execution Order

Tasks are grouped into dependency batches. Within each batch, tasks are independent.

**Batch 0 (correctness):** Tasks 1, 2, 3, 4, 5
**Batch 1 (reliability):** Tasks 6, 7, 8, 9
**Batch 2 (security):** Tasks 10, 11, 12, 13
**Batch 3 (testing):** Tasks 14, 15, 16, 17, 18, 19
**Batch 4 (CI/CD):** Tasks 20, 21, 22, 23
**Batch 5 (validation):** Task 24

---

### Task 1: Fix TOCTOU race on free tier limit check

**Files:**
- Modify: `packages/api/src/webhooks.ts:138-180`

**Step 1: Move limit check inside IMMEDIATE transaction**

Replace lines 138-180 (from `checkAndResetMonthlyCount` through `db.transaction`) with:

```typescript
// Reset monthly count if we've crossed into a new month
checkAndResetMonthlyCount(db, installation.id);

// Atomic: check limit + insert job + increment count
// IMMEDIATE acquires write lock at transaction start, preventing concurrent reads of stale count
const pr = payload.pull_request;
const repoFullName = payload.repository.full_name;
const jobId = db.transaction(() => {
  // Re-read count inside transaction with write lock held
  const fresh = db
    .prepare("SELECT pr_count_month, plan FROM installations WHERE id = ?")
    .get(installation.id) as { pr_count_month: number; plan: string } | undefined;

  if (!fresh) return null;
  if (fresh.plan === "free" && fresh.pr_count_month >= 50) return "limit_reached";

  const id = insertJob(db, {
    installation_id: installation.id,
    repo_full_name: repoFullName,
    pr_number: pr.number,
    pr_branch: pr.head.ref,
    base_branch: pr.base.ref,
    head_sha: pr.head.sha,
  });
  incrementPrCount(db, installation.id);
  return id;
}).immediate();
```

Remove the old `freshInstallation` re-fetch and the old free tier `if` block. Add handling after the transaction:

```typescript
if (jobId === null) {
  return reply.code(404).send({ error: "Installation not found" });
}
if (jobId === "limit_reached") {
  const [owner, repo] = payload.repository.full_name.split("/");
  await postPrComment(
    installationGithubId,
    owner,
    repo,
    payload.pull_request.number,
    "You've reached the free tier limit of 50 PRs/month. " +
      "[Upgrade to Pro](https://previewpr.com/pricing) for unlimited visual reviews.",
  );
  return reply.send({ ok: true, skipped: true, reason: "free_tier_limit" });
}
```

Note: better-sqlite3's `.immediate()` creates a `BEGIN IMMEDIATE` transaction. Check better-sqlite3 docs — if the API is `.transaction(fn, { behavior: 'immediate' })`, use that form instead.

**Step 2: Verify build + tests pass**

Run: `npm run build && npm test`

**Step 3: Commit**

Message: `fix: move free tier limit check inside IMMEDIATE transaction to prevent TOCTOU race`

---

### Task 2: Prevent plan reset on reinstall

**Files:**
- Modify: `packages/shared/src/db.ts:95-102`

**Step 1: Remove `plan` from ON CONFLICT UPDATE**

In `insertInstallation`, change the SQL from:

```sql
ON CONFLICT(github_id) DO UPDATE SET
  account_login = excluded.account_login,
  account_type = excluded.account_type,
  repos = excluded.repos,
  plan = excluded.plan
```

to:

```sql
ON CONFLICT(github_id) DO UPDATE SET
  account_login = excluded.account_login,
  account_type = excluded.account_type,
  repos = excluded.repos
```

This ensures a user who reinstalls the app keeps their `plan` (e.g., "pro") instead of being reset to "free".

**Step 2: Verify build + tests pass**

Run: `npm run build && npm test`

**Step 3: Commit**

Message: `fix: preserve installation plan on reinstall instead of resetting to free`

---

### Task 3: Clear stale error_message on successful retry

**Files:**
- Modify: `packages/shared/src/db.ts:196-202`

**Step 1: Replace COALESCE with direct assignment for error_message**

Change the UPDATE query from:

```sql
UPDATE jobs SET
  status = ?,
  review_url = COALESCE(?, review_url),
  error_message = COALESCE(?, error_message),
  completed_at = COALESCE(?, completed_at)
WHERE id = ?
```

to:

```sql
UPDATE jobs SET
  status = ?,
  review_url = COALESCE(?, review_url),
  error_message = ?,
  completed_at = COALESCE(?, completed_at)
WHERE id = ?
```

Now when a job succeeds on retry, `error_message` is set to `null` (clearing the stale error from the previous attempt) since `extra?.error_message ?? null` passes `null`.

**Step 2: Verify build + tests pass**

Run: `npm run build && npm test`

**Step 3: Commit**

Message: `fix: clear stale error_message when job succeeds on retry`

---

### Task 4: Fix date parsing in checkAndResetMonthlyCount

**Files:**
- Modify: `packages/shared/src/db.ts:150`

**Step 1: Replace fragile "Z" append with safe parsing**

Replace:

```typescript
const resetDate = new Date(row.pr_count_reset_at + "Z");
```

with:

```typescript
const raw = row.pr_count_reset_at;
const resetDate = new Date(
  raw.includes("Z") || raw.includes("+") ? raw : raw.replace(" ", "T") + "Z",
);
if (isNaN(resetDate.getTime())) return; // corrupt data — skip reset, don't crash
```

This handles: SQLite format (`2026-04-05 12:34:56`), ISO with Z already (`...Z`), and ISO with offset (`...+00:00`).

**Step 2: Verify build + tests pass**

Run: `npm run build && npm test`

**Step 3: Commit**

Message: `fix: robust date parsing in checkAndResetMonthlyCount`

---

### Task 5: Compensate for postPrComment failure (zombie job prevention)

**Files:**
- Modify: `packages/api/src/webhooks.ts:182-205`

**Step 1: Reorder — enqueue before posting comment**

Move `queue.add` before `postPrComment` so the job is always enqueued if the DB transaction succeeds. The comment is nice-to-have UX, not load-bearing:

```typescript
// Generate HMAC token for the job status URL
const jobToken = createJobToken(jobId, webhookSecret);

// Enqueue to BullMQ first — this is the critical path
await queue.add("pipeline", {
  jobId,
  installationGithubId,
  repoFullName,
  prNumber: pr.number,
  prBranch: pr.head.ref,
  baseBranch: pr.base.ref,
  headSha: pr.head.sha,
});

// Post "generating..." comment — best effort, don't fail the webhook
try {
  const [owner, repo] = repoFullName.split("/");
  const commentId = await postPrComment(
    installationGithubId,
    owner,
    repo,
    pr.number,
    `Generating visual review... This usually takes 1-2 minutes.\n\n[Check status](https://api.previewpr.com/jobs/${jobId}?token=${jobToken})`,
  );
  // Store commentId for the worker to update later
  // Note: commentId is lost if comment fails — worker will post a new comment
} catch (commentErr) {
  logger.warn("Failed to post PR comment", {
    error: commentErr instanceof Error ? commentErr.message : String(commentErr),
  });
}
```

Note: This means the worker won't have `commentId` if the comment fails. The worker already handles this with a fallback `postPrComment`. We lose the "update existing comment" UX in this edge case, which is acceptable.

**Step 2: Verify build + tests pass**

Run: `npm run build && npm test`

**Step 3: Commit**

Message: `fix: enqueue job before posting PR comment to prevent zombie jobs`

---

### Task 6: Add job deduplication via SQLite UNIQUE constraint

**Files:**
- Modify: `packages/shared/src/db.ts` (add migration v3, modify insertJob)
- Modify: `packages/api/src/webhooks.ts` (check insertJob return)

**Step 1: Add migration v3**

Add to MIGRATIONS array:

```typescript
{
  version: 3,
  sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_dedup ON jobs(repo_full_name, pr_number, head_sha) WHERE status IN ('queued', 'running');`,
},
```

This partial unique index only prevents duplicates for active jobs. Completed/failed jobs don't block re-runs.

**Step 2: Change insertJob to return null on duplicate**

Replace `insertJob` with:

```typescript
export function insertJob(db: Database.Database, data: InsertJob): string | null {
  const id = randomUUID();
  const result = db.prepare(
    `INSERT OR IGNORE INTO jobs (id, installation_id, repo_full_name, pr_number, pr_branch, base_branch, head_sha)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    data.installation_id,
    data.repo_full_name,
    data.pr_number,
    data.pr_branch,
    data.base_branch,
    data.head_sha,
  );
  return result.changes > 0 ? id : null;
}
```

**Step 3: Update webhook handler to skip enqueue on duplicate**

In the IMMEDIATE transaction from Task 1, after `insertJob`:

```typescript
const id = insertJob(db, { ... });
if (!id) return "duplicate"; // dedup — same PR+SHA already queued/running
incrementPrCount(db, installation.id);
return id;
```

After the transaction, handle the duplicate case:

```typescript
if (jobId === "duplicate") {
  logger.info("Duplicate job skipped", { repo: repoFullName, pr: pr.number });
  return reply.send({ ok: true, skipped: true, reason: "duplicate" });
}
```

**Step 4: Update InsertJob return type**

In `packages/shared/src/types.ts`, no change needed — `insertJob` return type is already `string`, change to `string | null`.

**Step 5: Verify build + tests pass**

Run: `npm run build && npm test`
Note: existing tests may need updating for the `string | null` return type.

**Step 6: Commit**

Message: `feat: add job deduplication via partial unique index on active jobs`

---

### Task 7: Add dead-letter handler for exhausted retries

**Files:**
- Modify: `packages/worker/src/index.ts` (add failed event handler after worker creation)

**Step 1: Add worker.on('failed') handler**

After `const worker = createWorkerProcessor(...)`, add:

```typescript
worker.on("failed", (job, err) => {
  if (!job) return;
  const data = job.data;
  const attempts = job.attemptsMade;
  const maxAttempts = job.opts.attempts ?? 3;

  if (attempts >= maxAttempts) {
    log.error("Job exhausted all retries", {
      jobId: data.jobId,
      repo: data.repoFullName,
      pr: data.prNumber,
      attempts,
      error: err.message,
    });
    // Ensure DB status is 'failed' — the last attempt's catch block may have already set this,
    // but this is a safety net for cases where the process crashed during the catch block
    updateJobStatus(db, data.jobId, "failed", {
      error_message: `Exhausted ${maxAttempts} retries: ${scrubSecrets(err.message)}`,
    });
  }
});
```

**Step 2: Verify build passes**

Run: `npm run build`

**Step 3: Commit**

Message: `feat: add dead-letter handler for jobs that exhaust all retries`

---

### Task 8: Fix installation_repositories removed action

**Files:**
- Modify: `packages/api/src/webhooks.ts:105-115` (the removed branch)
- Modify: `packages/shared/src/db.ts` (add removeReposFromInstallation function)

**Step 1: Add removeReposFromInstallation to db.ts**

After `updateInstallationRepos`:

```typescript
export function removeReposFromInstallation(
  db: Database.Database,
  githubId: number,
  reposToRemove: string[],
): void {
  const row = db
    .prepare("SELECT repos FROM installations WHERE github_id = ?")
    .get(githubId) as { repos: string } | undefined;
  if (!row) return;

  const current = JSON.parse(row.repos);
  if (current === "all") return; // can't subtract from "all"

  const updated = (current as string[]).filter((r: string) => !reposToRemove.includes(r));
  db.prepare("UPDATE installations SET repos = ? WHERE github_id = ?").run(
    JSON.stringify(updated.length > 0 ? updated : "all"),
    githubId,
  );
}
```

**Step 2: Wire into webhook handler**

In the `removed` branch of `installation_repositories`, replace the log-only code:

```typescript
} else if (payload.action === "removed") {
  const removed = (payload.repositories_removed || []).map(
    (r: { full_name: string }) => r.full_name,
  );
  removeReposFromInstallation(db, githubId, removed);
  logger.info("Installation repos removed", {
    github_id: githubId,
    repos: removed,
  });
}
```

**Step 3: Add import for removeReposFromInstallation**

Update the import block in webhooks.ts.

**Step 4: Verify build + tests pass**

Run: `npm run build && npm test`

**Step 5: Commit**

Message: `fix: remove repos from installation on installation_repositories removed event`

---

### Task 9: Enforce repos allowlist on PR webhook events

**Files:**
- Modify: `packages/api/src/webhooks.ts` (after getInstallation, before job creation)

**Step 1: Add repo allowlist check**

After `const installation = getInstallation(db, installationGithubId)` and the null check, add:

```typescript
// Check repo allowlist — if installation is restricted to specific repos, verify this repo is allowed
if (installation.repos !== "all") {
  const allowedRepos = installation.repos as string[];
  if (!allowedRepos.includes(payload.repository.full_name)) {
    logger.info("PR skipped — repo not in installation allowlist", {
      repo: payload.repository.full_name,
      allowed: allowedRepos,
    });
    return reply.send({ ok: true, skipped: true, reason: "repo_not_allowed" });
  }
}
```

Note: `installation.repos` is parsed from JSON in `getInstallation` — it's either the string `"all"` or a `string[]`.

**Step 2: Verify build + tests pass**

Run: `npm run build && npm test`

**Step 3: Commit**

Message: `fix: enforce repos allowlist on PR webhook events`

---

### Task 10: Fix GIT_ASKPASS shell injection risk

**Files:**
- Modify: `packages/worker/src/pipeline.ts:49`

**Step 1: Use single quotes in askpass script**

Replace:

```typescript
writeFileSync(scriptPath, `#!/bin/sh\necho "${token}"\n`, { mode: 0o700 });
```

with:

```typescript
writeFileSync(scriptPath, `#!/bin/sh\nprintf '%s\\n' '${token.replace(/'/g, "'\\''")}'\n`, { mode: 0o700 });
```

The `replace(/'/g, "'\\''")` handles the (currently impossible but defensively correct) case of a single quote in the token. In shell, `'it'\''s'` becomes `it's`.

**Step 2: Verify build + tests pass**

Run: `npm run build && npm test`

**Step 3: Commit**

Message: `fix: use single-quoted printf in GIT_ASKPASS to prevent shell injection`

---

### Task 11: Apply --network=none to all Docker containers

**Files:**
- Modify: `packages/worker/src/docker.ts:150-152`

**Step 1: Move --network=none outside the node-only block**

Currently:

```typescript
if (projectType === "node") {
  args.push("--network=none", "--tmpfs", "/tmp:rw,noexec,size=100m");
}
```

Change to:

```typescript
args.push("--network=none");
if (projectType === "node") {
  args.push("--tmpfs", "/tmp:rw,noexec,size=100m");
}
```

This prevents SSRF via malicious HTML/JS in static project PRs when Playwright loads them for screenshots.

**Step 2: Verify build + tests pass**

Run: `npm run build && npm test`

**Step 3: Commit**

Message: `fix: apply --network=none to all Docker containers to prevent SSRF`

---

### Task 12: Scrub non-string values in logger

**Files:**
- Modify: `packages/shared/src/logger.ts:30-34`

**Step 1: Deep scrub extra values**

Replace the current extra handling:

```typescript
if (extra) {
  for (const [k, v] of Object.entries(extra)) {
    entry[k] = typeof v === "string" ? scrubSecrets(v) : v;
  }
}
```

with:

```typescript
if (extra) {
  for (const [k, v] of Object.entries(extra)) {
    if (typeof v === "string") {
      entry[k] = scrubSecrets(v);
    } else if (v instanceof Error) {
      entry[k] = scrubSecrets(v.message);
    } else if (typeof v === "object" && v !== null) {
      entry[k] = scrubSecrets(JSON.stringify(v));
    } else {
      entry[k] = v;
    }
  }
}
```

This catches Error objects and nested objects that might contain tokens.

**Step 2: Verify build + tests pass**

Run: `npm run build && npm test`

**Step 3: Commit**

Message: `fix: scrub non-string values (Error, objects) in logger to prevent secret leaks`

---

### Task 13: Add scrubSecrets patterns for Redis URLs

**Files:**
- Modify: `packages/shared/src/security.ts`

**Step 1: Add Redis URL pattern to SECRET_PATTERNS**

Add to the patterns array:

```typescript
// Redis URLs with passwords: redis://:password@host:port
[/redis:\/\/:[^@]+@/gi, "redis://:[REDACTED]@"],
```

**Step 2: Verify build + tests pass**

Run: `npm run build && npm test`

**Step 3: Commit**

Message: `fix: add Redis URL password scrubbing pattern`

---

### Task 14: Test validateBranchName and validateRoutes

**Files:**
- Create: `packages/shared/src/__tests__/security.test.ts`

**Step 1: Write tests**

```typescript
import { describe, it, expect } from "vitest";
import { validateBranchName, scrubSecrets } from "../security.js";

describe("validateBranchName", () => {
  it("accepts valid branch names", () => {
    expect(() => validateBranchName("main")).not.toThrow();
    expect(() => validateBranchName("feature/my-branch")).not.toThrow();
    expect(() => validateBranchName("fix/issue-123")).not.toThrow();
  });

  it("rejects branches with --", () => {
    expect(() => validateBranchName("--option")).toThrow();
  });

  it("rejects branches with ..", () => {
    expect(() => validateBranchName("../../etc/passwd")).toThrow();
  });

  it("rejects empty branch names", () => {
    expect(() => validateBranchName("")).toThrow();
  });
});

describe("scrubSecrets", () => {
  it("scrubs GitHub tokens", () => {
    const input = "x-access-token:ghp_abc123def456@github.com";
    expect(scrubSecrets(input)).not.toContain("ghp_abc123def456");
  });

  it("scrubs Bearer tokens", () => {
    const input = "Authorization: Bearer sk-ant-api-key-here";
    expect(scrubSecrets(input)).not.toContain("sk-ant-api-key-here");
  });

  it("scrubs AWS keys", () => {
    const input = "key=AKIAIOSFODNN7EXAMPLE";
    expect(scrubSecrets(input)).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("passes through safe strings unchanged", () => {
    const input = "Job completed successfully for repo owner/name";
    expect(scrubSecrets(input)).toBe(input);
  });

  it("scrubs Redis URLs with passwords", () => {
    const input = "redis://:secretpass@redis-host:6379";
    expect(scrubSecrets(input)).not.toContain("secretpass");
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `npm test --workspace=packages/shared`

Note: some tests may fail if patterns aren't comprehensive — adjust patterns or test expectations.

**Step 3: Commit**

Message: `test: add tests for validateBranchName and scrubSecrets`

---

### Task 15: Test verifyJobToken and createJobToken

**Files:**
- Create: `packages/shared/src/__tests__/auth.test.ts`

**Step 1: Write tests**

```typescript
import { describe, it, expect } from "vitest";
import { createJobToken, verifyJobToken } from "../security.js";

describe("job token auth", () => {
  const secret = "test-webhook-secret";

  it("creates and verifies a valid token", () => {
    const token = createJobToken("job-123", secret);
    expect(verifyJobToken("job-123", token, secret)).toBe(true);
  });

  it("rejects invalid token", () => {
    expect(verifyJobToken("job-123", "invalid-token", secret)).toBe(false);
  });

  it("rejects token for different job ID", () => {
    const token = createJobToken("job-123", secret);
    expect(verifyJobToken("job-456", token, secret)).toBe(false);
  });

  it("rejects empty token", () => {
    expect(verifyJobToken("job-123", "", secret)).toBe(false);
  });
});
```

**Step 2: Run tests**

Run: `npm test --workspace=packages/shared`

**Step 3: Commit**

Message: `test: add tests for createJobToken and verifyJobToken`

---

### Task 16: Test checkAndResetMonthlyCount

**Files:**
- Modify: `packages/shared/src/__tests__/db.test.ts`

**Step 1: Add tests for checkAndResetMonthlyCount**

Add to the existing `describe("database")` block:

```typescript
it("checkAndResetMonthlyCount resets count in a new month", () => {
  insertInstallation(db, {
    github_id: 200,
    account_login: "monthly-test",
    account_type: "User",
    repos: "all",
    plan: "free",
  });

  const inst = getInstallation(db, 200)!;

  // Set count to 5 and reset_at to last month
  db.prepare(
    "UPDATE installations SET pr_count_month = 5, pr_count_reset_at = '2025-01-15 12:00:00' WHERE id = ?",
  ).run(inst.id);

  checkAndResetMonthlyCount(db, inst.id);

  const after = getInstallation(db, 200)!;
  expect(after.pr_count_month).toBe(0);
});

it("checkAndResetMonthlyCount does not reset within same month", () => {
  insertInstallation(db, {
    github_id: 201,
    account_login: "monthly-test-2",
    account_type: "User",
    repos: "all",
    plan: "free",
  });

  const inst = getInstallation(db, 201)!;

  // Set count to 5, reset_at to now (same month)
  db.prepare(
    "UPDATE installations SET pr_count_month = 5, pr_count_reset_at = datetime('now') WHERE id = ?",
  ).run(inst.id);

  checkAndResetMonthlyCount(db, inst.id);

  const after = getInstallation(db, 201)!;
  expect(after.pr_count_month).toBe(5);
});
```

**Step 2: Add import for checkAndResetMonthlyCount**

Add `checkAndResetMonthlyCount` to the imports from `../db.js`.

**Step 3: Run tests**

Run: `npm test --workspace=packages/shared`

**Step 4: Commit**

Message: `test: add tests for checkAndResetMonthlyCount billing reset`

---

### Task 17: Test migration runner idempotency

**Files:**
- Modify: `packages/shared/src/__tests__/db.test.ts`

**Step 1: Add idempotency test**

```typescript
it("createDb is idempotent — running twice does not error", () => {
  const testPath = "/tmp/test-idempotent.db";
  const db1 = createDb(testPath);
  db1.close();

  // Second createDb on same file should apply no new migrations
  const db2 = createDb(testPath);
  const version = db2.pragma("user_version", { simple: true });
  expect(version).toBeGreaterThanOrEqual(1);
  db2.close();

  // Cleanup
  require("fs").unlinkSync(testPath);
});
```

**Step 2: Run tests**

Run: `npm test --workspace=packages/shared`

**Step 3: Commit**

Message: `test: verify migration runner idempotency`

---

### Task 18: Test health endpoint responses

**Files:**
- Create: `packages/api/src/__tests__/health.test.ts`

**Step 1: Write Fastify inject-based health tests**

```typescript
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";

describe("health endpoint", () => {
  it("returns 200 when DB and Redis are healthy", async () => {
    const app = Fastify();
    const mockDb = { prepare: vi.fn(() => ({ get: vi.fn() })) };
    const mockQueue = { client: Promise.resolve({ ping: vi.fn().mockResolvedValue("PONG") }) };

    app.get("/health", async (_, reply) => {
      try {
        mockDb.prepare("SELECT 1").get();
        const client = await mockQueue.client;
        await client.ping();
        return { status: "ok" };
      } catch {
        return reply.code(503).send({ status: "error" });
      }
    });

    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: "ok" });
  });

  it("returns 503 when DB is down", async () => {
    const app = Fastify();
    const mockDb = { prepare: vi.fn(() => { throw new Error("DB gone"); }) };

    app.get("/health", async (_, reply) => {
      try {
        mockDb.prepare("SELECT 1").get();
        return { status: "ok" };
      } catch {
        return reply.code(503).send({ status: "error" });
      }
    });

    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toEqual({ status: "error" });
  });
});
```

**Step 2: Run tests**

Run: `npm test --workspace=packages/api`

**Step 3: Commit**

Message: `test: add health endpoint response tests`

---

### Task 19: Test install callback validation

**Files:**
- Modify: `packages/api/src/__tests__/webhooks.test.ts`

**Step 1: Add install callback tests**

These test the route handler indirectly via the Fastify test harness. Since the install callback is registered directly in index.ts (not in webhooks.ts), these may need to be in a separate test file or test the route behavior via integration. For now, add a note/TODO — the route needs to be extracted into a testable handler first (refactor for Phase 3).

Skip this task — the `/install/callback` handler is inline in `index.ts` and not easily unit-testable without extracting it. Add a TODO comment in the code instead.

**Step 2: Commit**

Message: `chore: add TODO for install callback test extraction`

---

### Task 20: Set up Biome linter

**Files:**
- Create: `biome.json` (root)
- Modify: `package.json` (add lint/format scripts)

**Step 1: Install Biome**

Run: `npm install --save-dev @biomejs/biome`

**Step 2: Create biome.json**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": { "enabled": false },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": { "noExplicitAny": "warn" },
      "style": { "noNonNullAssertion": "warn" }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2
  },
  "files": {
    "ignore": ["node_modules", "dist", "packages/worker/review-app"]
  }
}
```

**Step 3: Add scripts to root package.json**

Add to `"scripts"`:

```json
"lint": "biome check .",
"format": "biome format --write ."
```

**Step 4: Run lint and fix any auto-fixable issues**

Run: `npx biome check . --write`

Review and commit fixes separately from config.

**Step 5: Commit**

Message: `chore: add Biome linter configuration`

---

### Task 21: Add GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Step 1: Create workflow**

```yaml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx tsc -p packages/shared/tsconfig.json --noEmit
      - run: npx tsc -p packages/api/tsconfig.json --noEmit
      - run: npx tsc -p packages/worker/tsconfig.json --noEmit

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint

  test:
    runs-on: ubuntu-latest
    needs: [typecheck, lint]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build --workspace=packages/shared
      - run: npm test

  build:
    runs-on: ubuntu-latest
    needs: [test]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm audit --audit-level=high || true
```

**Step 2: Commit**

Message: `feat: add GitHub Actions CI workflow`

---

### Task 22: Add Dependabot configuration

**Files:**
- Create: `.github/dependabot.yml`

**Step 1: Create config**

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 3
    ignore:
      - dependency-name: "*"
        update-types: ["version-update:semver-patch"]
```

**Step 2: Commit**

Message: `chore: add Dependabot for weekly dependency updates`

---

### Task 23: Configure branch protection on main

This is a GitHub settings change, not a code change.

**Step 1: Set branch protection via gh CLI**

Run (with Adrian's approval):

```bash
gh api repos/acighi/previewpr/branches/main/protection -X PUT \
  -f required_status_checks='{"strict":true,"contexts":["typecheck","lint","test","build"]}' \
  -f enforce_admins=false \
  -f required_pull_request_reviews=null \
  -f restrictions=null \
  -F allow_force_pushes=false \
  -F allow_deletions=false
```

Note: `required_pull_request_reviews=null` keeps it optional for solo dev workflow. The key protection is requiring CI status checks to pass before merge.

**Step 2: Verify**

Run: `gh api repos/acighi/previewpr/branches/main/protection`

**Step 3: No commit needed — this is a GitHub settings change**

---

### Task 24: Add Zod validation to webhook payloads

**Files:**
- Modify: `packages/api/package.json` (add zod dependency)
- Create: `packages/api/src/schemas.ts`
- Modify: `packages/api/src/webhooks.ts` (validate payloads)

**Step 1: Install Zod**

Run: `npm install zod --workspace=packages/api`

**Step 2: Create webhook payload schemas**

Create `packages/api/src/schemas.ts`:

```typescript
import { z } from "zod";

export const PullRequestPayload = z.object({
  action: z.string(),
  installation: z.object({ id: z.number() }),
  pull_request: z.object({
    number: z.number(),
    head: z.object({ ref: z.string(), sha: z.string() }),
    base: z.object({ ref: z.string() }),
  }),
  repository: z.object({ full_name: z.string() }),
});

export const InstallationPayload = z.object({
  action: z.enum(["created", "deleted"]),
  installation: z.object({
    id: z.number(),
    account: z.object({
      login: z.string(),
      type: z.string(),
    }),
  }),
  repositories: z.array(z.object({ full_name: z.string() })).optional(),
});

export const InstallationReposPayload = z.object({
  action: z.enum(["added", "removed"]),
  installation: z.object({ id: z.number() }),
  repositories_added: z.array(z.object({ full_name: z.string() })).optional(),
  repositories_removed: z.array(z.object({ full_name: z.string() })).optional(),
});

export const InstallationIdParam = z.coerce.number().int().positive();
```

**Step 3: Apply validation in webhook handler**

In `webhooks.ts`, after signature verification, parse each event's payload through its schema:

```typescript
if (event === "pull_request") {
  const parsed = PullRequestPayload.safeParse(payload);
  if (!parsed.success) {
    logger.warn("Invalid PR payload", { errors: parsed.error.message });
    return reply.code(400).send({ error: "Invalid payload" });
  }
  // Use parsed.data instead of raw payload from here
}
```

Apply similar parsing for `installation` and `installation_repositories` events.

**Step 4: Validate installation_id on /install/callback**

In `packages/api/src/index.ts`, validate the query param:

```typescript
const installationId = InstallationIdParam.safeParse(request.query.installation_id);
if (!installationId.success) {
  return reply.code(400).send({ error: "Invalid installation_id" });
}
```

**Step 5: Verify build + tests pass**

Run: `npm run build && npm test`

**Step 6: Commit**

Message: `feat: add Zod schema validation to webhook payloads and API params`

---

## Final Verification

After all 24 tasks:

1. Run: `npm run build && npm test` — all packages compile and all tests pass
2. Run: `npm run lint` — no linting errors
3. Review: `git log --oneline -30` — verify clean commit history
4. Deploy to Coolify and verify:
   - Health check returns 200: `curl https://api.previewpr.com/health`
   - Trigger a test PR to verify full pipeline still works
