import { describe, expect, it } from "vitest";

import {
  SimulateApiHarnessEnvironmentsVersionsAgentDiscardAgentVersionResponse,
  SimulateApiHarnessEnvironmentsVersionsMoveDefaultResponse,
  SimulateApiHarnessEnvironmentsVersionsResponse,
  SimulateV3CallExecutionDetailResponse,
  SimulateV3TestExecutionCallsResponse,
} from "src/generated/api-contracts/api.zod";

describe.each([
  ["call detail", SimulateV3CallExecutionDetailResponse.shape.sub_goal_results],
  [
    "call list",
    SimulateV3TestExecutionCallsResponse.shape.results.element.shape
      .sub_goal_results,
  ],
])("generated %s sub-goal contract", (_name, schema) => {
  it.each([true, false, null])("preserves verdict %s", (passed) => {
    const results = [{ name: "Verify the caller's PIN", passed }];

    expect(schema.parse(results)).toEqual(results);
  });

  it.each(["false", 0, undefined])("rejects invalid verdict %s", (passed) => {
    expect(
      schema.safeParse([{ name: "Verify the caller's PIN", passed }]).success,
    ).toBe(false);
  });
});

describe.each([
  ["versions", SimulateApiHarnessEnvironmentsVersionsResponse],
  ["move default", SimulateApiHarnessEnvironmentsVersionsMoveDefaultResponse],
  [
    "discard",
    SimulateApiHarnessEnvironmentsVersionsAgentDiscardAgentVersionResponse,
  ],
])("generated %s response", (_name, schema) => {
  it.each(["agent", "environment", "suite"])(
    "accepts a null source and prompt on %s items",
    (piece) => {
      const item = schema.shape[piece].element.shape;

      expect(item.source.parse(null)).toBeNull();
      expect(item.prompt.parse(null)).toBeNull();
    },
  );
});
