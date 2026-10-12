import { describe, it, expect } from "vitest";
import { render, screen } from "src/utils/test-utils";

import SourceReadCard from "../SourceReadCard";

const LONG_RULE =
  "When calling a tool, use only approved neutral fillers ('One moment.', 'Let me check.', 'Just a second.', 'Give me a moment.', 'Let me see.', 'Let me look into that.') and never repeat the same filler twice in a row.";

describe("SourceReadCard", () => {
  it("wraps a long rule instead of cutting it off", () => {
    render(<SourceReadCard rules={[LONG_RULE]} />);
    const rule = screen.getByText(LONG_RULE);
    const style = window.getComputedStyle(rule);
    expect(style.whiteSpace).not.toBe("nowrap");
    expect(style.textOverflow).not.toBe("ellipsis");
  });

  it("renders tools and rules from strings and objects", () => {
    render(
      <SourceReadCard
        tools={[{ name: "lookup_order" }]}
        rules={[{ text: "Start in English." }]}
        ruleDetails={null}
      />,
    );
    expect(screen.getByText("lookup_order")).toBeInTheDocument();
    expect(screen.getByText("Start in English.")).toBeInTheDocument();
  });

  it("renders only origins that ALK reported", () => {
    render(
      <SourceReadCard
        tools={[
          {
            name: "lookup_order",
            origin: { kind: "provider_tool_list", field: "tools[0]" },
          },
        ]}
        rules={["Start in English.", "Never invent an order."]}
        ruleDetails={[
          {
            text: "Start in English.",
            origin: { kind: "provider_system_prompt", field: "system_prompt" },
          },
        ]}
      />,
    );

    expect(screen.getByText("TOOL LIST")).toBeInTheDocument();
    expect(screen.getByText("SYSTEM PROMPT")).toBeInTheDocument();
    expect(screen.getByText("tools[0]")).toBeInTheDocument();
    expect(screen.getByText("system_prompt")).toBeInTheDocument();
    expect(screen.queryByText("INFERRED")).toBeNull();
  });
});
