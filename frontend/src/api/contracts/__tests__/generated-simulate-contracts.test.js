import { describe, expect, it } from "vitest";

import {
  SimulateApiHarnessEnvironmentsNudgesAnswerNudgeResponse,
  SimulateApiHarnessEnvironmentsNudgesResponseItem,
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

describe.each([
  ["nudges", SimulateApiHarnessEnvironmentsNudgesResponseItem],
  ["answer", SimulateApiHarnessEnvironmentsNudgesAnswerNudgeResponse],
])("generated %s response", (_name, schema) => {
  it("accepts a nudge with nothing answered, applied or known yet", () => {
    const item = {
      id: "7d4c1a52-8d43-4c55-9d3e-0c5d0b1f6a10",
      target: "environment",
      state: "pending",
      facts: {
        source: { kind: "github", changed: true, from: null, to: "abc1234" },
        changed_files: [
          {
            path: "prompt.md",
            status: "modified",
            previous_path: null,
            additions: null,
            deletions: null,
            has_patch: false,
            patch_omitted: null,
          },
        ],
        files_total: null,
        files_unavailable: null,
        variables: { added: [], removed: [], changed: ["KEY"], unknown: [] },
        environment_diff: null,
        from_environment_version_id: null,
      },
      trigger_agent_version: {
        id: "7d4c1a52-8d43-4c55-9d3e-0c5d0b1f6a11",
        label: null,
      },
      base_agent_version: null,
      base_environment_version: null,
      base_suite_version: null,
      result_environment_version: null,
      result_suite_version: null,
      summary: null,
      error: null,
      closed_at: null,
      queued_behind_input: false,
      can_stop: false,
      replaced_by: null,
      card_message_id: null,
      answered_by: null,
      answered_at: null,
      created_at: "2026-10-17T00:00:00+00:00",
    };

    expect(schema.parse(item)).toEqual(item);
  });
});
