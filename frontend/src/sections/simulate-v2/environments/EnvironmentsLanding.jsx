import PropTypes from "prop-types";
import { Suspense, lazy, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Stack, Typography } from "@mui/material";
import { paths } from "src/routes/paths";
import {
  detectPaste,
  prebuiltWorlds, worldTotal,
} from "./landingData";
import { connectGroupsFor } from "../agents/connect/agentConnectData";
import { AGENT_TYPES } from "./connectOptions";
import ChipCard from "./ChipCard";
import { SectionHead, WorldCard } from "./LandingBits";
import { Directory, PasteBar } from "./ConnectDirectory";
import { OUTLINE_BTN, focusRing } from "./landingStyles";
import WorldDrawer from "./WorldDrawer";
import SaasSandboxRow from "./SaasSandbox";
import { ConnectSubmitContext } from "../agents/connect/connectSubmit";
import { useSaveConnectedAgent } from "../agents/connect/useSaveConnectedAgent";
import { clickable } from "../components/clickable";

/*
  The Environments landing screen — every way in, in the order people reach
  for them:

    1. Paste anything: a repository, an assistant ID, an MCP URL, an
       endpoint. We say what it is and open the right setup, filled in.
    2. Seeds: a world with a stand-in agent and a finished demo run. Nothing
       to connect — open the run, or start your own copy.
    3. Connect your agent: a directory by where the agent lives, each group
       saying how we test it there and how far a fix can go.
    4. Prebuilt worlds: tables, tools and rules already seeded; bring the agent.
    5. Web environments: live SaaS sandboxes.

  Picking anything calls `onPick(choice, prefill, from, itemId, meta)`; the
  page opens the matching setup in a drawer, so the list stays put.

  One way to connect an agent: Agents is its home (RSI PRD), so a new agent —
  pasted or picked from the directory — is connected in Agents → New agent
  (source, what we found, Observe project, constraints), which comes back
  here with it picked. The directory is the same one Agents shows. Only an
  MCP server's tools, which aren't an agent, start an environment here.
*/

/* Loaded on demand: the picker reaches back into StartEnvironment (FlowPanel),
   and a static import here would close a cycle through this file. */
const ConnectAgentPicker = lazy(() => import("../agents/connect/ConnectAgentPicker"));

/* Pasted things that are agents, and the Agents flow each opens. */
const AGENT_KIND_OF = { hosted: "hosted", source: "repo", running: "running", phone: "phone", scratch: "builtin" };
/* Agents → New agent on that source, coming back here with the new agent. */
const connectUrl = ({ kind, initial, id, meta }) => {
  const q = new URLSearchParams({ src: kind, item: id || kind, return: `${paths.dashboard.simulate.environments}?agent={agent}` });
  if (initial) q.set("init", JSON.stringify(initial));
  if (meta?.name) q.set("name", meta.name);
  if (meta?.logo) q.set("logo", meta.logo);
  return `${paths.dashboard.agents}/connect?${q.toString()}`;
};
export default function EnvironmentsLanding({ onPick, onBrowseWorlds, picked, examplesRef: givenExamplesRef, onAgentConnected }) {
  const navigate = useNavigate();
  /* Connecting an agent happens here, in a drawer over this page — the same
     flows Agents → New agent uses. Once it's saved its environment builds. */
  const saveAgent = useSaveConnectedAgent();
  const [connectReq, setConnectReq] = useState(null);
  const openConnect = (kind, initial, id, meta) => {
    if (!onAgentConnected) { navigate(connectUrl({ kind, initial, id, meta })); return; }
    setConnectReq({ kind, initial: initial || null, id, meta: meta || {}, at: Date.now() });
  };
  const onConnected = (source) => {
    const { id } = saveAgent(source);
    onAgentConnected?.(id);
  };
  /* Prebuilt worlds sit where the ready-made examples were; "No agent yet?" lands there. */
  const ownWorldsRef = useRef(null);
  const worldsRef = givenExamplesRef || ownWorldsRef;
  const connectRef = useRef(null);
  const scrollTo = (ref) => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <Stack spacing={4} sx={{ pb: 4 }}>
      <PasteBar
        detect={detectPaste}
        onPick={(choice, prefill, meta) => {
          const kind = AGENT_KIND_OF[choice];
          if (!kind) { onPick(choice, prefill, "paste", null, meta); return; }
          openConnect(kind, choice === "scratch" ? { prompt: prefill?.flowText || "" } : prefill, "paste", meta);
        }}
      />

      <PrebuiltSection sectionRef={worldsRef} onBrowse={onBrowseWorlds} />

      <ConnectSection
        sectionRef={connectRef}
        pickedId={picked?.from === "directory" ? picked.itemId : null}
        onPick={(item, prefill) => onPick(item.choice, prefill ?? item.prefill ?? null, "directory", item.id, { name: item.name, logo: item.logo, icon: item.icon })}
        onConnect={(item) => openConnect(item.kind, item.initial || null, item.id, { name: item.name, logo: item.logo, icon: item.icon })}
        onTools={() => onPick("mcp", null, "directory", "mcp", { name: "MCP server", logo: "mcp" })}
        onSample={() => scrollTo(worldsRef)}
      />

      {/* The connect flow's drawer, opened in place. */}
      {connectReq && (
        <Suspense fallback={null}>
          <ConnectSubmitContext.Provider value="Connect and build environment">
            <ConnectAgentPicker catalogue={false} request={connectReq} onConnect={onConnected} />
          </ConnectSubmitContext.Provider>
        </Suspense>
      )}

    </Stack>
  );
}
EnvironmentsLanding.propTypes = {
  onPick: PropTypes.func.isRequired,
  /* Called with a newly connected agent's id — its environment then builds. */
  onAgentConnected: PropTypes.func,
  onBrowseWorlds: PropTypes.func,
  examplesRef: PropTypes.object,
  picked: PropTypes.object,
};


