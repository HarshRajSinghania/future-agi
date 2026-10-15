import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "src/utils/test-utils";
import ObserveToolbar from "../../ObserveToolbar";

vi.mock("src/components/custom-datepicker/DatePicker", () => ({
  default: () => null,
}));
vi.mock("../../TraceFilterPanel", () => ({ default: () => null }));
vi.mock("../../DisplayPanel", () => ({ default: () => null }));
vi.mock("../../BulkActionsBar", () => ({ default: () => null }));
vi.mock("../../tabStore", () => ({
  useTabStoreShallow: (selector) => selector({ openCreateModal: vi.fn() }),
}));
vi.mock("src/components/iconify", () => ({ default: () => null }));

const renderToolbar = (props) =>
  render(
    <ObserveToolbar
      inline
      isFilterOpen={false}
      onFilterToggle={vi.fn()}
      onApplyExtraFilters={vi.fn()}
      {...props}
    />,
  );

describe("ObserveToolbar Instant eval and Insights", () => {
  it.each(["traces", "sessions", "users"])(
    "offers both on the %s view",
    (mode) => {
      const onInstantEval = vi.fn();
      const onInsights = vi.fn();
      renderToolbar({ mode, onInstantEval, onInsights });
      fireEvent.click(screen.getByRole("button", { name: "Instant eval" }));
      fireEvent.click(screen.getByRole("button", { name: "Insights" }));
      expect(onInstantEval).toHaveBeenCalledTimes(1);
      expect(onInsights).toHaveBeenCalledTimes(1);
    },
  );

  it("hides both for spans, in compare mode and without handlers", () => {
    const handlers = { onInstantEval: vi.fn(), onInsights: vi.fn() };
    const { unmount } = renderToolbar({
      mode: "traces",
      isSpansView: true,
      ...handlers,
    });
    expect(screen.queryByRole("button", { name: "Instant eval" })).toBeNull();
    unmount();
    const compare = renderToolbar({
      mode: "sessions",
      isCompareActive: true,
      ...handlers,
    });
    expect(screen.queryByRole("button", { name: "Insights" })).toBeNull();
    compare.unmount();
    renderToolbar({ mode: "users" });
    expect(screen.queryByRole("button", { name: "Instant eval" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Insights" })).toBeNull();
  });
});
