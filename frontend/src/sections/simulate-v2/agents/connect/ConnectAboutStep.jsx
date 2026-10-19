import PropTypes from "prop-types";
import { useState } from "react";
import { alpha } from "@mui/material/styles";
import { Box, Stack, TextField, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { useConnectedAgents, useSimStore } from "../../store";
import { LANGUAGE_OPTIONS, observeProjectById, observeSlugOf, resolveObserve } from "../../_mock/connectAgent";
import { knownProjects, projectLinkOf } from "../../_mock/projectLinks";
import { ChipCard, Field, SegmentedToggle } from "../../environments/StartEnvironment";
import { HintLine } from "./replicationBits";

const MONO = "ui-monospace, Menlo, monospace";
const HEAD = { typography: "s3", fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "text.subtitle" };
const selectedBg = (t) => alpha(t.palette.text.primary, t.palette.mode === "dark" ? 0.06 : 0.03);

/* A quiet tag — "From the issue", "Phase 2" — the label does the work. */
function Tag({ children }) {
  return (
    <Typography noWrap component="span" sx={{ typography: "s3", fontSize: 11, fontWeight: 600, color: "text.subtitle", px: 0.5, borderRadius: 0.5, border: "1px solid", borderColor: "divider", lineHeight: "16px", flexShrink: 0 }}>
      {children}
    </Typography>
  );
}
Tag.propTypes = { children: PropTypes.node };

/**
 * Observe — where the agent's production traces land, before its
 * constraints. Pick a project that already receives them, or create one
 * named after the agent. Linking is per project: Error Feed groups failures
 * by project, and Fix finds the agent for every issue from it. A project the
 * "Connect a new agent" link (in Fix) came from is picked already.
 */
export function ObserveProjectStep({ agentName, agentKey, value, onChange, prefillProject, issue }) {
  const { state } = useSimStore();
  const { agents } = useConnectedAgents();
  const [query, setQuery] = useState("");
  const chosen = resolveObserve(value, prefillProject, agentName);
  const creating = chosen.mode === "create";
  /* A new project's default name — never one Observe already has. */
  const taken = new Set(knownProjects(state, agents).map((p) => p.id));
  const freeSlug = (base) => { let n = 1; let id = base; while (taken.has(id)) { n += 1; id = `${base}-${n}`; } return id; };
  const createId = creating ? chosen.id : freeSlug(observeSlugOf(agentName));
  /* What each project traces now — a project has one agent, so picking one
     that has another moves it here. This agent's own link reads as such. */
  const linkOf = (id) => projectLinkOf(id, state, agents);
  const prefillUnknown = prefillProject && !observeProjectById(prefillProject);
  /* The picked one first (so a suggestion is in view), then unlinked
     projects — the likeliest home for a new agent. */
  const pickedId = chosen.mode === "existing" ? chosen.id : null;
  const known = knownProjects(state, agents)
    .sort((a, b) => (b.id === pickedId) - (a.id === pickedId) || (a.link.status === "linked") - (b.link.status === "linked"));
  const projects = prefillUnknown ? [{ id: prefillProject, name: prefillProject, traces: "From the Error Feed", issues: null }, ...known] : known;
  const q = query.trim().toLowerCase();
  const shown = q ? projects.filter((p) => `${p.name} ${p.id}`.toLowerCase().includes(q)) : projects;

  return (
    <Stack spacing={1.5}>
      <Typography component="div" sx={{ typography: "s2", color: "text.secondary" }}>
        <HintLine hint="Error Feed groups failures by Observe project, and fixes find the agent through this link — for every issue from the project, today's and future ones.">
          Where this agent&apos;s production traces land.
        </HintLine>
      </Typography>

      {/* A new project — its own kind of choice, not one more row in the list. */}
      <Box
        role="radio" aria-checked={creating} tabIndex={0}
        onClick={() => !creating && onChange({ mode: "create", id: createId })}
        onKeyDown={(e) => { if (!creating && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onChange({ mode: "create", id: createId }); } }}
        sx={{
          px: 1.5, py: 1.25, borderRadius: 1, cursor: creating ? "default" : "pointer",
          border: "1px dashed", borderColor: creating ? "text.primary" : "text.disabled",
          bgcolor: (t) => (creating ? selectedBg(t) : "transparent"),
          "&:hover": creating ? {} : { borderColor: "text.secondary" },
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <Iconify icon="solar:add-circle-linear" width={18} sx={{ color: "text.primary", flexShrink: 0 }} />
          <Box flex={1} minWidth={0}>
            <Typography sx={{ typography: "s2", fontWeight: 700 }}>Create a new project</Typography>
            <Typography sx={{ typography: "s3", color: "text.subtitle" }}>For an agent whose traces don&apos;t land anywhere yet — they start once tracing is on.</Typography>
          </Box>
          {creating && <Iconify icon="solar:check-circle-bold" width={16} sx={{ color: "text.primary", flexShrink: 0 }} />}
        </Stack>
        {creating && (
          <TextField
            size="small" fullWidth autoFocus
            value={createId}
            onChange={(e) => onChange({ mode: "create", id: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            placeholder="project-name"
            helperText="The project's name in Observe"
            sx={{ mt: 1.25, "& .MuiInputBase-input": { typography: "s2", fontFamily: MONO } }}
          />
        )}
      </Box>

      {/* Or an existing project — a list to pick from. */}
      <Box>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
          <Typography sx={{ ...HEAD, flex: 1 }}>{`Or use an existing project · ${projects.length}`}</Typography>
          {projects.length > 5 && (
            <TextField
              size="small" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search projects"
              InputProps={{ startAdornment: <Iconify icon="eva:search-fill" width={14} sx={{ color: "text.disabled", mr: 0.75 }} /> }}
              sx={{ width: 220, "& .MuiInputBase-root": { height: 30 }, "& .MuiInputBase-input": { typography: "s3" } }}
            />
          )}
        </Stack>
        <Stack spacing={0.75} role="radiogroup" aria-label="Observe project" sx={{ maxHeight: 300, overflowY: "auto", pr: 0.5 }}>
          {shown.map((p) => {
            const link = linkOf(p.id);
            const mine = link.status === "linked" && agentKey && link.agent?.key === agentKey;
            const other = link.status === "linked" && !mine ? `traces ${link.agent?.name || "another agent"} — picking it moves it here` : null;
            return (
              <ProjectRow
                key={p.id}
                on={!creating && chosen.id === p.id}
                onClick={() => onChange({ mode: "existing", id: p.id })}
                icon="solar:graph-new-linear"
                title={p.name}
                mono={p.id}
                meta={[p.traces, p.issues != null && `${p.issues} open issue${p.issues === 1 ? "" : "s"} in Error Feed`, other].filter(Boolean).join(" · ")}
                tag={p.id === prefillProject ? (issue ? `From ${issue}` : "From the issue") : mine ? "Linked now" : null}
              />
            );
          })}
          {!shown.length && <Typography sx={{ typography: "s3", color: "text.subtitle", px: 0.5 }}>No project matches.</Typography>}
        </Stack>
      </Box>
    </Stack>
  );
}
ObserveProjectStep.propTypes = {
  agentName: PropTypes.string,
  /* The agent being linked — its own current project reads "Linked now". */
  agentKey: PropTypes.string,
  /* { mode: "existing" | "create", id } — null until something is picked. */
  value: PropTypes.object,
  onChange: PropTypes.func.isRequired,
  prefillProject: PropTypes.string,
  issue: PropTypes.string,
};

function ProjectRow({ on, onClick, icon, title, mono, meta, tag }) {
  return (
    <Stack
      direction="row" alignItems="center" spacing={1.25}
      role="radio" aria-checked={on} tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      sx={{
        px: 1.5, py: 1, borderRadius: 1, cursor: "pointer", border: "1px solid",
        borderColor: on ? "text.primary" : "divider",
        bgcolor: (t) => (on ? selectedBg(t) : "transparent"),
      }}
    >
      <Iconify icon={icon} width={16} sx={{ color: "text.secondary", flexShrink: 0 }} />
      <Box flex={1} minWidth={0}>
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
          <Typography noWrap sx={{ typography: "s2", fontWeight: 600, minWidth: 0 }}>{title}</Typography>
          <Typography noWrap sx={{ typography: "s3", color: "text.subtitle", fontFamily: MONO, minWidth: 0 }}>{mono}</Typography>
          {tag && <Tag>{tag}</Tag>}
        </Stack>
        <Typography noWrap sx={{ typography: "s3", color: "text.subtitle" }}>{meta}</Typography>
      </Box>
      {on && <Iconify icon="solar:check-circle-bold" width={16} sx={{ color: "text.primary", flexShrink: 0 }} />}
    </Stack>
  );
}
ProjectRow.propTypes = { on: PropTypes.bool, onClick: PropTypes.func, icon: PropTypes.string, title: PropTypes.node, mono: PropTypes.string, meta: PropTypes.node, tag: PropTypes.node };

/**
 * A hosted agent's Observe project needs no step: the key pulls its calls,
 * so it's linked the moment it's connected — said, with the project's name.
 */
export function ObserveLinkedRow({ project, on }) {
  const p = observeProjectById(project);
  return (
    <Stack direction="row" alignItems="center" spacing={1.25} sx={{ px: 1.75, py: 1.125, borderRadius: 1, border: "1px solid", borderColor: "divider" }}>
      <Iconify icon="solar:graph-new-linear" width={16} sx={{ color: "text.secondary", flexShrink: 0 }} />
      <Box flex={1} minWidth={0}>
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
          <Typography noWrap sx={{ typography: "s2", fontWeight: 700 }}>Observe project</Typography>
          <Typography noWrap sx={{ typography: "s3", color: "text.subtitle", fontFamily: MONO, minWidth: 0 }}>{project}</Typography>
        </Stack>
        <Typography noWrap sx={{ typography: "s3", color: "text.subtitle" }}>
          {on
            ? `${p ? p.name : "Created with the agent"} · its Error Feed issues are found and fixed here`
            : "Not linked — link a project on the agent's Connections tab."}
        </Typography>
      </Box>
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ color: on ? "text.primary" : "text.subtitle", flexShrink: 0 }}>
        <Iconify icon={on ? "solar:link-circle-linear" : "solar:link-broken-linear"} width={14} />
        <Typography noWrap sx={{ typography: "s3", fontWeight: 600 }}>{on ? "Linked" : "Not linked"}</Typography>
      </Stack>
    </Stack>
  );
}
ObserveLinkedRow.propTypes = { project: PropTypes.string, on: PropTypes.bool };

/* One labelled row of the About table — label left, controls right. */
function AboutRow({ label, hint, first, children }) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }} spacing={{ xs: 0.5, sm: 2 }} alignItems={{ sm: "flex-start" }}
      sx={{ px: 1.75, py: 1.25, borderTop: first ? "none" : "1px solid", borderColor: "divider" }}
    >
      <Box sx={{ width: { sm: 140 }, flexShrink: 0, pt: "6px" }}>
        <Typography sx={{ typography: "s2", color: "text.subtitle" }}>{label}</Typography>
      </Box>
      <Box flex={1} minWidth={0}>
        {children}
        {hint && <Typography component="div" sx={{ typography: "s3", color: "text.subtitle", mt: 0.5 }}>{hint}</Typography>}
      </Box>
    </Stack>
  );
}
AboutRow.propTypes = { label: PropTypes.string, hint: PropTypes.node, first: PropTypes.bool, children: PropTypes.node };

