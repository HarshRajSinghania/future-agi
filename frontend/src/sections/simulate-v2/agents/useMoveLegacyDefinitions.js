/*
  Simulate → Agent definitions move into Agents on their own: every old
  definition not yet here becomes a connected agent at v1 the first time the
  list loads — nothing for anyone to approve. Each lands once (keyed by its
  old id), so an old `agent-definitions/:id` link finds it.

  The old list comes from the backend; with no backend answering (this
  prototype on its own) the sample stands in.
*/
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import axios, { endpoints } from "src/utils/axios";
import { useConnectedAgents } from "../store";
import { LEGACY_SAMPLE, legacyKeyOf, legacyRecordOf } from "./legacyDefinitions";

export default function useMoveLegacyDefinitions() {
  const { agents, connectAgent, setAgentValues, hydrated } = useConnectedAgents();
  const { data, isError, isFetched } = useQuery({
    queryKey: ["agentDefinitions", "move-to-agents"],
    queryFn: () => axios.get(endpoints.agentDefinitions.list, { params: { page: 1, limit: 100 } }),
    select: (d) => d?.data?.results ?? [],
    retry: false,
    staleTime: 60_000,
  });
  const done = useRef(new Set());
  useEffect(() => {
    if (!hydrated || !(isFetched || isError)) return;
    const list = isError ? LEGACY_SAMPLE : data || [];
    const have = new Set(agents.map((a) => a.key));
    const now = new Date().toISOString();
    /* Agents moved before: their "description" was the old prompt — clear it. */
    agents.forEach((a) => {
      const def = a.values?.movedFrom?.kind === "agent-definition" && list.find((d) => d.id === a.values.movedFrom.id);
      if (def && a.values.description && a.values.description.trim() === (def.description || "").trim()) setAgentValues(a.key, { description: "" });
    });
    list.forEach((def) => {
      const key = legacyKeyOf(def);
      if (have.has(key) || done.current.has(key)) return;
      done.current.add(key);
      connectAgent(legacyRecordOf(def, now));
    });
  }, [hydrated, isFetched, isError, data, agents, connectAgent, setAgentValues]);
}