/* ── shared bits ───────────────────────────────────────────────────────── */


/* ── 3. connect your agent ─────────────────────────────────────────────── */

const linkSx = { color: "text.primary", fontWeight: 600, cursor: "pointer", "&:hover": { textDecoration: "underline" } };

/* Agents already connected aren't repeated here — Agents has them, with Build environment on each. */
/* Building on your own machine is an environment setup, not an agent to connect — only here. */
const LOCAL_ITEM = { id: "local", name: "Your own machine", icon: "solar:laptop-minimalistic-linear", need: "Build locally over a secure tunnel", choice: "local" };
/* The landing's columns for one agent type (or all): only the ways that
   can bring that type, each opening with the type set. */
const landingGroups = (type) => connectGroupsFor(type).map((g) => (g.id === "other" ? { ...g, items: [...g.items, LOCAL_ITEM] } : g));

function ConnectSection({ sectionRef, onPick, onConnect, onTools, onSample }) {
  const [type, setType] = useState(null);
  const groups = useMemo(() => landingGroups(type), [type]);
  return (
    <Directory
      sectionRef={sectionRef}
      perGroup={5}
      title="Connect your agent"
      subtitle="Pick where it runs today — it joins Agents, then you build its environment here."
      groups={groups}
      topBand={(
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, px: 2, py: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
          <ChipCard label="All types" on={!type} onClick={() => setType(null)} />
          {AGENT_TYPES.map((t) => (
            <ChipCard key={t.id} icon={t.icon} label={t.label} comingSoon={t.comingSoon} on={type === t.id} onClick={() => setType(t.id)} />
          ))}
        </Box>
      )}
      onPick={(item) => (item.choice ? onPick(item) : onConnect(item))}
      emptyHint="If it runs somewhere we can call, connect it as an agent endpoint — or paste its link above."
      footer={(
        <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
          {"Only have tools? "}
          <Box component="span" {...clickable(onTools)} sx={{ ...linkSx, "&:focus-visible": focusRing }}>Use an MCP server</Box>
          {" · No agent yet? "}
          <Box component="span" {...clickable(onSample)} sx={{ ...linkSx, "&:focus-visible": focusRing }}>Start from a prebuilt world</Box>
        </Typography>
      )}
    />
  );
}
ConnectSection.propTypes = {
  sectionRef: PropTypes.object, pickedId: PropTypes.string, onPick: PropTypes.func.isRequired,
  onConnect: PropTypes.func.isRequired, onTools: PropTypes.func, onSample: PropTypes.func,
};

/* ── 4. prebuilt worlds ────────────────────────────────────────────────── */

function PrebuiltSection({ sectionRef, onBrowse }) {
  const worlds = useMemo(() => prebuiltWorlds(), []);
  /* Three upfront, each a different agent type — the rest are in Browse all. */
  const featured = useMemo(() => {
    const seen = new Set();
    return worlds.filter((w) => (seen.has(w.type) ? false : seen.add(w.type))).slice(0, 3);
  }, [worlds]);
  const [open, setOpen] = useState(null);
  return (
    <Box ref={sectionRef} sx={{ scrollMarginTop: 16 }}>
      <SectionHead
        title="Use a prebuilt world"
        subtitle="Tables, tools and rules, ready to run. Connect your agent — a placeholder stands in until you do."
        action={(
          <Button size="small" variant="outlined" onClick={onBrowse} sx={OUTLINE_BTN}>
            {`Browse all ${worldTotal()}`}
          </Button>
        )}
      />
      <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "repeat(3, 1fr)" } }}>
        {featured.map((w) => <WorldCard key={w.id} world={w} onOpen={setOpen} selected={open?.id === w.id} />)}
      </Box>
      {/* Or no made-up world at all: the agent's own apps, sandboxed. */}
      <Box sx={{ mt: 1.5 }}>
        <SaasSandboxRow />
      </Box>
      <WorldDrawer world={open} onClose={() => setOpen(null)} />
    </Box>
  );
}
PrebuiltSection.propTypes = { sectionRef: PropTypes.object, onBrowse: PropTypes.func };

/* ── web environments, as one world card ────────────────────────────── */

