import { useCallback, useEffect, useState } from "react";
import { ChangeCard } from "./components/ChangeCard";
import {
  clearToken,
  extractTokenFromFragment,
  getStoredToken,
  initiateOAuthLogin,
  storeToken,
  submitReview,
  validateOAuthState,
} from "./lib/github";
import type { ReviewData, ReviewDecision } from "./types";
import { TokenExpiredError } from "./types";

export function App() {
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decisions, setDecisionsRaw] = useState<ReviewDecision[]>(() => {
    try {
      const saved = sessionStorage.getItem("review_decisions");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [currentStep, setCurrentStep] = useState(() => {
    try {
      const saved = sessionStorage.getItem("review_step");
      return saved ? parseInt(saved, 10) : 0;
    } catch {
      return 0;
    }
  });

  function setDecisions(
    update: ReviewDecision[] | ((prev: ReviewDecision[]) => ReviewDecision[]),
  ) {
    setDecisionsRaw((prev) => {
      const next = typeof update === "function" ? update(prev) : update;
      sessionStorage.setItem("review_decisions", JSON.stringify(next));
      return next;
    });
  }
  const [token, setToken] = useState<string | null>(getStoredToken());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [tokenError, setTokenError] = useState(false);

  useEffect(() => {
    loadReviewData();
  }, []);

  useEffect(() => {
    handleOAuthCallback();
  }, []);

  useEffect(() => {
    sessionStorage.setItem("review_step", String(currentStep));
  }, [currentStep]);

  async function loadReviewData() {
    try {
      const resp = await fetch("/review-data/data.json");
      if (!resp.ok) throw new Error("Failed to load review data");
      const data: ReviewData = await resp.json();
      setReviewData(data);
      const hasSavedDecisions =
        decisions.length > 0 && decisions.some((d) => d.status !== "pending");
      if (!hasSavedDecisions) {
        setDecisions(
          data.changes.map((c) => ({ changeId: c.id, status: "pending" })),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  }

  function handleOAuthCallback() {
    // Check for token in URL fragment (redirected from Worker)
    const result = extractTokenFromFragment();
    if (!result) return;
    // Clear fragment from URL
    window.history.replaceState({}, "", window.location.pathname);
    if (!validateOAuthState(result.state)) {
      setError("OAuth state mismatch");
      return;
    }
    storeToken(result.token);
    setToken(result.token);
    setTokenError(false);
  }

  const handleDecisionChange = useCallback((d: ReviewDecision) => {
    setDecisions((prev) =>
      prev.map((dec) => (dec.changeId === d.changeId ? d : dec)),
    );
  }, []);

  function handleLogin() {
    initiateOAuthLogin(window.location.origin + window.location.pathname);
  }

  async function handleSubmit() {
    if (!reviewData || !token) {
      setTokenError(true);
      return;
    }
    setIsSubmitting(true);
    try {
      await submitReview(
        token,
        reviewData.repo_owner,
        reviewData.repo_name,
        reviewData.pr_number,
        decisions,
        reviewData.changes,
      );
      setSubmitted(true);
      sessionStorage.removeItem("review_decisions");
      sessionStorage.removeItem("review_step");
    } catch (e) {
      if (e instanceof TokenExpiredError) {
        clearToken();
        setToken(null);
        setTokenError(true);
      } else {
        setError(e instanceof Error ? e.message : "Submit failed");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (error) return <ErrorScreen message={error} />;
  if (!reviewData) return <LoadingScreen />;
  if (submitted) {
    const prUrl = `https://github.com/${reviewData.repo_owner}/${reviewData.repo_name}/pull/${reviewData.pr_number}`;
    window.location.href = prUrl;
    return <SuccessScreen />;
  }

  const changes = reviewData.changes;
  const totalSteps = changes.length;
  const isReviewStep = currentStep < totalSteps;
  const isSummaryStep = currentStep === totalSteps;
  const currentChange = isReviewStep ? changes[currentStep] : null;
  const currentDecision = currentChange
    ? (decisions.find((d) => d.changeId === currentChange.id) ?? {
        changeId: currentChange.id,
        status: "pending" as const,
      })
    : null;

  const approved = decisions.filter((d) => d.status === "approved").length;
  const rejected = decisions.filter((d) => d.status === "rejected").length;
  const pending = decisions.filter((d) => d.status === "pending").length;
  const missingReasons = decisions.some(
    (d) => d.status === "rejected" && !d.reason?.trim(),
  );
  const canSubmit = pending === 0 && !missingReasons && !isSubmitting;

  return (
    <div
      style={{
        minHeight: "100vh",
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
        background: "#f8f9fa",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          background: "#fff",
          borderBottom: "1px solid #e0e0e0",
          padding: "6px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>
            PR #{reviewData.pr_number}
          </span>
          <span style={{ color: "#666", fontSize: 12 }}>
            {reviewData.pr_title}
          </span>
        </div>
        <StepIndicator
          steps={changes.map((c, i) => ({
            label: c.title,
            status: decisions[i]?.status ?? "pending",
          }))}
          currentStep={currentStep}
          onStepClick={setCurrentStep}
          totalWithSummary={totalSteps + 1}
        />
      </div>

      {/* Progress bar */}
      <div style={{ height: 2, background: "#e0e0e0" }}>
        <div
          style={{
            height: "100%",
            width: `${((currentStep + 1) / (totalSteps + 1)) * 100}%`,
            background: "#1976d2",
            transition: "width 0.3s ease",
          }}
        />
      </div>

      {/* Main content */}
      <div
        style={{ maxWidth: 1200, margin: "0 auto", padding: "8px 16px 64px" }}
      >
        {isReviewStep && currentChange && currentDecision && (
          <ChangeCard
            change={currentChange}
            captures={reviewData.screenshots[currentChange.id]?.captures}
            decision={currentDecision}
            onDecisionChange={handleDecisionChange}
            stepNumber={currentStep + 1}
            totalSteps={totalSteps}
            onPrevious={() => setCurrentStep((s) => Math.max(0, s - 1))}
            onNext={() => setCurrentStep((s) => Math.min(totalSteps, s + 1))}
            canGoPrevious={currentStep > 0}
            isLastStep={currentStep === totalSteps - 1}
          />
        )}

        {isSummaryStep && (
          <SummaryScreen
            changes={changes}
            decisions={decisions}
            onStepClick={setCurrentStep}
          />
        )}
      </div>

      {/* Bottom navigation */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: "#fff",
          borderTop: "1px solid #e0e0e0",
          padding: "8px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          zIndex: 100,
        }}
      >
        <div style={{ display: "flex", gap: 16, fontSize: 14 }}>
          <span style={{ color: "#4caf50", fontWeight: 600 }}>
            {approved} approved
          </span>
          <span style={{ color: "#f44336", fontWeight: 600 }}>
            {rejected} rejected
          </span>
          <span style={{ color: "#9e9e9e" }}>{pending} pending</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {isSummaryStep && !tokenError && (
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{
                padding: "8px 24px",
                background: canSubmit ? "#2e7d32" : "#bdbdbd",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: canSubmit ? "pointer" : "not-allowed",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {isSubmitting ? "Submitting..." : "Submit Review"}
            </button>
          )}

          {isSummaryStep && tokenError && (
            <button
              onClick={handleLogin}
              style={{
                padding: "8px 20px",
                background: "#24292e",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              Log in with GitHub to Submit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepIndicator({
  steps,
  currentStep,
  onStepClick,
  totalWithSummary,
}: {
  steps: { label: string; status: string }[];
  currentStep: number;
  onStepClick: (i: number) => void;
  totalWithSummary: number;
}) {
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      {steps.map((step, i) => {
        const isActive = i === currentStep;
        const colors: Record<string, string> = {
          approved: "#4caf50",
          rejected: "#f44336",
          pending: "#bdbdbd",
        };
        const bg = isActive ? "#1976d2" : (colors[step.status] ?? "#bdbdbd");
        return (
          <button
            key={i}
            onClick={() => onStepClick(i)}
            title={step.label}
            style={{
              width: isActive ? 28 : 20,
              height: 8,
              borderRadius: 4,
              background: bg,
              border: "none",
              cursor: "pointer",
              transition: "all 0.2s",
              padding: 0,
            }}
          />
        );
      })}
      <button
        onClick={() => onStepClick(steps.length)}
        title="Summary"
        style={{
          width: currentStep === steps.length ? 28 : 20,
          height: 8,
          borderRadius: 4,
          background: currentStep === steps.length ? "#1976d2" : "#e0e0e0",
          border: "none",
          cursor: "pointer",
          transition: "all 0.2s",
          padding: 0,
          marginLeft: 4,
        }}
      />
    </div>
  );
}

function SummaryScreen({
  changes,
  decisions,
  onStepClick,
}: {
  changes: ReviewData["changes"];
  decisions: ReviewDecision[];
  onStepClick: (i: number) => void;
}) {
  return (
    <div>
      <h2 style={{ margin: "0 0 16px", fontSize: 20 }}>Review Summary</h2>
      <p style={{ color: "#666", marginBottom: 24 }}>
        Review your decisions before submitting. Click any item to go back and
        change it.
      </p>
      {changes.map((change, i) => {
        const dec = decisions.find((d) => d.changeId === change.id);
        const statusColors: Record<string, { bg: string; fg: string }> = {
          approved: { bg: "#e8f5e9", fg: "#2e7d32" },
          rejected: { bg: "#ffebee", fg: "#c62828" },
          pending: { bg: "#f5f5f5", fg: "#666" },
        };
        const colors = statusColors[dec?.status ?? "pending"];
        return (
          <button
            key={change.id}
            onClick={() => onStepClick(i)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              padding: "16px 20px",
              marginBottom: 8,
              background: "#fff",
              border: "1px solid #e0e0e0",
              borderRadius: 8,
              cursor: "pointer",
              textAlign: "left",
              fontSize: 14,
            }}
          >
            <div>
              <span style={{ fontWeight: 600 }}>
                Step {i + 1}: {change.title}
              </span>
              <span style={{ color: "#888", marginLeft: 8 }}>
                {change.files.length} file
                {change.files.length !== 1 ? "s" : ""}
              </span>
              {dec?.status === "rejected" && dec.reason && (
                <div style={{ color: "#c62828", fontSize: 13, marginTop: 4 }}>
                  Reason: {dec.reason}
                </div>
              )}
            </div>
            <span
              style={{
                background: colors.bg,
                color: colors.fg,
                padding: "4px 12px",
                borderRadius: 12,
                fontSize: 13,
                fontWeight: 600,
                textTransform: "capitalize",
              }}
            >
              {dec?.status ?? "pending"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function LoadingScreen() {
  return (
    <div style={{ padding: 40, textAlign: "center" }}>Loading review...</div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div style={{ padding: 40, textAlign: "center", color: "#c62828" }}>
      <h2>Error loading review</h2>
      <p>{message}</p>
    </div>
  );
}

function SuccessScreen() {
  return (
    <div style={{ padding: 40, textAlign: "center" }}>
      <h2 style={{ color: "#2e7d32" }}>Review submitted!</h2>
      <p>Your review has been posted to the PR. You can close this tab.</p>
    </div>
  );
}

export default App;
