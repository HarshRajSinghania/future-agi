import { describe, it, expect } from "vitest";
import { render, screen, userEvent } from "src/utils/test-utils";
import AgentSummarySection from "../AgentSummarySection";

const PROMPT =
  "You are the support agent.\nCheck identity first.\nNever invent orders.";

describe("AgentSummarySection prompt", () => {
  it("offers no prompt when the API sent none", () => {
    render(<AgentSummarySection subject={{ name: "Support" }} />);

    expect(screen.queryByText("View prompt")).toBeNull();
  });

  it("opens the full prompt with its origin and line count", async () => {
    render(
      <AgentSummarySection
        subject={{ name: "Support" }}
        systemPrompt={PROMPT}
        systemPromptOrigin={{ kind: "system_prompt", field: "general_prompt" }}
      />,
    );

    await userEvent.click(screen.getByText("View prompt"));

    expect(await screen.findByText("Support · prompt")).toBeInTheDocument();
    expect(screen.getByText("3 lines")).toBeInTheDocument();
    expect(screen.getByText("SYSTEM PROMPT")).toBeInTheDocument();
    expect(screen.getByText(/Check identity first\./)).toBeInTheDocument();
  });
});
