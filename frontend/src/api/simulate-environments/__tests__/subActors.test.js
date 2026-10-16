import { describe, it, expect } from "vitest";

import { stageOutputsToWorld } from "../environment";
import { scenarioFromApi } from "../scenarios";
import { functionCallTranscriptRows, mapCallDetail } from "../runDetail";
import { PREBUILT_ENVIRONMENTS_FIXTURE } from "../_fixtures/prebuiltEnvironments";

describe("sub-actors", () => {
  it("reads the cast from its stage output and leaves a world without one unchanged", () => {
    const world = stageOutputsToWorld([
      {
        kind: "cast",
        data: { sub_actors: [{ id: "subactor_service", name: "Service", role: "behind a tool" }] },
      },
    ]);
    expect(world.cast.subActors).toEqual([
      { id: "subactor_service", name: "Service", role: "behind a tool", channel: "" },
    ]);
    expect(stageOutputsToWorld([{ kind: "contract", data: {} }])).toBeNull();
  });

  it("lists the sub-actors a scenario binds", () => {
    expect(
      scenarioFromApi({ sub_actors: [{ id: "subactor_bystander", trigger: {} }] }).subActors,
    ).toEqual(["subactor_bystander"]);
    expect(scenarioFromApi({}).subActors).toEqual([]);
  });

  it("keeps a sub-actor's name on its turn and marks an injected fault", () => {
    const detail = mapCallDetail({
      transcript: [{ speaker_role: "sub_actor", speaker_name: "Bystander", content: "Add a stop." }],
    });
    expect(detail.turns[0]).toMatchObject({ role: "sub_actor", speakerName: "Bystander" });

    const [row] = functionCallTranscriptRows([{ name: "book", error: "fault:timeout:subactor_service" }]);
    expect(row.content).toContain("injected timeout");
    const [plain] = functionCallTranscriptRows([{ name: "book" }]);
    expect(plain.content).not.toContain("injected");
  });
});

describe("sub-goal results by actor", () => {
  it("keeps each sub-goal's actor and narrows the sub-goal columns to the actors chosen", async () => {
    const { buildTraceColumns, subGoalColumnsFor } = await import("../runCalls");
    const columns = buildTraceColumns([
      { id: "a", name: "ignored_bystander", kind: "sub_goal", actor: "subactor_bystander" },
      { id: "b", name: "identity_verified", kind: "sub_goal", actor: "primary" },
      { id: "c", name: "Tone", kind: "evaluation" },
    ]);
    const keys = (filters) => subGoalColumnsFor(columns, filters).map((c) => c.key);
    expect(keys({})).toEqual(["a", "b"]);
    expect(keys({ actor: ["primary"] })).toEqual(["b"]);
    expect(keys({ actor: ["subactor_bystander"] })).toEqual(["a"]);
    expect(keys({ actor_not: ["primary"] })).toEqual(["a"]);
  });
});

describe("template casts", () => {
  const byId = Object.fromEntries(PREBUILT_ENVIRONMENTS_FIXTURE.map((one) => [one.id, one]));
  const channels = (id) => byId[id].cast?.subActors.map((one) => one.channel) ?? [];

  it("gives each vertical a cast its surface can deliver", () => {
    expect(channels("env-voice-support")).toEqual(["ivr", "audio_mix", "transfer_leg", "tool_response"]);
    expect(channels("env-chat-banking")).toEqual(["thread_message", "tool_response", "inbound_message"]);
    expect(channels("env-chat-travel")).toEqual(["thread_message", "tool_response", "inbound_message"]);
    expect(channels("env-browser")).toEqual(["tool_response"]);
  });

  it("gives a surface the harness does not reach no cast", () => {
    expect(byId["env-coding"].cast).toBeUndefined();
    expect(byId["env-robotics"].cast).toBeUndefined();
  });
});
