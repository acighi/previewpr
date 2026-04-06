import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  Installation,
  InsertInstallation,
  Job,
  InsertJob,
  InsertReview,
  JobStatus,
} from "./types.js";

interface Migration {
  version: number;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS installations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        github_id INTEGER UNIQUE NOT NULL,
        account_login TEXT NOT NULL,
        account_type TEXT NOT NULL,
        repos TEXT NOT NULL DEFAULT '"all"',
        plan TEXT NOT NULL DEFAULT 'free',
        pr_count_month INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        installation_id INTEGER NOT NULL,
        repo_full_name TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        pr_branch TEXT NOT NULL,
        base_branch TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        review_url TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        FOREIGN KEY (installation_id) REFERENCES installations(id)
      );

      CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        reviewer_github TEXT NOT NULL,
        decisions TEXT NOT NULL,
        submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (job_id) REFERENCES jobs(id)
      );
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE installations ADD COLUMN pr_count_reset_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00';
      UPDATE installations SET pr_count_reset_at = datetime('now') WHERE pr_count_reset_at = '1970-01-01 00:00:00';
    `,
  },
];

function runMigrations(db: Database.Database): void {
  const currentVersion = db.pragma("user_version", { simple: true }) as number;

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      db.transaction(() => {
        db.exec(migration.sql);
        db.pragma(`user_version = ${migration.version}`);
      })();
    }
  }
}

export function createDb(path: string): Database.Database {
  const db = new Database(path);
  if (path !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }
  db.pragma("busy_timeout = 5000");
  runMigrations(db);
  return db;
}

export function insertInstallation(
  db: Database.Database,
  data: InsertInstallation,
): void {
  const reposJson = JSON.stringify(data.repos);
  db.prepare(
    `INSERT INTO installations (github_id, account_login, account_type, repos, plan)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(github_id) DO UPDATE SET
       account_login = excluded.account_login,
       account_type = excluded.account_type,
       repos = excluded.repos,
       plan = excluded.plan`,
  ).run(
    data.github_id,
    data.account_login,
    data.account_type,
    reposJson,
    data.plan,
  );
}

export function getInstallation(
  db: Database.Database,
  githubId: number,
): Installation | null {
  const row = db
    .prepare(
      "SELECT * FROM installations WHERE github_id = ? AND plan != 'removed'",
    )
    .get(githubId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ...row,
    repos: JSON.parse(row.repos as string),
  } as Installation;
}

export function incrementPrCount(
  db: Database.Database,
  installationId: number,
): void {
  db.prepare(
    "UPDATE installations SET pr_count_month = pr_count_month + 1 WHERE id = ?",
  ).run(installationId);
}

export function resetMonthlyCounts(db: Database.Database): void {
  db.prepare("UPDATE installations SET pr_count_month = 0").run();
}

export function checkAndResetMonthlyCount(
  db: Database.Database,
  installationId: number,
): void {
  const row = db
    .prepare("SELECT pr_count_reset_at FROM installations WHERE id = ?")
    .get(installationId) as { pr_count_reset_at: string } | undefined;
  if (!row) return;

  const resetDate = new Date(row.pr_count_reset_at + "Z");
  const now = new Date();
  if (
    now.getUTCMonth() !== resetDate.getUTCMonth() ||
    now.getUTCFullYear() !== resetDate.getUTCFullYear()
  ) {
    db.prepare(
      "UPDATE installations SET pr_count_month = 0, pr_count_reset_at = datetime('now') WHERE id = ?",
    ).run(installationId);
  }
}

export function insertJob(db: Database.Database, data: InsertJob): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO jobs (id, installation_id, repo_full_name, pr_number, pr_branch, base_branch, head_sha)
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
  return id;
}

export function getJob(db: Database.Database, jobId: string): Job | null {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return row as unknown as Job;
}

export function updateJobStatus(
  db: Database.Database,
  jobId: string,
  status: JobStatus,
  extra?: { review_url?: string; error_message?: string },
): void {
  const isTerminal = status === "completed" || status === "failed";
  const completedAt = isTerminal ? new Date().toISOString() : null;

  db.prepare(
    `UPDATE jobs SET
       status = ?,
       review_url = COALESCE(?, review_url),
       error_message = COALESCE(?, error_message),
       completed_at = COALESCE(?, completed_at)
     WHERE id = ?`,
  ).run(
    status,
    extra?.review_url ?? null,
    extra?.error_message ?? null,
    completedAt,
    jobId,
  );
}

export function insertReview(
  db: Database.Database,
  data: InsertReview,
): number {
  const result = db
    .prepare(
      `INSERT INTO reviews (job_id, reviewer_github, decisions)
       VALUES (?, ?, ?)`,
    )
    .run(data.job_id, data.reviewer_github, JSON.stringify(data.decisions));
  return Number(result.lastInsertRowid);
}

export function removeInstallation(
  db: Database.Database,
  githubId: number,
): void {
  db.prepare(
    "UPDATE installations SET plan = 'removed' WHERE github_id = ?",
  ).run(githubId);
}

export function updateInstallationRepos(
  db: Database.Database,
  githubId: number,
  repos: string[] | "all",
): void {
  db.prepare("UPDATE installations SET repos = ? WHERE github_id = ?").run(
    JSON.stringify(repos),
    githubId,
  );
}
