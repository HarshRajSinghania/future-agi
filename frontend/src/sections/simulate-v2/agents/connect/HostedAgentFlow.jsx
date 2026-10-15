import PropTypes from "prop-types";
import { useEffect, useMemo, useState } from "react";
import { alpha } from "@mui/material/styles";
import { Box, Button, CircularProgress, IconButton, Stack, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { SANDBOX_IMPORT_PROVIDERS, assistantsFor, importedStructureOf, observeSlugOf, phoneParts } from "../../_mock/connectAgent";
import { AGENT_TYPES, COUNTRY_BY_ISO, HOSTED_PLATFORMS_BY_TYPE, PLATFORM_LOGOS, firstLive, isLivePlatform } from "../../environments/connectOptions";
import { ChipCard, Field, Label, NoteLine, PlatformKeyScope, PlatformLogo, PlatformTestingStep } from "../../environments/StartEnvironment";
import { PLATFORM_TESTING } from "../../_mock/rsiModel";
import ConnectSteps from "./ConnectSteps";
import { TextLink } from "./connectBits";
import { CloneScopeChoice, HintLine } from "./replicationBits";
import { canCloneProvider, keyLacksCreateScope } from "../../_mock/replication";
import { keyRefOf } from "../../_mock/secretRefs";
import SecretRefField from "./SecretRefField";
import { useConnectSubmitLabel } from "./connectSubmit";

const MONO = "ui-monospace, Menlo, monospace";
/* One screen: the platform, the key, the assistant — then Connect. The rest
   (how calls reach it, a sealed copy, a linked repository, constraints) has
   working defaults and is set on the agent's page, in Finish setting up. */
const STEPS = ["Connect"];

/**
 * A hosted platform, on one screen: the key, then the agent — picked from
 * the account's own list rather than typed — and Connect. The assistant's
 * config comes in as v1; how it's reached and its constraints start at the
 * defaults and are set on the agent's page.
 */
export default function HostedAgentFlow({ title, onSave, prefill, initial = null, lockedType = null }) {
  const submitLabel = useConnectSubmitLabel();
  const [listing, setListing] = useState(false);
  const [agentType, setAgentType] = useState(lockedType || initial?.agentType || "voice");
  /* No "Others" here: a prompt with no platform behind it is an agent built
     in Future AGI, which has its own way in. */
  const platforms = (HOSTED_PLATFORMS_BY_TYPE[agentType] || []).filter((p) => !p.isOther);
  const [platformId, setPlatformId] = useState(initial?.platform || firstLive(platforms)?.id || "");
  const platform = platforms.find((p) => p.id === platformId && isLivePlatform(p)) || firstLive(platforms) || null;
  /* The key by reference (AC-6.12) — a path in the team's secret manager. */
  /* Connecting from an Observe project whose call logs come through
     Observe's own integration: that integration already holds the key, so
     its reference comes along — never the key itself. */
  const [keyRef, setKeyRef] = useState(initial?.apiKeyRef || "");
  /* What's recorded is a reference — the one typed, or (demo) the platform's slot. */
  const savedRef = keyRefOf(keyRef, platform ? `vault://acme/sim/${platform.id}_api_key` : "");
  const refOk = !!savedRef;
  /* A Vapi key without create scope can't make the test copy — the person
     re-issues it, or tests with settings overridden for one call (still
     live). The access check reads the scope off the referenced key. */
  const [scopeChoice, setScopeChoice] = useState(null);
  const lacksScope = !!platform && refOk && canCloneProvider(platform.id) && keyLacksCreateScope(keyRef);
  /* ElevenLabs branches need versioning on — the person switches it on. */
  const [versioningOn, setVersioningOn] = useState(false);
  const testing = PLATFORM_TESTING[platform?.id] || null;

  const assistants = useMemo(() => assistantsFor(platform?.id), [platform?.id]);
  const [pickedId, setPickedId] = useState(null);
  /* A pasted ID comes in typed — no need to list the account to find it. */
  const [typing, setTyping] = useState(!!initial?.agentId);
  const [typedId, setTypedId] = useState(initial?.agentId || "");
  const picked = typing ? null : assistants.find((a) => a.id === pickedId) || null;
  const agentId = typing ? typedId.trim() : picked?.id || "";
  /* What the import brings: a squad, flow or workflow's members, and for
     Retell whether it's a single prompt or a conversation flow. A typed ID
     reads as a single prompt unless it names a flow. */
  const imported = importedStructureOf(platform?.id, picked || (agentId ? { id: agentId, retellKind: /flow/i.test(agentId) ? "conversation_flow" : "single_prompt" } : null));
  /* Optional (Vapi, Retell): import a copy into our sandbox with the code
     behind its tools, so it's tested sealed rather than live. */
  const canImport = SANDBOX_IMPORT_PROVIDERS.includes(platform?.id);
  const [importCopy, setImportCopy] = useState(false);
  const [toolFiles, setToolFiles] = useState([]);
  const sealed = canImport && importCopy && toolFiles.length > 0;

  const [name, setName] = useState("");
  /* Defaults until the agent's page says otherwise: watch production, reach
     it as a web call, inbound, the caller speaks first. */
  const linkedRepo = "";
  const watch = true;
  const simMode = "web";
  const [countryIso, setCountryIso] = useState("US");
  const [contactNumber, setContactNumber] = useState("");
  const inboundCalls = true;
  const agentSpeaksFirst = false;
  const voice = agentType === "voice";

  const pickType = (id) => {
    setAgentType(id);
    setPlatformId(firstLive((HOSTED_PLATFORMS_BY_TYPE[id] || []).filter((p) => !p.isOther))?.id || "");
    setKeyRef("");
    setScopeChoice(null);
    setImportCopy(false);
    setToolFiles([]);
  };
  const pickAssistant = (a) => {
    setPickedId(a.id);
    setName(a.name);
    /* The number it answers on is the one a phone simulation dials. */
    const parts = phoneParts(a.phone);
    setCountryIso(parts.countryIso);
    setContactNumber(parts.number);
  };

  const source = {
    kind: "platform",
    agentType,
    provider: platform?.id,
    agentId,
    ...(refOk && { apiKeyRef: savedRef }),
    ...(picked?.model && { model: picked.model }),
    observability: watch,
    ...(linkedRepo.trim() && { linkedRepo: linkedRepo.trim() }),
    name: name.trim(),
    versionNote: `Imported from ${platform?.name || "the platform"}.`,
    ...(lacksScope && scopeChoice === "mocked" && { replicationMode: "exported_mocked" }),
    ...(testing?.needsVersioning && versioningOn && { versioningOnAt: new Date().toISOString() }),
    ...(imported.retellKind && { retellKind: imported.retellKind }),
    ...(imported.members.length && { members: imported.members }),
    ...(sealed && { importedCopy: true, toolCodeUploaded: true, toolCodeFiles: toolFiles.map((f) => f.name) }),
    ...(voice ? {
      callDirection: inboundCalls ? "inbound" : "outbound",
      contact: {
        mode: simMode, inboundCalls, agentSpeaksFirst,
        ...(simMode === "phone" ? { countryIso, countryCode: COUNTRY_BY_ISO[countryIso]?.dial || "", number: contactNumber.trim() } : {}),
      },
      /* Reach the Agent step already asked — the confirm step adds the rest. */
      flowReach: { direction: inboundCalls ? "inbound" : "outbound", whoSpeaksFirst: agentSpeaksFirst ? "agent" : "caller" },
    } : {}),
  };
  const observeProject = prefill?.project || observeSlugOf(name.trim() || agentId);

  /* With a usable key, the account's assistants are listed right below. */
  useEffect(() => {
    if (!refOk || !platform) return undefined;
    setListing(true);
    const t = setTimeout(() => setListing(false), 700);
    return () => clearTimeout(t);
  }, [refOk, platform?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = {
    label: submitLabel,
    icon: "solar:link-circle-linear",
    disabled: !platform || !refOk || (lacksScope && !scopeChoice) || !agentId || (testing?.needsVersioning && !versioningOn),
    hint: !platform ? "No platform for this agent type yet" : !refOk ? "Add the key's reference"
      : lacksScope && !scopeChoice ? "Choose how to go on without create scope" : !agentId ? "Pick the agent"
        : "Switch versioning on for the agent first",
    onClick: () => onSave({ ...source, name: (name || picked?.name || "").trim() }),
  };

  return (
    <ConnectSteps
      title={title}
      subtitle="An assistant on a managed platform. Add the key, pick the assistant — its config comes in as v1. Everything else can wait for the agent's page."
      steps={STEPS}
      active={0}
      next={next}
    >
      <Stack spacing={1.75}>
        {!lockedType && <Box>
          <Label>Agent type</Label>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 0.75 }}>
            {AGENT_TYPES.map((t) => (
              <ChipCard key={t.id} icon={t.icon} label={t.label} comingSoon={t.comingSoon} on={agentType === t.id} onClick={() => pickType(t.id)} />
            ))}
          </Box>
        </Box>}
        <Box>
          <Label>Platform</Label>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 0.75 }}>
            {platforms.map((p) => (
              <ChipCard
                key={p.id}
                logo={<PlatformLogo id={p.id} name={p.name} brand={p.brand} />}
                label={PLATFORM_LOGOS[p.id]?.type === "wordmark" ? null : p.name}
                comingSoon={p.comingSoon}
                on={platform?.id === p.id}
                onClick={() => { setPlatformId(p.id); setPickedId(null); setVersioningOn(false); setImportCopy(false); setToolFiles([]); }}
              />
            ))}
          </Box>
          {!platform && (
            <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 1 }}>
              None for this agent type yet — connect it by its endpoint.
            </Typography>
          )}
          {platform?.idNote && (
            <Typography component="div" sx={{ typography: "s3", color: "text.subtitle", mt: 0.75 }}><NoteLine text={platform.idNote} /></Typography>
          )}
        </Box>
        {platform && (
          <SecretRefField
            label={platform.keyLabel || "API key"}
            required
            placeholder={`vault://acme/sim/${platform.id}_api_key`}
            value={keyRef} onChange={(v) => { setKeyRef(v); setScopeChoice(null); }}
            helper={initial?.keyFrom && keyRef === initial.apiKeyRef
              ? <>{`The key your ${initial.keyFrom} already uses. `}<PlatformKeyScope prototypeHint={canCloneProvider(platform.id)} /></>
              : <PlatformKeyScope prototypeHint={canCloneProvider(platform.id)} />}
          />
        )}

        {platform && refOk && (listing ? (
          <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 1.25, borderRadius: 1, bgcolor: "background.neutral" }}>
            <CircularProgress size={13} thickness={5} sx={{ color: "text.subtitle" }} />
            <Typography sx={{ typography: "s2", color: "text.secondary" }}>{`Listing assistants on ${platform.name}…`}</Typography>
          </Stack>
        ) : (
          <>
            {lacksScope && (
              <CloneScopeChoice
                providerName={platform?.name}
                choice={scopeChoice}
                onReissue={() => { setKeyRef(""); setScopeChoice(null); }}
                onMocked={() => setScopeChoice("mocked")}
              />
            )}
            {typing ? (
              <Box>
                <Field
                  label={platform?.idLabel || "Agent ID"}
                  required mono
                  placeholder={platform?.idPlaceholder}
                  value={typedId} onChange={setTypedId}
                  helper={`The ID from the ${platform?.name} dashboard.`}
                />
                <TextLink onClick={() => setTyping(false)} sx={{ mt: 0.75 }}>Pick from the list instead</TextLink>
              </Box>
            ) : (
              <Box>
                <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 0.75 }}>
                  <Typography sx={{ typography: "s2", fontWeight: 700 }}>Pick the agent</Typography>
                  <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
                    {`${assistants.length} on this ${platform?.name} account`}
                  </Typography>
                </Stack>
                <AssistantTable assistants={assistants} voice={voice} pickedId={picked?.id} onPick={pickAssistant} />
                <TextLink onClick={() => setTyping(true)} sx={{ mt: 0.75 }}>Not listed? Enter an ID instead</TextLink>
              </Box>
            )}
            {agentId && imported.structure && (
              <Typography component="div" sx={{ typography: "s3", color: "text.secondary" }}>
                <HintLine
                  hint={platform?.id === "retell" ? (imported.retellKind === "conversation_flow"
                    ? "Each node's instructions come in as a member, and improvements can propose changes node by node."
                    : "One prompt for the whole call.") : null}
                >
                  {`Read from ${platform?.name}: ${imported.structure}.`}
                </HintLine>
              </Typography>
            )}
            {/* Only what blocks testing at all is asked here (ElevenLabs needs versioning on). */}
            {testing?.needsVersioning && <PlatformTestingStep provider={platform.id} versioningOn={versioningOn} onVersioningOn={setVersioningOn} />}
            {agentId && (
              <Typography component="div" sx={{ typography: "s3", color: "text.subtitle" }}>
                <HintLine hint={`We pull its real traffic from ${platform?.name} with the same key, so failures show up in the Error Feed.`}>
                  {`Its production ${voice ? "calls" : "conversations"} land in Observe project ${observeProject} — change it, and how simulations reach it, on the agent's page.`}
                </HintLine>
              </Typography>
            )}
          </>
        ))}
      </Stack>
    </ConnectSteps>
  );
}

