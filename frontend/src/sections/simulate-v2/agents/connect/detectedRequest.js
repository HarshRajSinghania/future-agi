import { PROVIDER_LABELS } from "../../_mock/agentRegistry";

/* The flow request for the one right way in, from what the traces say. */
export const detectedRequestOf = (traced) => {
  if (!traced) return null;
  if (traced.via === "traceai") {
    return { kind: "repo", initial: { framework: traced.framework }, id: "github", meta: { name: "GitHub", logo: "github" }, at: Date.now() };
  }
  const label = PROVIDER_LABELS[traced.provider] || traced.provider;
  return {
    kind: "hosted",
    initial: { agentType: traced.agentType || "voice", platform: traced.provider, agentId: traced.agentId, apiKeyRef: traced.keyRef, keyFrom: traced.integration },
    id: traced.provider, meta: { name: label, logo: traced.provider }, at: Date.now(),
  };
};
