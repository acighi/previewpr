import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChangeCard } from "../components/ChangeCard";
import type { ChangeUnit, ReviewDecision } from "../types";

const mockChange: ChangeUnit = {
  id: "test-1",
  category: "frontend",
  title: "Test Change",
  files: ["src/Foo.tsx"],
  diff: "- old\n+ new",
  commit_messages: ["feat: test"],
  estimated_impact: "visual",
  explanation:
    "This is a test explanation with <b>html</b> that should be text",
  risk_notes: null,
};

const pendingDecision: ReviewDecision = {
  changeId: "test-1",
  status: "pending",
};

const rejectedDecision: ReviewDecision = {
  changeId: "test-1",
  status: "rejected",
  reason: "",
};

describe("ChangeCard", () => {
  it("renders explanation as text, not HTML", () => {
    render(
      <ChangeCard
        change={mockChange}
        decision={pendingDecision}
        onDecisionChange={() => {}}
      />,
    );
    const el = screen.getByText(/This is a test explanation/);
    expect(el.innerHTML).toContain("&lt;b&gt;html&lt;/b&gt;");
  });

  it("shows reason input when rejected", () => {
    render(
      <ChangeCard
        change={mockChange}
        decision={rejectedDecision}
        onDecisionChange={() => {}}
      />,
    );
    expect(
      screen.getByPlaceholderText("Reason for rejection (required)"),
    ).toBeInTheDocument();
  });

  it("hides reason input when approved", () => {
    const approved: ReviewDecision = {
      changeId: "test-1",
      status: "approved",
    };
    render(
      <ChangeCard
        change={mockChange}
        decision={approved}
        onDecisionChange={() => {}}
      />,
    );
    expect(
      screen.queryByPlaceholderText("Reason for rejection (required)"),
    ).not.toBeInTheDocument();
  });

  it("calls onDecisionChange when approve clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ChangeCard
        change={mockChange}
        decision={pendingDecision}
        onDecisionChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Approve/ }));
    expect(onChange).toHaveBeenCalledWith({
      changeId: "test-1",
      status: "approved",
      reason: undefined,
    });
  });
});
