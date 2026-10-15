import PropTypes from "prop-types";
import { useEffect, useMemo, useState } from "react";
import { alpha } from "@mui/material/styles";
import { Box, MenuItem, Select, Stack, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { FRAMEWORK_META } from "../../_mock/agentRegistry";
import { installedRepos, repoUrlOf, useIntegrations } from "../../_mock/integrations";
import { entryForTraces, folderForTraces, observeProjectById, readAgentFolder, repoBranches, repoChecksOf, repoDetectionOf, repoFolders, repoForTraces, traceMatchOf } from "../../_mock/connectAgent";
import { isSecretRef } from "../../_mock/secretRefs";
import GithubRepoPicker from "../../integrations/GithubRepoPicker";
import { Field } from "../../environments/StartEnvironment";
import ConnectSteps from "./ConnectSteps";
import { TextLink } from "./connectBits";
import { HintLine } from "./replicationBits";
import { recommendedRunLocation } from "../../_mock/replication";
import { useConnectSubmitLabel } from "./connectSubmit";

const MONO = "ui-monospace, Menlo, monospace";
/* One screen: which agent, then Connect. What reading the code finds is
   applied as it stands — the agent's page lists it to check, with the
   Observe project, constraints and where it runs, in Finish setting up. */
const STEPS = ["Connect"];


/**
 * A repository, in one step: the repository (through the GitHub App) and the
 * agent the scan found in it — or, typed by hand, the folder its entry file
 * lives in. Connect reads that folder at the branch and saves the agent with
 * what it found; side-effect tools start stubbed, constraints start at the
 * defaults, and everything is reviewed afterwards on the agent's page.
 */
export default function RepoAgentFlow({ title, preset, onSave, prefill, initial = null }) {
  const submitLabel = useConnectSubmitLabel();
  const integrations = useIntegrations();
  /*
    Opened from an Error Feed issue whose Observe project is traced with
    traceAI: the traces already say which code this is — the service, the
    framework, the tools. The repository and folder are suggested from it,
    what we read in the code is checked against it (a mismatch blocks — it
    would point Fix at a different agent), the issue's Observe project comes
    with it, and the channel comes from the traces.
  */
  const project = prefill?.project ? observeProjectById(prefill.project) : null;
  const tracedCode = project?.traced?.via === "traceai" ? project.traced : null;
  const tracedFw = tracedCode ? FRAMEWORK_META[tracedCode.framework]?.label || tracedCode.framework : null;
  const suggestedRepo = tracedCode ? repoForTraces(tracedCode, installedRepos(integrations)) : null;
  /* A pasted repository: picked from the GitHub App when it can see it, otherwise typed in. */
  const pasted = initial?.repo || null;
  const pastedVisible = !!pasted && installedRepos(integrations).some((r) => r.name.toLowerCase() === pasted.toLowerCase());
  const presetFolder = useMemo(() => {
    const repo = installedRepos(integrations).find((r) => r.name === preset?.repo);
    return repoFolders(repo).find((f) => (f.agents || []).some((a) => a.id === preset?.agent?.id))?.path || "";
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [mode, setMode] = useState(pasted && !pastedVisible ? "manual" : "github");
  const [ghRepo, setGhRepo] = useState(preset?.repo || (pastedVisible ? pasted : "") || suggestedRepo || "");
  /* Access granted on GitHub after opening: pick the matching repository then. */
  useEffect(() => {
    if (!ghRepo && suggestedRepo) setGhRepo(suggestedRepo);
  }, [suggestedRepo]); // eslint-disable-line react-hooks/exhaustive-deps
  const [manualRepo, setManualRepo] = useState(pasted && !pastedVisible ? pasted : "");
  const [branch, setBranch] = useState("main");
  const [folder, setFolder] = useState(presetFolder);
  const [reading, setReading] = useState(false);
  const [found, setFound] = useState(null);
  const [facts, setFacts] = useState({});
  /* Where the SDK serves it — added later, on the agent's page. */
  const endpoint = "";
  /* What must hold before it's simulated: tools that must never run for
     real, the repository's own tests, and the test credentials to use. */
  const [checks, setChecks] = useState(null);
  const [neverReal, setNeverReal] = useState([]);
  const [testsFact, setTestsFact] = useState("");
  const credRef = "";
  /* The rest of what reading found (detected), and what the person settled
     (confirmed): which entry point when there are several, where prompts
     built at runtime come from, whether the model is chosen at runtime, the
     reference each credential key name resolves through. */
  const [detected, setDetected] = useState(null);
  const [entryId, setEntryId] = useState(preset?.agent?.id || null);
  const [pointers, setPointers] = useState({});
  const [modelAtRuntime, setModelAtRuntime] = useState(false);
  const [keyRefs, setKeyRefs] = useState({});

  const viaGithub = mode === "github";
  const repo = viaGithub
    ? installedRepos(integrations).find((r) => r.name === ghRepo) || null
    : manualRepo.trim() ? { name: manualRepo.trim().replace(/^https?:\/\/[^/]+\//, ""), language: /\.ts|typescript|-web|-chat/i.test(manualRepo) ? "TypeScript" : "Python", agents: [] } : null;
  const branches = useMemo(() => repoBranches(repo), [repo?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Read one entry point of the folder — again when another is picked. */
  const apply = (asked) => {
    const dir = folder.trim().replace(/\/+$/, "");
    const pickedEntry = asked || (tracedCode ? entryForTraces(tracedCode, repo, dir) : null);
    const r = readAgentFolder({ repo, folder: dir, branch, entryId: pickedEntry });
    const d = repoDetectionOf({ repo, folder: dir, branch, found: r });
    setFound(r);
    setDetected(d);
    setEntryId((d.entryPoints.find((e) => e.id === pickedEntry) || d.entryPoints[0])?.id || null);
    setFacts({
      name: r.name,
      ...Object.fromEntries(Object.entries(r.facts).map(([k, f]) => [k, f.value])),
      language: d.language.value,
      install: d.install.value,
    });
    setPointers({});
    setModelAtRuntime(d.modelAtRuntime.value);
    setKeyRefs({});
    const c = repoChecksOf({ repo, folder: dir, tools: r.facts.tools.value });
    setChecks(c);
    /* Safe by default: every tool that looks like it writes is stubbed. */
    setNeverReal(c.sideEffects.value);
    setTestsFact(c.tests.value);
  };
  const runLocation = recommendedRunLocation({ sourceKind: "repo" });
  const livekit = /livekit/i.test(found?.framework || "");
  const source = {
    kind: "repo",
    /* GitHub only for now — GitLab and Bitbucket are Later. */
    provider: "github",
    gitHost: "github",
    /* The channel the traces show; else a LiveKit agent takes calls and
       anything else defaults to chat. */
    agentType: tracedCode?.channel || (livekit ? "voice" : "chat"),
    value: viaGithub ? repoUrlOf(ghRepo) : manualRepo.trim(),
    ref: branch.trim() || "main",
    releaseDetection: { watch: "branch", ref: (branch || "main").trim() },
    folder: folder.trim(),
    entry: facts.entry || "",
    ...(viaGithub && { githubApp: true }),
    framework: found?.framework,
    name: (facts.name || "").trim(),
    prompts: facts.prompts || [],
    tools: (facts.tools || []).map((name) => ({ name, desc: "", args: [] })),
    model: facts.model,
    runCommand: facts.run,
    runtime: { endpoint: runLocation === "sdk" ? endpoint.trim() : "", tokenRef: "" },
    runLocation,
    ...(checks && {
      neverRunForReal: neverReal.filter((t) => (facts.tools || []).includes(t)),
      repoTests: { command: (testsFact || "").trim(), checks: checks.tests.checks },
    }),
    ...(isSecretRef(credRef) && { testCredentialsRef: credRef.trim() }),
    ...(detected && {
      language: facts.language,
      installCommand: facts.install,
      ...(modelAtRuntime && { modelAtRuntime: true }),
      runtimePrompts: detected.runtimePrompts.map((p) => ({ kind: p.kind, what: p.what, where: p.where, ...((pointers[p.id] || "").trim() && { pointer: pointers[p.id].trim() }) })),
      /* Key names and the reference each resolves through — never a value. */
      credentialKeys: detected.credentialKeys.value.map((name) => ({ name, ...(isSecretRef(keyRefs[name]) && { ref: keyRefs[name].trim() }) })),
      fagiPrompts: detected.fagiPrompts.value,
      ...(detected.members.length && { members: detected.members.map((m) => ({ ...m, instructions: m.promptRef })) }),
    }),
    versionNote: `Read from ${repo?.name || "the repository"} @ ${branch.trim() || "main"}.`,
  };

  /* What we read, against what the traces said. */
  const match = tracedCode && found ? traceMatchOf(tracedCode, { framework: found.framework, tools: facts.tools, model: facts.model }) : null;
  const mismatch = !!match && !match.ok;

  /* Connect reads the folder, then saves once what it read is in state. */
  const [saveWanted, setSaveWanted] = useState(false);
  const [changingBranch, setChangingBranch] = useState(false);
  const folderOfAgent = (r, agentId) => repoFolders(r).find((f) => (f.agents || []).some((a) => a.id === agentId))?.path || "";
  const connect = () => {
    setReading(true);
    setTimeout(() => {
      apply(entryId);
      setReading(false);
      setSaveWanted(true);
    }, 900);
  };
  useEffect(() => {
    if (!saveWanted || !found) return;
    setSaveWanted(false);
    /* A folder that isn't the agent behind the issue's traces would point Fix at another agent. */
    if (mismatch) return;
    onSave(source);
  }, [saveWanted, found]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = !!repo && !!folder.trim() && !!branch.trim();
  const next = {
    label: submitLabel,
    icon: "solar:link-circle-linear",
    disabled: !ready || mismatch,
    hint: mismatch ? `Doesn't match ${project.name}'s traces` : !repo ? (viaGithub ? "Choose a repository" : "Add a repository") : "Choose the agent",
    busy: reading ? `Reading ${folder || "the agent"} at ${branch}…` : null,
    onClick: connect,
  };

  return (
    <ConnectSteps
      title={title}
      subtitle="Pick the repository and the agent in it. We read the code when you connect — check what we found afterwards, on the agent's page."
      steps={STEPS}
      active={0}
      next={next}
    >
      <Stack spacing={1.75}>
        {tracedCode && (
          <Typography component="div" sx={{ typography: "s3", color: "text.secondary", px: 1.5, py: 1, borderRadius: 1, border: "1px solid", borderColor: "divider" }}>
            {suggestedRepo
              ? <>{`Suggested from ${project.name}'s traces — service `}<Box component="span" sx={{ fontFamily: MONO }}>{tracedCode.service}</Box>{` · ${tracedFw}.`}</>
              : <>{`None of the repositories the GitHub App can see matches ${project.name}'s traces — service `}<Box component="span" sx={{ fontFamily: MONO }}>{tracedCode.service}</Box>{` · ${tracedFw}. If its code is in another repository, give the app access with "Change access on GitHub" below.`}</>}
          </Typography>
        )}
        {viaGithub ? (
          <GithubRepoPicker
            repo={ghRepo}
            agentId={entryId}
            onPick={({ repo: r, agent: a }) => {
              setGhRepo(r);
              const picked = installedRepos(integrations).find((x) => x.name === r);
              if (a) { setEntryId(a.id); setFolder(folderOfAgent(picked, a.id)); }
              else { setEntryId(null); setFolder((tracedCode && folderForTraces(tracedCode, picked)) || ""); }
              setFound(null);
            }}
            onManual={(pre) => { setMode("manual"); if (pre?.repo) setManualRepo(pre.repo); }}
          />
        ) : (
          <Stack spacing={1.5}>
            <Field
              label="GitHub repository" required mono
              placeholder="owner/repo"
              value={manualRepo} onChange={(v) => { setManualRepo(v); setFolder(""); }}
              helper="Read once now — Sync and fix PRs need the GitHub App."
            />
            <Field
              label="Agent folder" required mono
              placeholder="agents/returns"
              value={folder} onChange={setFolder}
              helper={<HintLine hint="A monorepo can hold several agents.">The folder the agent&apos;s entry file lives in.</HintLine>}
            />
            <TextLink onClick={() => setMode("github")}>Pick from GitHub instead</TextLink>
          </Stack>
        )}

        {/* The branch is the one choice with a default worth stating. */}
        {repo && (
          changingBranch ? (
            <Box sx={{ maxWidth: 320 }}>
              {viaGithub ? (
                <Select
                  size="small" fullWidth value={branch}
                  onChange={(e) => { setBranch(e.target.value); setChangingBranch(false); }}
                  renderValue={(v) => <Box component="span" sx={{ fontFamily: MONO }}>{v}</Box>}
                  sx={{ typography: "s2" }}
                >
                  {branches.map((b) => (
                    <MenuItem key={b} value={b} sx={{ typography: "s2", gap: 1 }}>
                      <Box component="span" sx={{ fontFamily: MONO, flex: 1 }}>{b}</Box>
                      {b === "main" && <Box component="span" sx={{ color: "text.subtitle" }}>default</Box>}
                    </MenuItem>
                  ))}
                </Select>
              ) : (
                <Field label="Branch or tag" mono value={branch} onChange={setBranch} />
              )}
            </Box>
          ) : (
            <Typography component="div" sx={{ typography: "s3", color: "text.subtitle" }}>
              {"Reads "}
              <Box component="span" sx={{ fontFamily: MONO, color: "text.primary" }}>{branch}</Box>
              {" — a fix merged there counts as released. "}
              <TextLink onClick={() => setChangingBranch(true)}>Change</TextLink>
            </Typography>
          )
        )}

        {match && found && (
          <TraceMatch match={match} traced={tracedCode} tracedFw={tracedFw} projectName={project.name} found={found} tools={facts.tools || []} />
        )}
      </Stack>
    </ConnectSteps>
  );
}

RepoAgentFlow.propTypes = {
  title: PropTypes.string,
  initial: PropTypes.object,
  /* { repo, agent } — start from a repository the GitHub page already scanned. */
  preset: PropTypes.object,
  limits: PropTypes.object.isRequired,
  onLimits: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  profile: PropTypes.object.isRequired,
  onProfile: PropTypes.func.isRequired,
  observe: PropTypes.object,
  onObserve: PropTypes.func.isRequired,
  prefill: PropTypes.object,
};


/* What reading the code found, against what the Observe project's traces said. */
function TraceMatch({ match, traced, tracedFw, projectName, found, tools }) {
  if (match.ok) {
    return (
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 1, borderRadius: 1, border: "1px solid", borderColor: "divider" }}>
        <Iconify icon="solar:check-circle-linear" width={16} sx={{ color: "text.secondary", flexShrink: 0 }} />
        <Typography sx={{ typography: "s2" }}>
          <Box component="span" sx={{ fontWeight: 600 }}>{`Matches ${projectName}'s traces`}</Box>
          {` · ${tracedFw} · ${match.toolsFound} of ${match.toolsTraced} traced tools found${match.modelOk ? ` · ${traced.model}` : ""}`}
        </Typography>
      </Stack>
    );
  }
  return (
    <Box sx={{ px: 1.5, py: 1.25, borderRadius: 1, border: "1px solid", borderColor: (t) => alpha(t.palette.error.main, 0.5), bgcolor: (t) => alpha(t.palette.error.main, t.palette.mode === "dark" ? 0.08 : 0.04) }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Iconify icon="solar:danger-triangle-linear" width={16} sx={{ color: "error.main", flexShrink: 0 }} />
        <Typography sx={{ typography: "s2", fontWeight: 700 }}>{`Doesn't match ${projectName}'s traces`}</Typography>
      </Stack>
      <Stack spacing={0.25} sx={{ mt: 0.75, pl: 3 }}>
        <Typography sx={{ typography: "s3", color: "text.secondary" }}>
          {"Traces: "}<Box component="span" sx={{ fontFamily: MONO }}>{`${tracedFw} · ${traced.tools.join(", ")}`}</Box>
        </Typography>
        <Typography sx={{ typography: "s3", color: "text.secondary" }}>
          {"This folder: "}<Box component="span" sx={{ fontFamily: MONO }}>{`${found.framework} · ${tools.slice(0, 4).join(", ")}${tools.length > 4 ? "…" : ""}`}</Box>
        </Typography>
        <Typography sx={{ typography: "s3", color: "text.secondary", mt: 0.5 }}>
          Pick another folder or repository — connecting this one would fix this issue against a different agent.
        </Typography>
      </Stack>
    </Box>
  );
}
TraceMatch.propTypes = {
  match: PropTypes.object, traced: PropTypes.object, tracedFw: PropTypes.string, projectName: PropTypes.string, found: PropTypes.object, tools: PropTypes.array,
};
