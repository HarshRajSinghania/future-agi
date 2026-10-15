import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { paths } from "src/routes/paths";
import { useConnectedAgents } from "../store";
import { legacyAgentIdOf } from "./legacyDefinitions";
import useMoveLegacyDefinitions from "./useMoveLegacyDefinitions";

/*
  An old Simulate → Agent definitions/:id link. Old definitions move into
  Agents on their own, so it opens that agent's page; one the backend no
  longer has lands on Connected agents.
*/
export default function LegacyDefinitionRedirect() {
  const { agentDefinitionId } = useParams();
  const { agents, hydrated } = useConnectedAgents();
  /* Old definitions move in on their own — give it a moment, then go. */
  useMoveLegacyDefinitions();
  const [waited, setWaited] = useState(false);
  useEffect(() => { const t = setTimeout(() => setWaited(true), 1500); return () => clearTimeout(t); }, []);
  if (!hydrated) return null;
  const id = agentDefinitionId ? legacyAgentIdOf({ id: agentDefinitionId }) : null;
  if (id && agents.some((a) => a.id === id)) return <Navigate to={`${paths.dashboard.agents}/connected/${id}`} replace />;
  if (!waited) return null;
  const legacy = agentDefinitionId ? `&legacy=${encodeURIComponent(agentDefinitionId)}` : "";
  return <Navigate to={`${paths.dashboard.agents}?tab=connected&moved=agent-definitions${legacy}`} replace />;
}
