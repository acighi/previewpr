// Installation
export interface Installation {
  id: number;
  github_id: number;
  account_login: string;
  account_type: "Organization" | "User";
  repos: string[] | "all";
  plan: "free" | "pro" | "team";
  pr_count_month: number;
  created_at: string;
}

export interface InsertInstallation {
  github_id: number;
  account_login: string;
  account_type: string;
  repos: string[] | "all";
  plan: string;
}

// Job
export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface Job {
  id: string;
  installation_id: number;
  repo_full_name: string;
  pr_number: number;
  pr_branch: string;
  base_branch: string;
  head_sha: string;
  status: JobStatus;
  review_url: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface InsertJob {
  installation_id: number;
  repo_full_name: string;
  pr_number: number;
  pr_branch: string;
  base_branch: string;
  head_sha: string;
}

// Review
export interface ReviewDecision {
  change_id: string;
  status: "approved" | "rejected";
  reason?: string;
}

export interface Review {
  id: number;
  job_id: string;
  reviewer_github: string;
  decisions: ReviewDecision[];
  submitted_at: string;
}

export interface InsertReview {
  job_id: string;
  reviewer_github: string;
  decisions: ReviewDecision[];
}

// Change Unit (from prototype)
export interface ChangeUnit {
  id: string;
  category: "frontend" | "backend" | "shared";
  title: string;
  files: string[];
  diff: string;
  commit_messages: string[];
  estimated_impact: string;
  explanation?: string;
  risk_notes?: string | null;
}

export interface AnalysisOutput {
  head_sha: string;
  changes: ChangeUnit[];
}

// Queue
export interface PipelineJobData {
  jobId: string;
  installationGithubId: number;
  repoFullName: string;
  prNumber: number;
  prBranch: string;
  baseBranch: string;
  headSha: string;
  commentId?: number;
}
