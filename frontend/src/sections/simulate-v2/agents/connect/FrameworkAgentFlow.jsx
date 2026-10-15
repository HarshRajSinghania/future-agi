import PropTypes from "prop-types";
import { useEffect, useState } from "react";
import { alpha } from "@mui/material/styles";
import { Box, Stack, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { FRAMEWORK_META } from "../../_mock/agentRegistry";
import { installedRepos, useIntegrations } from "../../_mock/integrations";
import { ADAPTERS, ADAPTER_ENDPOINT_PLACEHOLDER, BUILTIN_TOOL_LIBRARY, describeAdapter, frameworkMembersOf } from "../../_mock/connectAgent";
import { OPENAI_AGENT_BUILDER_NOTE, TRACEAI_FRAMEWORK_NOTE } from "../../environments/connectOptions";
import { ChipCard, Field, Label } from "../../environments/StartEnvironment";
import ConnectSteps from "./ConnectSteps";
import { CodeSnippet, TextLink } from "./connectBits";
import { HintLine } from "./replicationBits";
import { recommendedRunLocation } from "../../_mock/replication";
import { useConnectSubmitLabel } from "./connectSubmit";

/* One screen: install, wrap, say where it runs — Connect asks the adapter to
   describe the agent and saves it with what it said. Review it, the Observe
   project and constraints on the agent's page, in Finish setting up. */
const STEPS = ["Connect"];
const validUrl = (u) => /^(https?|wss?):\/\/\S+$/i.test(String(u || "").trim());

/**
 * A LangGraph, OpenAI Agents SDK or CrewAI agent, through our SDK adapter:
 * install it and wrap the graph, entry agent or crew in serve(); Connect has
 * the adapter describe what it wraps and saves that. The framework itself is
 * picked on the page's Framework row and can be switched at the top.
 */
export default function FrameworkAgentFlow({ title, framework, onFramework, onSave, onSwitch }) {
  const submitLabel = useConnectSubmitLabel();
  const integrations = useIntegrations();
  const [endpoint, setEndpoint] = useState(ADAPTER_ENDPOINT_PLACEHOLDER);
  const [reading, setReading] = useState(false);
  const [found, setFound] = useState(null);
  const [facts, setFacts] = useState({});
  /* Set later on the agent's page: a linked repository, the hosted sandbox. */
  const linkedRepo = "";
  const location = null;
  const localSdk = false;

  const meta = FRAMEWORK_META[framework] || FRAMEWORK_META.langgraph;
  const adapter = ADAPTERS[framework] || ADAPTERS.langgraph;

  const switchFramework = (id) => {
    onFramework(id);
    setFound(null);
    setFacts({});
  };

  const describe = () => {
    setReading(true);
    setTimeout(() => {
      const r = describeAdapter({ framework, endpoint });
      setFound(r);
      setFacts(Object.fromEntries(Object.entries(r.facts).map(([k, f]) => [k, f.value])));
      setReading(false);
    }, 900);
  };

  /* Prompt files, wherever this framework keeps them. */
  const prompts = !found ? []
    : framework === "langgraph" ? (facts.prompts || []).map((p) => p.split(" · ").pop())
      : framework === "openai-agents" ? (found.structure.agents || []).map((a) => a.instructions)
        : ["config/agents.yaml", "config/tasks.yaml"];
  const repoName = linkedRepo.trim().replace(/^https?:\/\/[^/]+\//, "").replace(/\.git$/, "");
  const viaGithub = !!repoName && installedRepos(integrations).some((r) => r.name.toLowerCase() === repoName.toLowerCase());

  /* serve() runs it; the hosted sandbox (built from a repository) is chosen later. */
  const runLocation = localSdk ? "sdk" : location || recommendedRunLocation({ sourceKind: "framework" });
  const members = found ? frameworkMembersOf(framework, found.structure, facts.model) : [];
  const source = {
    kind: "framework",
    framework,
    name: (facts.name || "").trim(),
    entry: facts.entry || adapter.entry,
    ...(found?.structure || {}),
    ...(framework === "openai-agents" && facts.guardrails && { guardrails: facts.guardrails }),
    prompts,
    tools: (facts.tools || []).map((name) => {
      const known = BUILTIN_TOOL_LIBRARY.find((t) => t.name === name);
      return { name, desc: known?.desc || "", args: known?.args || [] };
    }),
    model: facts.model,
    runtime: { endpoint: endpoint.trim(), tokenRef: "" },
    runLocation,
    ...(localSdk && { localSdk: true }),
    ...(members.length && { members }),
    ...(repoName && { linkedRepo: repoName, ...(viaGithub && { githubApp: true }), gitHost: "github" }),
    versionNote: `Described by the ${meta.label} adapter at ${endpoint.trim()}.`,
  };

  /* Connect: the adapter describes the agent, then it's saved as described. */
  const [saveWanted, setSaveWanted] = useState(false);
  useEffect(() => {
    if (!saveWanted || !found) return;
    setSaveWanted(false);
    onSave(source);
  }, [saveWanted, found]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = {
    label: submitLabel,
    icon: "solar:link-circle-linear",
    disabled: !validUrl(endpoint),
    hint: "Add where serve() runs",
    busy: reading ? `Asking the ${meta.label} adapter to describe ${adapter.wraps}…` : null,
    onClick: () => { describe(); setSaveWanted(true); },
  };

  return (
    <ConnectSteps
      title={title}
      subtitle="Wrap your graph, agents or crew with our adapter. It serves the agent for simulations and describes its structure — you confirm what it found."
      steps={STEPS}
      active={0}
      next={next}
    >
        <Stack spacing={2}>
          <Box>
            <Label>Framework</Label>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 0.75 }}>
              {Object.entries(FRAMEWORK_META).map(([id, f]) => (
                <ChipCard key={id} icon={f.icon} label={f.label} on={framework === id} onClick={() => switchFramework(id)} />
              ))}
            </Box>
          </Box>

          <Box>
            <RailStep n={1} title="Install the adapter" body="One extra on futureagi — it pulls in nothing else.">
              <CodeSnippet code={adapter.install} />
            </RailStep>
            <RailStep n={2} title={`Wrap ${adapter.wraps}`} body={<HintLine hint={`It runs conversations through ${meta.label}'s own loop and reports the structure.`}>serve() leaves your code as it is.</HintLine>}>
              <CodeSnippet code={adapter.code} />
            </RailStep>
            <RailStep n={3} title="Run it and tell us where" body={<HintLine hint="serve() dials out with your API key, so local works while it's running.">Local works — no port to open. Deployed? Use that URL.</HintLine>} last>
              <Box sx={{ maxWidth: 480 }}>
                <CodeSnippet code={adapter.run} />
                <Box sx={{ mt: 1.25 }}>
                  <Field label="Adapter endpoint" required mono placeholder={ADAPTER_ENDPOINT_PLACEHOLDER} value={endpoint} onChange={setEndpoint} fullWidth />
                </Box>
              </Box>
            </RailStep>
          </Box>

          <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
            Code already in GitHub?{" "}
            <TextLink onClick={() => onSwitch("repo")}>Point us at the repository instead</TextLink>
          </Typography>
          <Box sx={{ px: 1.5, py: 1, borderRadius: 1, bgcolor: "background.neutral" }}>
            <Typography component="div" sx={{ typography: "s3", color: "text.secondary" }}>
              <HintLine hint={`${OPENAI_AGENT_BUILDER_NOTE} ${TRACEAI_FRAMEWORK_NOTE}`}>OpenAI Agent Builder is shutting down.</HintLine>
            </Typography>
          </Box>
        </Stack>
    </ConnectSteps>
  );
}

FrameworkAgentFlow.propTypes = {
  title: PropTypes.string,
  framework: PropTypes.oneOf(Object.keys(FRAMEWORK_META)).isRequired,
  onFramework: PropTypes.func.isRequired,
  limits: PropTypes.object.isRequired,
  onLimits: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  onSwitch: PropTypes.func,
  profile: PropTypes.object.isRequired,
  onProfile: PropTypes.func.isRequired,
  observe: PropTypes.object,
  onObserve: PropTypes.func.isRequired,
  prefill: PropTypes.object,
};

/*
  The third place it can run (Phase 2): on the person's own machine, through
  the SDK. We can't build it, so their coding agent makes each change and we
  run the proof — the fix depth becomes "changes by your coding agent".
*/
function LocalSdkOption({ on, onClick }) {
  return (
    <Stack
      direction="row" spacing={1.25} alignItems="flex-start"
      role="radio" aria-checked={on} tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      sx={{
        mt: 1, px: 1.5, py: 1.25, borderRadius: 1, cursor: "pointer", border: "1px solid",
        borderColor: on ? "text.primary" : "divider",
        bgcolor: (t) => (on ? alpha(t.palette.text.primary, t.palette.mode === "dark" ? 0.06 : 0.03) : "transparent"),
      }}
    >
      <Iconify icon="solar:monitor-smartphone-linear" width={16} sx={{ color: "text.secondary", mt: 0.25, flexShrink: 0 }} />
      <Box flex={1} minWidth={0}>
        <Typography sx={{ typography: "s2", fontWeight: 600 }}>Runs on my machine — connect with the SDK</Typography>
        <Typography component="div" sx={{ typography: "s3", color: "text.subtitle", mt: 0.25 }}>
          <HintLine hint="It stays on your machine. Your own coding agent makes each change from our brief; we run the proof against it through the SDK.">
            Your coding agent makes each change; we run the proof.
          </HintLine>
        </Typography>
      </Box>
    </Stack>
  );
}
LocalSdkOption.propTypes = { on: PropTypes.bool, onClick: PropTypes.func };

/* One numbered step of the install, on a thin rail — like Develop locally. */
function RailStep({ n, title, body, last, children }) {
  return (
    <Stack direction="row" spacing={1.75}>
      <Stack alignItems="center" sx={{ flexShrink: 0 }}>
        <Box
          sx={{
            width: 22, height: 22, borderRadius: "50%", display: "grid", placeItems: "center",
            border: "1px solid", borderColor: "divider",
            typography: "s3", fontWeight: 700, color: "text.secondary",
          }}
        >
          {n}
        </Box>
        {!last && <Box sx={{ flex: 1, width: "1px", bgcolor: "divider", my: 0.75, minHeight: 20 }} />}
      </Stack>
      <Box sx={{ flex: 1, minWidth: 0, pb: last ? 0 : 2 }}>
        <Typography sx={{ typography: "s2", fontWeight: 700, lineHeight: "22px" }}>{title}</Typography>
        <Typography component="div" sx={{ typography: "s3", color: "text.subtitle", mb: 1 }}>{body}</Typography>
        {children}
      </Box>
    </Stack>
  );
}
RailStep.propTypes = { n: PropTypes.number, title: PropTypes.string, body: PropTypes.node, last: PropTypes.bool, children: PropTypes.node };
