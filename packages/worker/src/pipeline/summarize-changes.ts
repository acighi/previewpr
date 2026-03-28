import { readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

// --- Types ---

interface ChangeUnit {
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

interface AnalysisOutput {
  head_sha: string;
  changes: ChangeUnit[];
}

// --- Prompt templates ---

export const FRONTEND_PROMPT = `You are explaining a code change to a product engineer who doesn't read code.
They will see before/after screenshots alongside your explanation.

Describe what changed in the product:
- What does the user see differently?
- What interaction changed?
- Is this a visual change, a behavior change, or both?

Keep it to 2-3 sentences. Use plain language. Reference specific UI elements.

Diff:
{diff}

Commit messages:
{commit_messages}`;

export const BACKEND_PROMPT = `You are explaining a backend code change to a product engineer who doesn't read code.
There are no screenshots for this change — your explanation is all they have.

Describe:
- What does this change DO from the product's perspective?
- Does it affect what the user sees or experiences? How?
- Is it a performance change, a data change, a new capability, or a fix?
- Are there any risks or side effects?

Keep it to 2-4 sentences. No technical jargon.

Diff:
{diff}

Commit messages:
{commit_messages}`;

// --- Constants ---

const MAX_DIFF_LENGTH = 8000;
const RISK_KEYWORDS = ["risk", "warning", "breaking", "careful", "side effect"];
const MODEL = "claude-haiku-4-5-20251001";

// --- Exported functions ---

export function truncateDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_LENGTH) return diff;
  return diff.substring(0, MAX_DIFF_LENGTH) + "\n... [truncated]";
}

export function buildPrompt(change: ChangeUnit): string {
  const template =
    change.category === "backend" ? BACKEND_PROMPT : FRONTEND_PROMPT;
  const truncatedDiff = truncateDiff(change.diff);
  return template
    .replace("{diff}", truncatedDiff)
    .replace("{commit_messages}", change.commit_messages.join("\n"));
}

export function detectRisk(response: string): string | null {
  const lower = response.toLowerCase();
  const hasRisk = RISK_KEYWORDS.some((kw) => lower.includes(kw));
  return hasRisk ? response : null;
}

export function fallbackExplanation(commitMessages: string[]): string {
  if (commitMessages.length === 0) return "No description available.";
  return commitMessages.join(". ");
}

export async function summarizeChange(
  change: ChangeUnit,
  client: Anthropic | null,
): Promise<{ explanation: string; risk_notes: string | null }> {
  if (!client) {
    return {
      explanation: fallbackExplanation(change.commit_messages),
      risk_notes: null,
    };
  }

  try {
    const prompt = buildPrompt(change);
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    return {
      explanation: text || fallbackExplanation(change.commit_messages),
      risk_notes: detectRisk(text),
    };
  } catch {
    return {
      explanation: fallbackExplanation(change.commit_messages),
      risk_notes: null,
    };
  }
}

// --- Main ---

export async function summarizeChanges(
  changesJsonPath: string,
  anthropicApiKey: string,
): Promise<ChangeUnit[]> {
  const raw = readFileSync(changesJsonPath, "utf-8");
  const data: AnalysisOutput = JSON.parse(raw);

  const client = anthropicApiKey
    ? new Anthropic({ apiKey: anthropicApiKey })
    : null;

  if (!client) {
    console.log("No Anthropic API key — using fallback mode.");
  }

  const enrichedChanges: ChangeUnit[] = [];
  for (const change of data.changes) {
    const result = await summarizeChange(change, client);
    enrichedChanges.push({
      ...change,
      explanation: result.explanation,
      risk_notes: result.risk_notes,
    });
  }

  const output: AnalysisOutput = {
    head_sha: data.head_sha,
    changes: enrichedChanges,
  };

  writeFileSync(changesJsonPath, JSON.stringify(output, null, 2));
  console.log(
    `Enriched ${enrichedChanges.length} changes in ${changesJsonPath}`,
  );

  return enrichedChanges;
}