HostedAgentFlow.propTypes = {
  title: PropTypes.string,
  /* Set when connecting for one environment — the type is fixed, not a choice. */
  lockedType: PropTypes.string,
  initial: PropTypes.object,
  limits: PropTypes.object.isRequired,
  onLimits: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  onSwitch: PropTypes.func,
  profile: PropTypes.object.isRequired,
  onProfile: PropTypes.func.isRequired,
  prefill: PropTypes.object,
};

/*
  The optional sealed path for Vapi and Retell: import a copy of the
  assistant into our sandbox and upload the code behind its tools, so the
  tools answer from the seeded world instead of your real systems. Built-in
  platform actions aren't tool code, so they still run for real.
*/
function SandboxImport({ providerName, on, onToggle, files, onFiles }) {
  const add = (list) => {
    const added = Array.from(list || []).map((f) => ({ name: f.name, size: f.size }));
    onFiles([...files, ...added.filter((a) => !files.some((f) => f.name === a.name))]);
  };
  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 1.75, py: 1.25 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ typography: "s2", fontWeight: 700 }}>Also upload the code behind your tools → test a sealed copy</Typography>
          <Typography component="div" sx={{ typography: "s3", color: "text.subtitle", mt: 0.25 }}>
            <HintLine hint={`We import a copy of the ${providerName || "platform"} assistant into our sandbox and run your tool code against the seeded world. Results carry the stronger Sealed proof.`}>
              Optional · nothing reaches your real systems
            </HintLine>
          </Typography>
        </Box>
        <Button
          size="small" variant={on ? "outlined" : "text"}
          onClick={() => onToggle(!on)}
          sx={{ typography: "s2", fontWeight: 700, flexShrink: 0, color: on ? "text.primary" : "text.secondary" }}
        >
          {on ? "Don't import" : "Import a copy"}
        </Button>
      </Stack>
      {on && (
        <Stack spacing={1} sx={{ px: 1.75, py: 1.25, borderTop: "1px solid", borderColor: "divider" }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Button component="label" size="small" variant="outlined" startIcon={<Iconify icon="solar:cloud-upload-linear" width={14} />} sx={{ typography: "s2", fontWeight: 700 }}>
              Choose tool code
              <input hidden multiple type="file" onChange={(e) => add(e.target.files)} />
            </Button>
            <Typography sx={{ typography: "s3", color: "text.subtitle" }}>The handlers your tools&apos; server URLs call · .py .ts .js .zip</Typography>
          </Stack>
          {files.map((f) => (
            <Stack key={f.name} direction="row" alignItems="center" spacing={1} sx={{ px: 1, py: 0.5, borderRadius: 1, bgcolor: (t) => alpha(t.palette.text.primary, 0.04) }}>
              <Iconify icon="solar:document-linear" width={13} sx={{ color: "text.subtitle" }} />
              <Typography noWrap sx={{ typography: "s2", fontFamily: MONO, flex: 1, minWidth: 0 }}>{f.name}</Typography>
              <IconButton size="small" onClick={() => onFiles(files.filter((x) => x.name !== f.name))}>
                <Iconify icon="solar:trash-bin-minimalistic-linear" width={13} sx={{ color: "text.subtitle" }} />
              </IconButton>
            </Stack>
          ))}
          <Typography component="div" sx={{ typography: "s3", color: "text.secondary" }}>
            <HintLine hint="Transfers, end call and voicemail aren't your code, so they still run for real in an imported copy. Scenarios that transfer place a real transfer.">
              Built-in platform actions still run for real.
            </HintLine>
          </Typography>
        </Stack>
      )}
    </Box>
  );
}
SandboxImport.propTypes = { providerName: PropTypes.string, on: PropTypes.bool, onToggle: PropTypes.func, files: PropTypes.array, onFiles: PropTypes.func };

