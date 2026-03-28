import type { ReviewDecision } from "../types";

interface ReviewSummaryProps {
  decisions: ReviewDecision[];
  onSubmit: () => void;
  isSubmitting: boolean;
  tokenError: boolean;
  onLogin: () => void;
}

export function ReviewSummary({
  decisions,
  onSubmit,
  isSubmitting,
  tokenError,
  onLogin,
}: ReviewSummaryProps) {
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
        position: "sticky",
        bottom: 0,
        background: "#fff",
        borderTop: "2px solid #e0e0e0",
        padding: "12px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        zIndex: 100,
      }}
    >
      <div style={{ display: "flex", gap: 16 }}>
        <span style={{ color: "#4caf50" }}>{approved} approved</span>
        <span style={{ color: "#f44336" }}>{rejected} rejected</span>
        <span style={{ color: "#9e9e9e" }}>{pending} pending</span>
      </div>
      {tokenError ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ color: "#f44336" }}>Session expired</span>
          <button
            onClick={onLogin}
            style={{
              padding: "8px 20px",
              background: "#24292e",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Log in with GitHub
          </button>
        </div>
      ) : (
        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          style={{
            padding: "8px 24px",
            background: canSubmit ? "#1976d2" : "#bdbdbd",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: canSubmit ? "pointer" : "not-allowed",
            fontSize: 14,
          }}
        >
          {isSubmitting ? "Submitting..." : "Submit Review"}
        </button>
      )}
    </div>
  );
}
