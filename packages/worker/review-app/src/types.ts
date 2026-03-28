export interface ChangeUnit {
  id: string;
  category: "frontend" | "backend" | "shared";
  title: string;
  files: string[];
  diff: string;
  commit_messages: string[];
  estimated_impact: "visual" | "behavioral" | "data" | "config";
  explanation: string;
  risk_notes: string | null;
}

export interface CaptureEntry {
  route: string;
  before?: string;
  after?: string;
  diff?: string;
}

export interface ScreenshotData {
  [changeId: string]: {
    affected_routes: string[];
    captures: CaptureEntry[];
  };
}

export interface ReviewDecision {
  changeId: string;
  status: "approved" | "rejected" | "pending";
  reason?: string;
}

export interface ReviewData {
  pr_number: number;
  pr_title: string;
  pr_author: string;
  repo_owner: string;
  repo_name: string;
  head_sha: string;
  changes: ChangeUnit[];
  screenshots: ScreenshotData;
}

export class TokenExpiredError extends Error {
  constructor() {
    super("GitHub token expired");
  }
}
