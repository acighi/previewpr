import { useState } from "react";
import type { CaptureEntry, ChangeUnit, ReviewDecision } from "../types";
import { ScreenshotViewer } from "./ScreenshotViewer";

interface ChangeCardProps {
  change: ChangeUnit;
  captures?: CaptureEntry[];
  decision: ReviewDecision;
  onDecisionChange: (d: ReviewDecision) => void;
  stepNumber: number;
  totalSteps: number;
  onPrevious: () => void;
  onNext: () => void;
  canGoPrevious: boolean;
  isLastStep: boolean;
}

export function ChangeCard({
  change,
  captures,
  decision,
  onDecisionChange,
  stepNumber,
  totalSteps,
  onPrevious,
  onNext,
  canGoPrevious,
  isLastStep,
}: ChangeCardProps) {
  const [diffOpen, setDiffOpen] = useState(false);
  const hasDecided = decision.status !== "pending";
  const canAdvance =
    hasDecided &&
    (decision.status !== "rejected" || (decision.reason?.trim() ?? "") !== "");

  return (
    <div>
      {/* Step header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              background: "#1976d2",
              color: "#fff",
              padding: "2px 10px",
              borderRadius: 10,
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {stepNumber}/{totalSteps}
          </span>
          <h2 style={{ margin: 0, fontSize: 18 }}>{change.title}</h2>
          <ImpactBadge impact={change.estimated_impact} />
          <span style={{ color: "#888", fontSize: 12 }}>
            {change.files.length} file{change.files.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Decision + navigation row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
          padding: "8px 12px",
          background: "#fff",
          border: "1px solid #e0e0e0",
          borderRadius: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <NavButton
            label="← Previous"
            onClick={onPrevious}
            disabled={!canGoPrevious}
          />
          <DecisionButtons
            decision={decision}
            onChange={onDecisionChange}
            changeId={change.id}
          />
          <NavButton
            label={isLastStep ? "Review Summary →" : "Next →"}
            onClick={onNext}
            disabled={!canAdvance}
            primary
          />
        </div>
        {!hasDecided && (
          <span style={{ color: "#f57c00", fontSize: 12 }}>
            Choose Approve or Reject to continue
          </span>
        )}
      </div>

      {/* Rejection reason inline */}
      {decision.status === "rejected" && (
        <input
          type="text"
          placeholder="Reason for rejection (required)"
          value={decision.reason ?? ""}
          onChange={(e) =>
            onDecisionChange({
              changeId: change.id,
              status: "rejected",
              reason: e.target.value,
            })
          }
          style={{
            width: "100%",
            padding: "6px 10px",
            border: "1px solid #f44336",
            borderRadius: 4,
            fontSize: 13,
            marginBottom: 8,
            boxSizing: "border-box",
          }}
        />
      )}

      {/* Screenshots — the main content */}
      {captures && captures.length > 0 && (
        <ScreenshotViewer captures={captures} />
      )}

      {/* Collapsible details */}
      <div
        style={{
          marginTop: 8,
          padding: 12,
          background: "#fff",
          border: "1px solid #e0e0e0",
          borderRadius: 6,
          fontSize: 13,
        }}
      >
        {change.explanation && (
          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                fontWeight: 600,
                fontSize: 13,
                color: "#888",
                marginBottom: 4,
              }}
            >
              AI Summary
            </div>
            <p style={{ margin: 0, lineHeight: 1.5 }}>{change.explanation}</p>
          </div>
        )}
        {change.risk_notes && (
          <div
            style={{
              background: "#fff8e1",
              border: "1px solid #ffe082",
              borderRadius: 4,
              padding: "8px 12px",
              marginBottom: 12,
            }}
          >
            <strong>Risk: </strong>
            {change.risk_notes}
          </div>
        )}
        <details style={{ margin: "8px 0" }}>
          <summary style={{ cursor: "pointer", fontSize: 14 }}>
            Files ({change.files.length})
          </summary>
          <ul style={{ margin: 4, paddingLeft: 20 }}>
            {change.files.map((f) => (
              <li key={f} style={{ fontFamily: "monospace", fontSize: 13 }}>
                {f}
              </li>
            ))}
          </ul>
        </details>
        {change.diff && change.diff.trim() && (
          <details
            open={diffOpen}
            onToggle={() => setDiffOpen(!diffOpen)}
            style={{ margin: "8px 0" }}
          >
            <summary style={{ cursor: "pointer", fontSize: 14 }}>
              View diff
            </summary>
            <pre
              style={{
                background: "#f5f5f5",
                padding: 12,
                borderRadius: 4,
                overflow: "auto",
                fontSize: 12,
                maxHeight: 300,
              }}
            >
              <code>{change.diff}</code>
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

function ImpactBadge({ impact }: { impact: string }) {
  const colors: Record<string, string> = {
    visual: "#e3f2fd",
    behavioral: "#fff3e0",
    data: "#fce4ec",
    config: "#f3e5f5",
  };
  return (
    <span
      style={{
        background: colors[impact] ?? "#eee",
        padding: "2px 10px",
        borderRadius: 12,
        fontSize: 12,
      }}
    >
      {impact}
    </span>
  );
}

function DecisionButtons({
  decision,
  onChange,
  changeId,
}: {
  decision: ReviewDecision;
  onChange: (d: ReviewDecision) => void;
  changeId: string;
}) {
  return (
    <>
      <button
        data-action="approve"
        onClick={() =>
          onChange({ changeId, status: "approved", reason: undefined })
        }
        style={{
          padding: "5px 16px",
          background: decision.status === "approved" ? "#4caf50" : "#e8f5e9",
          color: decision.status === "approved" ? "#fff" : "#2e7d32",
          border:
            decision.status === "approved"
              ? "2px solid #388e3c"
              : "1px solid #a5d6a7",
          borderRadius: 5,
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        ✓ Approve
      </button>
      <button
        data-action="reject"
        onClick={() =>
          onChange({ changeId, status: "rejected", reason: decision.reason })
        }
        style={{
          padding: "5px 16px",
          background: decision.status === "rejected" ? "#f44336" : "#ffebee",
          color: decision.status === "rejected" ? "#fff" : "#c62828",
          border:
            decision.status === "rejected"
              ? "2px solid #d32f2f"
              : "1px solid #ef9a9a",
          borderRadius: 5,
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        ✗ Reject
      </button>
    </>
  );
}

function NavButton({
  label,
  onClick,
  disabled,
  primary,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "5px 14px",
        background: disabled ? "#e0e0e0" : primary ? "#1976d2" : "#fff",
        color: disabled ? "#999" : primary ? "#fff" : "#333",
        border: disabled ? "1px solid #e0e0e0" : "1px solid #ccc",
        borderRadius: 5,
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 13,
        fontWeight: primary ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}