/* The account's agents as a table: what it's called, the number it answers
   on (voice), and when it last changed — enough to tell two apart. */
function AssistantTable({ assistants, voice, pickedId, onPick }) {
  /* A radio first, so the rows read as a single choice. */
  const cols = voice ? "18px minmax(0, 1fr) 150px 110px" : "18px minmax(0, 1fr) 110px";
  const head = { typography: "s3", fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "text.subtitle" };
  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
      <Box sx={{ display: "grid", gridTemplateColumns: cols, columnGap: 2, px: 1.5, py: 0.75, bgcolor: "background.neutral", borderBottom: "1px solid", borderColor: "divider" }}>
        <Box />
        <Typography sx={head}>Agent</Typography>
        {voice && <Typography sx={head}>Phone number</Typography>}
        <Typography sx={head}>Last updated</Typography>
      </Box>
      {assistants.map((a, i) => {
        const on = a.id === pickedId;
        return (
          <Box
            key={a.id}
            role="radio"
            aria-checked={on}
            tabIndex={0}
            onClick={() => onPick(a)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(a); } }}
            sx={{
              display: "grid", gridTemplateColumns: cols, columnGap: 2, alignItems: "center",
              px: 1.5, py: 1, cursor: "pointer",
              borderTop: i ? "1px solid" : "none", borderColor: "divider",
              bgcolor: (t) => (on ? alpha(t.palette.text.primary, t.palette.mode === "dark" ? 0.06 : 0.03) : "transparent"),
              "&:hover": { bgcolor: (t) => alpha(t.palette.text.primary, t.palette.mode === "dark" ? 0.05 : 0.025) },
            }}
          >
            <Box
              sx={{
                width: 16, height: 16, borderRadius: "50%", display: "grid", placeItems: "center",
                border: "1.5px solid", borderColor: on ? "text.primary" : "text.disabled",
              }}
            >
              {on && <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "text.primary" }} />}
            </Box>
            <Box minWidth={0}>
              <Typography noWrap sx={{ typography: "s2", fontWeight: 600 }}>{a.name}</Typography>
              <Typography noWrap sx={{ typography: "s3", color: "text.subtitle", fontFamily: MONO }}>{a.id}</Typography>
            </Box>
            {voice && (
              <Typography noWrap sx={{ typography: "s2", fontFamily: a.phone ? MONO : "inherit", color: a.phone ? "text.primary" : "text.subtitle" }}>
                {a.phone || "Web only"}
              </Typography>
            )}
            <Typography noWrap sx={{ typography: "s3", color: "text.subtitle" }}>{a.updated}</Typography>
          </Box>
        );
      })}
    </Box>
  );
}
AssistantTable.propTypes = { assistants: PropTypes.array, voice: PropTypes.bool, pickedId: PropTypes.string, onPick: PropTypes.func };
