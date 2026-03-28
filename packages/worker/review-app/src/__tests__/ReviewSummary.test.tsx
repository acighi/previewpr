import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReviewSummary } from "../components/ReviewSummary";
import type { ReviewDecision } from "../types";

const noop = () => {};

describe("ReviewSummary", () => {
  it("disables submit when there are pending decisions", () => {
    const decisions: ReviewDecision[] = [
      { changeId: "1", status: "approved" },
      { changeId: "2", status: "pending" },
    ];
    render(
      <ReviewSummary
        decisions={decisions}
        onSubmit={noop}
        isSubmitting={false}
        tokenError={false}
        onLogin={noop}
      />,
    );
    expect(screen.getByText("Submit Review")).toBeDisabled();
  });

  it("disables submit when rejection has no reason", () => {
    const decisions: ReviewDecision[] = [
      { changeId: "1", status: "approved" },
      { changeId: "2", status: "rejected", reason: "" },
    ];
    render(
      <ReviewSummary
        decisions={decisions}
        onSubmit={noop}
        isSubmitting={false}
        tokenError={false}
        onLogin={noop}
      />,
    );
    expect(screen.getByText("Submit Review")).toBeDisabled();
  });

  it("enables submit when all decided with reasons", () => {
    const decisions: ReviewDecision[] = [
      { changeId: "1", status: "approved" },
      { changeId: "2", status: "rejected", reason: "Needs fix" },
    ];
    render(
      <ReviewSummary
        decisions={decisions}
        onSubmit={noop}
        isSubmitting={false}
        tokenError={false}
        onLogin={noop}
      />,
    );
    expect(screen.getByText("Submit Review")).not.toBeDisabled();
  });

  it("shows login button when tokenError is true", () => {
    render(
      <ReviewSummary
        decisions={[]}
        onSubmit={noop}
        isSubmitting={false}
        tokenError={true}
        onLogin={noop}
      />,
    );
    expect(screen.getByText("Session expired")).toBeInTheDocument();
    expect(screen.getByText("Log in with GitHub")).toBeInTheDocument();
  });

  it("shows correct counts", () => {
    const decisions: ReviewDecision[] = [
      { changeId: "1", status: "approved" },
      { changeId: "2", status: "rejected", reason: "Bad" },
      { changeId: "3", status: "pending" },
    ];
    render(
      <ReviewSummary
        decisions={decisions}
        onSubmit={noop}
        isSubmitting={false}
        tokenError={false}
        onLogin={noop}
      />,
    );
    expect(screen.getByText("1 approved")).toBeInTheDocument();
    expect(screen.getByText("1 rejected")).toBeInTheDocument();
    expect(screen.getByText("1 pending")).toBeInTheDocument();
  });
});
