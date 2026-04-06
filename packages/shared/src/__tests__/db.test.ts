import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  createDb,
  insertInstallation,
  getInstallation,
  incrementPrCount,
  resetMonthlyCounts,
  insertJob,
  getJob,
  updateJobStatus,
  insertReview,
  removeInstallation,
  updateInstallationRepos,
} from "../db.js";

describe("database", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb(":memory:");
  });

  it("createDb creates all 3 tables", () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("installations");
    expect(names).toContain("jobs");
    expect(names).toContain("reviews");
  });

  it("insertInstallation + getInstallation round-trip", () => {
    insertInstallation(db, {
      github_id: 12345,
      account_login: "testorg",
      account_type: "Organization",
      repos: ["repo-a", "repo-b"],
      plan: "free",
    });

    const inst = getInstallation(db, 12345);
    expect(inst).not.toBeNull();
    expect(inst!.github_id).toBe(12345);
    expect(inst!.account_login).toBe("testorg");
    expect(inst!.account_type).toBe("Organization");
    expect(inst!.repos).toEqual(["repo-a", "repo-b"]);
    expect(inst!.plan).toBe("free");
    expect(inst!.pr_count_month).toBe(0);
  });

  it("insertInstallation upserts on conflict (update account_login)", () => {
    insertInstallation(db, {
      github_id: 12345,
      account_login: "oldname",
      account_type: "User",
      repos: "all",
      plan: "free",
    });

    insertInstallation(db, {
      github_id: 12345,
      account_login: "newname",
      account_type: "User",
      repos: "all",
      plan: "pro",
    });

    const inst = getInstallation(db, 12345);
    expect(inst!.account_login).toBe("newname");
    expect(inst!.plan).toBe("free"); // plan is preserved on reinstall, not overwritten
  });

  it("insertJob + getJob round-trip (verify status is queued)", () => {
    insertInstallation(db, {
      github_id: 1,
      account_login: "test",
      account_type: "User",
      repos: "all",
      plan: "free",
    });

    const inst = getInstallation(db, 1);
    const jobId = insertJob(db, {
      installation_id: inst!.id,
      repo_full_name: "test/repo",
      pr_number: 42,
      pr_branch: "feature/cool",
      base_branch: "main",
      head_sha: "abc123",
    });

    expect(jobId).not.toBeNull();
    expect(typeof jobId).toBe("string");
    expect(jobId!.length).toBeGreaterThan(0);

    const job = getJob(db, jobId!);
    expect(job).not.toBeNull();
    expect(job!.status).toBe("queued");
    expect(job!.repo_full_name).toBe("test/repo");
    expect(job!.pr_number).toBe(42);
    expect(job!.review_url).toBeNull();
    expect(job!.error_message).toBeNull();
  });

  it("updateJobStatus changes status", () => {
    insertInstallation(db, {
      github_id: 1,
      account_login: "test",
      account_type: "User",
      repos: "all",
      plan: "free",
    });
    const inst = getInstallation(db, 1);
    const jobId = insertJob(db, {
      installation_id: inst!.id,
      repo_full_name: "test/repo",
      pr_number: 1,
      pr_branch: "feat",
      base_branch: "main",
      head_sha: "def456",
    });

    updateJobStatus(db, jobId!, "running");
    const job = getJob(db, jobId!);
    expect(job!.status).toBe("running");
  });

  it("updateJobStatus sets completed_at for terminal states", () => {
    insertInstallation(db, {
      github_id: 1,
      account_login: "test",
      account_type: "User",
      repos: "all",
      plan: "free",
    });
    const inst = getInstallation(db, 1);
    const jobId = insertJob(db, {
      installation_id: inst!.id,
      repo_full_name: "test/repo",
      pr_number: 1,
      pr_branch: "feat",
      base_branch: "main",
      head_sha: "ghi789",
    });

    updateJobStatus(db, jobId!, "completed", {
      review_url: "https://review.example.com/123",
    });

    const job = getJob(db, jobId!);
    expect(job!.status).toBe("completed");
    expect(job!.completed_at).not.toBeNull();
    expect(job!.review_url).toBe("https://review.example.com/123");
  });

  it("insertReview creates review record", () => {
    insertInstallation(db, {
      github_id: 1,
      account_login: "test",
      account_type: "User",
      repos: "all",
      plan: "free",
    });
    const inst = getInstallation(db, 1);
    const jobId = insertJob(db, {
      installation_id: inst!.id,
      repo_full_name: "test/repo",
      pr_number: 1,
      pr_branch: "feat",
      base_branch: "main",
      head_sha: "jkl012",
    });

    const reviewId = insertReview(db, {
      job_id: jobId!,
      reviewer_github: "reviewer1",
      decisions: [
        { change_id: "c1", status: "approved" },
        { change_id: "c2", status: "rejected", reason: "Too risky" },
      ],
    });

    expect(typeof reviewId).toBe("number");
    expect(reviewId).toBeGreaterThan(0);
  });

  it("incrementPrCount increments counter", () => {
    insertInstallation(db, {
      github_id: 1,
      account_login: "test",
      account_type: "User",
      repos: "all",
      plan: "free",
    });
    const inst = getInstallation(db, 1);

    incrementPrCount(db, inst!.id);
    incrementPrCount(db, inst!.id);

    const updated = getInstallation(db, 1);
    expect(updated!.pr_count_month).toBe(2);
  });

  it("removeInstallation soft-deletes (sets plan to removed)", () => {
    insertInstallation(db, {
      github_id: 99,
      account_login: "deleteme",
      account_type: "User",
      repos: "all",
      plan: "pro",
    });

    removeInstallation(db, 99);

    // getInstallation now filters out soft-deleted installations
    const inst = getInstallation(db, 99);
    expect(inst).toBeNull();

    // Verify the row still exists with plan='removed' via raw query
    const row = db
      .prepare("SELECT plan FROM installations WHERE github_id = ?")
      .get(99) as { plan: string };
    expect(row.plan).toBe("removed");
  });

  it("updateInstallationRepos updates repos JSON", () => {
    insertInstallation(db, {
      github_id: 50,
      account_login: "repotest",
      account_type: "Organization",
      repos: ["old-repo"],
      plan: "free",
    });

    updateInstallationRepos(db, 50, ["new-repo-a", "new-repo-b"]);

    const inst = getInstallation(db, 50);
    expect(inst!.repos).toEqual(["new-repo-a", "new-repo-b"]);
  });
});
