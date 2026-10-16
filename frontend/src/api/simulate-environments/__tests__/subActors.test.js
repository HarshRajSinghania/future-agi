import { describe, it, expect } from "vitest";

import { stageOutputsToWorld } from "../environment";
import { scenarioFromApi } from "../scenarios";
import { functionCallTranscriptRows, mapCallDetail } from "../runDetail";

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