function NumberInput({ value, onChange, suffix, label }) {
  return (
    <TextField
      size="small"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
      inputProps={{ inputMode: "numeric", "aria-label": label }}
      InputProps={{ endAdornment: <Typography sx={{ typography: "s3", color: "text.subtitle", ml: 0.5, whiteSpace: "nowrap" }}>{suffix}</Typography> }}
      sx={{ width: 170, "& .MuiInputBase-input": { typography: "s2", fontVariantNumeric: "tabular-nums" } }}
    />
  );
}
NumberInput.propTypes = { value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]), onChange: PropTypes.func, suffix: PropTypes.string, label: PropTypes.string };

const CHANNEL_OPTIONS = [
  { value: "voice", label: "Voice" },
  { value: "chat", label: "Chat" },
  { value: "both", label: "Both" },
];

/**
 * Who the agent is and how it's reached: owner (you, unless changed), the
 * languages it speaks, a line on what it does; voice, chat or both; and the
 * reach for each channel — voice: direction, who speaks first, conversations
 * at once; chat: who writes first, turn limit. `reachLocked` hides what an
 * earlier step already asked (a hosted voice agent's direction and opening).
 */
export function AgentAboutFields({ value, onChange, defaultChannel = "chat", reachLocked }) {
  const channels = value.channels?.length ? value.channels : [defaultChannel];
  const channelValue = channels.length > 1 ? "both" : channels[0];
  const voice = channels.includes("voice");
  const chat = channels.includes("chat");
  const reach = value.reach || {};
  const set = (patch) => onChange({ ...value, ...patch });
  const setReach = (patch) => set({ reach: { ...reach, ...patch } });
  const toggleLanguage = (code) => {
    const list = value.languages || [];
    const next = list.includes(code) ? list.filter((c) => c !== code) : [...list, code];
    /* An agent speaks at least one language. */
    if (next.length) set({ languages: next });
  };

  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
      <AboutRow label="Owner" first hint="Asked about its issues and improvements.">
        <Box sx={{ maxWidth: 360 }}>
          <Field value={value.owner || ""} onChange={(v) => set({ owner: v })} placeholder="Name or team" />
        </Box>
      </AboutRow>
      <AboutRow label="What it does" hint="One or two lines, shown on the agent page.">
        <Field
          value={value.description || ""} onChange={(v) => set({ description: v.slice(0, 280) })}
          placeholder="e.g. Takes return and refund calls for the US store; hands chargebacks to a person."
          multiline minRows={2}
        />
      </AboutRow>
      <AboutRow label="Languages" hint={<HintLine hint="Scenarios are written in these.">A reply in another language counts as a failure.</HintLine>}>
        <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
          {LANGUAGE_OPTIONS.map((l) => (
            <ChipCard key={l.code} label={l.label} on={(value.languages || []).includes(l.code)} onClick={() => toggleLanguage(l.code)} />
          ))}
        </Stack>
      </AboutRow>
      <AboutRow
        label="Channels"
        hint={channels.length > 1 ? "We'll build an environment per channel." : "Takes the other channel too? Choose Both."}
      >
        <SegmentedToggle
          value={channelValue}
          onChange={(v) => set({ channels: v === "both" ? ["voice", "chat"] : [v] })}
          options={CHANNEL_OPTIONS}
        />
      </AboutRow>
      {voice && (
        <AboutRow
          label={chat ? "Reach · voice" : "Reach"}
          hint={reachLocked ? "Direction, opening and number were set on the Agent step." : null}
        >
          <Stack spacing={1.25}>
            {!reachLocked && (
              <Stack direction={{ xs: "column", md: "row" }} spacing={{ xs: 1.25, md: 3 }}>
                <Box>
                  <Typography sx={{ typography: "s3", fontWeight: 600, mb: 0.5 }}>Direction</Typography>
                  <SegmentedToggle
                    value={reach.direction || "inbound"}
                    onChange={(v) => setReach({ direction: v })}
                    options={[{ value: "inbound", label: "Takes calls" }, { value: "outbound", label: "Places calls" }]}
                  />
                </Box>
                <Box>
                  <Typography sx={{ typography: "s3", fontWeight: 600, mb: 0.5 }}>Who speaks first</Typography>
                  <SegmentedToggle
                    value={reach.whoSpeaksFirst || "agent"}
                    onChange={(v) => setReach({ whoSpeaksFirst: v })}
                    options={[{ value: "agent", label: "The agent" }, { value: "caller", label: "The caller" }]}
                  />
                </Box>
              </Stack>
            )}
            <Box>
              <Typography sx={{ typography: "s3", fontWeight: 600, mb: 0.5 }}>Conversations at once</Typography>
              <NumberInput label="Maximum conversations at once" value={reach.maxConcurrent} onChange={(v) => setReach({ maxConcurrent: v })} suffix="at most" />
              <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.5 }}>Simulations never place more calls than this at once.</Typography>
            </Box>
          </Stack>
        </AboutRow>
      )}
      {chat && (
        <AboutRow label={voice ? "Reach · chat" : "Reach"}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={{ xs: 1.25, md: 3 }}>
            <Box>
              <Typography sx={{ typography: "s3", fontWeight: 600, mb: 0.5 }}>Who writes first</Typography>
              <SegmentedToggle
                value={reach.whoWritesFirst || "user"}
                onChange={(v) => setReach({ whoWritesFirst: v })}
                options={[{ value: "user", label: "The user" }, { value: "agent", label: "The agent" }]}
              />
            </Box>
            <Box>
              <Typography sx={{ typography: "s3", fontWeight: 600, mb: 0.5 }}>Turn limit</Typography>
              <NumberInput label="Turn limit" value={reach.turnLimit} onChange={(v) => setReach({ turnLimit: v })} suffix="turns" />
            </Box>
          </Stack>
        </AboutRow>
      )}
    </Box>
  );
}
AgentAboutFields.propTypes = {
  /* { owner, languages, description, channels, reach } — see emptyProfile(). */
  value: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  defaultChannel: PropTypes.oneOf(["voice", "chat"]),
  reachLocked: PropTypes.bool,
};
