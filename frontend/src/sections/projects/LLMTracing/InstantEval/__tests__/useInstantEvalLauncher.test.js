import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("src/utils/axios", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  readQuery: vi.fn(),
  endpoints: { project: {}, develop: { eval: {} } },
}));

import { askLink } from "src/sections/projects/observeHandoff";
import {
  useInstantEvalLauncher,
  withoutAskParam,
} from "../useInstantEvalLauncher";

afterEach(() => {
  window.history.replaceState(null, "", "/");
  globalThis.sessionStorage?.clear();
});

describe("withoutAskParam", () => {
  it("drops only the hand-off key", () => {
    expect(withoutAskParam("?ask=k1&tab=traces")).toBe("?tab=traces");
    expect(withoutAskParam("?ask=k1")).toBe("");
    expect(withoutAskParam("")).toBe("");
  });
});

describe("useInstantEvalLauncher", () => {
  it("stays closed and unmounted until asked", () => {
    const navigate = vi.fn();
    const { result } = renderHook(() =>
      useInstantEvalLauncher({ enabled: true, navigate }),
    );
    expect(result.current).toMatchObject({ open: false, mounted: false });
    act(() => result.current.openDrawer());
    expect(result.current).toMatchObject({ open: true, mounted: true });
    act(() => result.current.close());
    // Closing keeps the drawer mounted so a run keeps polling.
    expect(result.current).toMatchObject({ open: false, mounted: true });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("opens prefilled from an Insights hand-off and drops the key", () => {
    const ask = {
      unit: "sessions",
      questions: [{ question: "Did they get it?", answerType: "yes_no" }],
      ids: ["s1", "s2"],
      label: "Refund requests",
    };
    const link = askLink("p1", ask);
    const url = new URL(link, "http://localhost");
    window.history.replaceState(null, "", `${url.pathname}${url.search}&x=1`);
    const navigate = vi.fn();
    const { result } = renderHook(() =>
      useInstantEvalLauncher({ enabled: true, navigate }),
    );
    expect(result.current).toMatchObject({
      open: true,
      mounted: true,
      seed: ask,
      seedKey: url.searchParams.get("ask"),
    });
    expect(navigate).toHaveBeenCalledWith(
      { pathname: "/dashboard/observe/p1/sessions", search: "?x=1" },
      { replace: true },
    );
  });

  it("ignores a hand-off when the view has no project", () => {
    const url = new URL(askLink("p1", { unit: "users" }), "http://localhost");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    const navigate = vi.fn();
    const { result } = renderHook(() =>
      useInstantEvalLauncher({ enabled: false, navigate }),
    );
    expect(result.current.open).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
