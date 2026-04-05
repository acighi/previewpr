import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

// Module-level mocks (hoisted by vitest)
const mockGetInstallation = vi.fn();
const mockInsertJob = vi.fn();
const mockIncrementPrCount = vi.fn();
const mockCheckAndResetMonthlyCount = vi.fn();
const mockInsertInstallation = vi.fn();
const mockRemoveInstallation = vi.fn();
const mockUpdateInstallationRepos = vi.fn();

vi.mock("@previewpr/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@previewpr/shared")>();
  return {
    ...actual,
    getInstallation: (...args: unknown[]) => mockGetInstallation(...args),
    insertJob: (...args: unknown[]) => mockInsertJob(...args),
    incrementPrCount: (...args: unknown[]) => mockIncrementPrCount(...args),
    checkAndResetMonthlyCount: (...args: unknown[]) =>
      mockCheckAndResetMonthlyCount(...args),
    insertInstallation: (...args: unknown[]) => mockInsertInstallation(...args),
    removeInstallation: (...args: unknown[]) => mockRemoveInstallation(...args),
    updateInstallationRepos: (...args: unknown[]) =>
      mockUpdateInstallationRepos(...args),
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

import { verifyWebhookSignature, createWebhookHandler } from "../webhooks.js";

function sign(body: string, secret: string): string {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(body);
  return "sha256=" + hmac.digest("hex");
}

describe("verifyWebhookSignature", () => {
  const secret = "test-secret";
  const body = '{"action":"opened"}';

  it("accepts a valid HMAC-SHA256 signature", () => {
    const signature = sign(body, secret);
    expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    expect(verifyWebhookSignature(body, "sha256=deadbeef0000", secret)).toBe(
      false,
    );
  });

  it("rejects an empty signature", () => {
    expect(verifyWebhookSignature(body, "", secret)).toBe(false);
  });
});

function createMockDeps() {
  return {
    db: { transaction: (fn: Function) => fn } as any,
    queue: { add: vi.fn().mockResolvedValue(undefined) } as any,
    webhookSecret: "test-secret",
    postPrComment: vi.fn().mockResolvedValue(12345),
  };
}

function createMockRequest(
  event: string,
  body: Record<string, unknown>,
  secret: string,
) {
  const rawBody = JSON.stringify(body);
  return {
    headers: {
      "x-github-event": event,
      "x-hub-signature-256": sign(rawBody, secret),
    },
    body: body,
    rawBody: rawBody,
  };
}

function createMockReply() {
  let statusCode = 200;
  let sentBody: unknown;
  const reply = {
    code(c: number) {
      statusCode = c;
      return reply;
    },
    send(body: unknown) {
      sentBody = body;
      return reply;
    },
    get statusCode() {
      return statusCode;
    },
    get sentBody() {
      return sentBody;
    },
  };
  return reply;
}

describe("createWebhookHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 for bad signature", async () => {
    const deps = createMockDeps();
    const handler = createWebhookHandler(deps);
    const rawBody = '{"action":"opened"}';
    const req = {
      headers: {
        "x-github-event": "ping",
        "x-hub-signature-256": "sha256=invalid",
      },
      body: { action: "opened" },
      rawBody,
    };
    const reply = createMockReply();

    await handler(req as any, reply as any);

    expect(reply.statusCode).toBe(401);
  });

  it("skips non-pull_request events", async () => {
    const deps = createMockDeps();
    const handler = createWebhookHandler(deps);
    const body = { action: "created" };
    const req = createMockRequest("ping", body, deps.webhookSecret);
    const reply = createMockReply();

    await handler(req as any, reply as any);

    expect(reply.statusCode).toBe(200);
    expect(reply.sentBody).toEqual({ ok: true, skipped: true });
  });

  it("creates job for valid PR event", async () => {
    const deps = createMockDeps();
    const mockInstallation = {
      id: 1,
      github_id: 12345,
      account_login: "testuser",
      account_type: "User",
      repos: "all",
      plan: "pro",
      pr_count_month: 0,
      created_at: "2026-01-01",
    };

    mockGetInstallation.mockReturnValue(mockInstallation);
    mockInsertJob.mockReturnValue("job-uuid-123");

    const handler = createWebhookHandler(deps);

    const prBody = {
      action: "opened",
      installation: { id: 12345 },
      pull_request: {
        number: 42,
        head: { ref: "feature-branch", sha: "abc123" },
        base: { ref: "main" },
      },
      repository: { full_name: "testuser/testrepo" },
    };
    const req = createMockRequest("pull_request", prBody, deps.webhookSecret);
    const reply = createMockReply();

    await handler(req as any, reply as any);

    expect(reply.statusCode).toBe(200);
    expect(mockGetInstallation).toHaveBeenCalledWith(deps.db, 12345);
    expect(mockInsertJob).toHaveBeenCalledWith(deps.db, {
      installation_id: 1,
      repo_full_name: "testuser/testrepo",
      pr_number: 42,
      pr_branch: "feature-branch",
      base_branch: "main",
      head_sha: "abc123",
    });
    expect(mockIncrementPrCount).toHaveBeenCalledWith(deps.db, 1);
    expect(deps.queue.add).toHaveBeenCalled();
    expect(deps.postPrComment).toHaveBeenCalled();
    expect((reply.sentBody as any).jobId).toBe("job-uuid-123");
  });
});
