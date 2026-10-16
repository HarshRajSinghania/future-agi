import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { render } from "src/utils/test-utils";
import { MOCK_WORLD } from "src/api/simulate-environments/_fixtures/world";
import OverviewPanel from "../OverviewPanel";

// The drawer's real-data panel has its own tests; here it only has to mount.
vi.mock("../../agents/AgentVersionsPanel", () => ({
  default: ({ env }) => (
    <div data-testid="agent-versions-panel">{env.id}</div>
  ),
}));
import { HardRulesCard } from "../OverviewCards";

const connectedState = {
  agent: { via: "endpoint", typeId: "livekit", values: {} },
  agentVersions: [{ label: "v1", note: "First build." }],
  activeAgentVersion: "v1",
  scenarios: [],
};

const renderPanel = (props = {}) =>
  render(
    <OverviewPanel
      env={MOCK_WORLD}
      envState={connectedState}
      patch={vi.fn()}
      onGo={vi.fn()}
      agentConnected
      {...props}
    />
  );

describe("OverviewPanel", () => {
  it("shows the description and the two facts (Channel, Connector)", () => {
    renderPanel();

    expect(screen.getByText(MOCK_WORLD.description)).toBeInTheDocument();
    expect(screen.getByText("Channel")).toBeInTheDocument();
    expect(screen.getByText("Connector")).toBeInTheDocument();
    // The invented Transports + Scenario-packs facts are gone, and so is
    // Domain: it read a fixture lookup table, not anything the backend sends.
    expect(screen.queryByText("Transports")).toBeNull();
    expect(screen.queryByText("Scenario packs")).toBeNull();
    expect(screen.queryByText("Domain")).toBeNull();
    expect(screen.queryByText("E-commerce")).toBeNull();
    // fact values: channel from the surface, connector from agent.typeId.
    expect(screen.getByText("Voice")).toBeInTheDocument();
    expect(screen.getByText("LiveKit")).toBeInTheDocument();
  });

  // The Tools and Hard-rules cards were removed from the Overview panel as
  // duplicates of the Contract tab, so their panel-level tests went with them.
  // ToolsCard/HardRulesCard are still exercised where they render (the direct
  // HardRulesCard test below; ToolsCard on the Contract tab).

  it("renders each hard rule as text, with no invented origin chip", () => {
    render(<HardRulesCard env={MOCK_WORLD} />);

    // Every rule is listed…
    MOCK_WORLD.rules.forEach((rule) =>
      expect(screen.getByText(rule)).toBeInTheDocument(),
    );
    // …but ALK reports no per-rule origin, and the chips used to be derived by
    // position (first two CODE, last PROSE, rest PROMPT). None of them ship.
    expect(screen.queryByText("CODE")).toBeNull();
    expect(screen.queryByText("PROMPT")).toBeNull();
    expect(screen.queryByText("PROSE")).toBeNull();
  });

  it("renders real §6 world content for a backed env: empty states + real deps", () => {
    renderPanel({
      backedWorld: {
        stores: [],
        amendments: [],
        dependencies: [
          { name: "postgres", kind: "datastore", what: "Stores rider rows", used_by: ["book_ride"] },
        ],
      },
    });

    // Empty §6 arrays render honest empty states, not fixture rows. The stores
    // read-out went with SourceToSandboxMap, whose origins and sandbox targets
    // were derived by position and keyword rather than reported by ALK.
    expect(screen.getByText(/No amendments/)).toBeInTheDocument();
    expect(screen.queryByText(/No stores seeded/)).toBeNull();
    // "What it depends on" populates from real contract.dependencies.
    expect(screen.getByText("postgres")).toBeInTheDocument();
    expect(screen.getByText("Stores rider rows")).toBeInTheDocument();
    // Actors group is gone.
    expect(screen.queryByText("Actors")).toBeNull();
  });

  // The Seeded-data card was removed from Overview; stores now live only in the
  // source→sandbox map (covered by the SourceToSandboxMap suite in
  // overviewExtras). Its panel-level test went with it.

  describe("Manage versions", () => {
    const versioned = {
      ...MOCK_WORLD,
      id: "env-1",
      versioning: { enabled: true },
    };
    const manage = () =>
      screen.queryByRole("button", { name: "Manage versions" });

    it("opens the agent versions in a drawer while versioning is on", async () => {
      const user = userEvent.setup();
      renderPanel({ env: versioned });
      expect(screen.queryByTestId("agent-versions-panel")).toBeNull();

      await user.click(manage());
      expect(screen.getByTestId("agent-versions-panel")).toHaveTextContent(
        "env-1",
      );
      expect(
        screen.getByRole("heading", { level: 2, name: "Test subject" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Manage the agent versions running against this environment",
        ),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Close" }));
      await waitFor(() =>
        expect(screen.queryByTestId("agent-versions-panel")).toBeNull(),
      );
    });

    it("offers nothing while versioning is off", () => {
      renderPanel({ env: { ...versioned, versioning: { enabled: false } } });
      expect(manage()).toBeNull();
      renderPanel();
      expect(manage()).toBeNull();
    });

    it("offers nothing on a locked template", () => {
      renderPanel({ env: versioned, locked: true });
      expect(manage()).toBeNull();
    });
  });
});
