import PropTypes from "prop-types";
import { useEffect, useMemo, useState } from "react";
import { useSnackbar } from "notistack";
import { Box, Button, Dialog, Menu, MenuItem, Select, Stack, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import Iconify from "src/components/iconify";
import { diffLines, fileChanges } from "../_mock/agentFiles";
import { MONO, ORIGIN_LABEL, ago, parentLabel } from "./agentViewUtils";
import { clickable, focusRing } from "../components/clickable";
import { useConnectedAgents, useSimStore } from "../store";
import { RELEASE_WHEN, draftReleaseOf, releasedNote, rollbackVersionRecord, versionReleaseOf } from "./versionRelease";
import { pinsDiff, versionPinsOf } from "../_mock/versionPins";
import { versionNumber } from "../_mock/versions";
import { OUTSIDE_CHANGE_LABEL, isOutsideChange } from "../_mock/agentSync";
import { MAKE_ACTIVE_ADMIN_ONLY, activeVersionOf, currentWorkspaceRole } from "./agentProfile";
import { versionChecksLine, versionChecksOf } from "../_mock/versionChecks";


const TONE = { added: "#16A34A", changed: "text.secondary", removed: "#DC2626" };

/**
 * Every version, newest first, and a comparison between any two. Versions
 * are immutable — a change is always a new version — so the comparison is
 * the honest answer to "what's different about v3".
 */
export default function AgentVersionsTab({ agent, source, filesOf, toolsOf, statsOf, scopeName, onView, onRunIn, onMakeActive }) {
  const ordered = [...agent.versions].reverse();
  const { state, dispatch } = useSimStore();
  const { recordAgentVersion } = useConnectedAgents();
  const { enqueueSnackbar } = useSnackbar();
  /* "Roll back to vN" — asked first, then a new version is minted. */
  const [rollbackTo, setRollbackTo] = useState(null);
  const release = useMemo(() => versionReleaseOf(agent, state), [agent, state]);
  /* A built-in Future AGI agent runs here, so "released" is ours to say: a
     workspace admin makes a draft version active, and that's the release. */
  const builtin = source.kind === "builtin";
  const active = builtin ? activeVersionOf(agent, release) : null;
  const activeAt = builtin ? agent.versions.findIndex((x) => x.label === active) : -1;
  const isAdmin = currentWorkspaceRole() === "admin";
  /* What each version pins — commit / platform config / prompt revision, and
     its tool definitions. */
  const pins = useMemo(() => versionPinsOf({ agent, source, toolsOf }), [agent, source, toolsOf]);
  const labels = agent.versions.map((v) => v.label);
  const latest = labels[labels.length - 1];
  const [to, setTo] = useState(latest);
  const [from, setFrom] = useState(parentLabel(agent.versions, latest) || latest);
  /* A new version lands → compare it with what it was built on. */
  useEffect(() => {
    setTo(latest);
    setFrom(parentLabel(agent.versions, latest) || latest);
  }, [latest]); // eslint-disable-line react-hooks/exhaustive-deps

  const running = (label) => agent.usedIn.filter((u) => u.running === label);
  /* An older version can be put back in an environment — the header picker
     only changes what you're looking at. */
  const [runPick, setRunPick] = useState(null); // { anchor, label, envs }
  const runIn = (e, label, envs) => (envs.length === 1 ? onRunIn(envs[0].envId, label) : setRunPick({ anchor: e.currentTarget, label, envs }));

  const compare = useMemo(() => {
    if (from === to) return { changes: {}, a: [], b: [] };
    const a = filesOf(from);
    const b = filesOf(to);
    return { changes: fileChanges(a, b), a, b };
  }, [from, to, filesOf]);
  const changed = Object.entries(compare.changes);
  const [open, setOpen] = useState({});

  /* A new version with the older one's snapshot — a draft until released. */
  const rollBack = (label) => {
    const v = rollbackVersionRecord(agent, label, { toolsOf });
    recordAgentVersion(agent.key, v);
    setRollbackTo(null);
    enqueueSnackbar(
      `Saved as ${v.label}, rolled back to ${label} — a draft. Production stays on ${agent.production} until it's released.`,
      { variant: "success" },
    );
  };
  /* A draft — a roll back or an improvement's — is released by the person
     who shipped it: the user marks a version released. Released, it's the
     new baseline; an improvement's release is recorded where it was
     verified, so its issue moves on to Watching. Built-in agents use Make
     active instead. */
  const markReleased = (label) => {
    dispatch({ type: "updateAgentVersion", key: agent.key, label, patch: { status: "released", releasedAt: new Date().toISOString() } });
    const home = draftReleaseOf(agent, state, label);
    if (home) dispatch({ type: "patchEnvState", envId: home.envId, patch: home.patch });
    enqueueSnackbar(`${label} is released — the new baseline. Environments following production test it on their next run; pinned ones stay put.`, { variant: "success" });
  };

  return (
    <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", lg: "minmax(340px, 420px) 1fr" }, alignItems: "start" }}>
      {/* ── timeline ── */}
      <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1.5, bgcolor: "background.paper" }}>
        <Typography sx={{ px: 2, py: 1.5, typography: "s2", fontWeight: 700, borderBottom: "1px solid", borderColor: "divider" }}>
          {`${agent.versions.length} version${agent.versions.length === 1 ? "" : "s"}`}
        </Typography>
        <Box sx={{ px: 2, py: 1.75 }}>
          {ordered.map((v, i) => {
            const isLatest = i === 0;
            const envs = running(v.label);
            const others = agent.usedIn.filter((u) => u.running !== v.label);
            const stats = statsOf(v.label);
            /* Built-in: newer than the active version, or made by an improvement and not released. */
            const draft = builtin && v.label !== active
              && (agent.versions.findIndex((x) => x.label === v.label) > activeAt || (release[v.label]?.from && !release[v.label]?.released));
            /* A draft is never what an environment tests, and never rolled back to. */
            const unreleased = draft || !!v.pendingDraft || (!!release[v.label]?.from && !release[v.label]?.released && !(builtin && v.label === active));
            return (
              <Stack key={v.label} direction="row" spacing={1.5} sx={{ pb: i === ordered.length - 1 ? 0 : 2.25 }}>
                <Stack alignItems="center" sx={{ flexShrink: 0, pt: 0.25 }}>
                  <Box sx={{
                    width: 10, height: 10, borderRadius: "50%",
                    bgcolor: isLatest ? "primary.main" : "transparent",
                    border: "2px solid", borderColor: isLatest ? "primary.main" : "text.disabled",
                  }} />
                  {i < ordered.length - 1 && <Box sx={{ width: 1.5, flex: 1, mt: 0.5, bgcolor: "divider" }} />}
                </Stack>
                <Box flex={1} minWidth={0}>
                  <Stack direction="row" alignItems="center" spacing={0.75} flexWrap="wrap" rowGap={0.5}>
                    <Typography sx={{ typography: "s2", fontWeight: 700, fontFamily: MONO }}>{v.label}</Typography>
                    {isLatest && <Chip label="Latest" tone="primary" />}
                    {/* The version that's live — the newest one that isn't a pending draft. */}
                    {v.label === agent.production && !release[v.label]?.live && !(builtin && v.label === active) && (
                      <Chip label="In production" tone="neutral" />
                    )}
                    {/* From an improvement: a draft until someone releases it. */}
                    {(release[v.label]?.live || (builtin && v.label === active)) && (
                      <Tooltip arrow title={builtin && agent.values?.activeVersion?.label === v.label ? `Made active by ${agent.values.activeVersion.by || "a workspace admin"} ${ago(agent.values.activeVersion.at)}` : ""}>
                        <Box component="span"><Chip label={builtin ? "In production" : "Released"} tone="neutral" /></Box>
                      </Tooltip>
                    )}
                    {(draft || (v.pendingDraft && !builtin)) && !release[v.label]?.from && <Chip label="Draft" tone="neutral" />}
                    {release[v.label]?.from && !release[v.label]?.released && !(builtin && v.label === active) && (
                      <Chip label={`Draft · ${release[v.label].from}`} tone="neutral" />
                    )}
                    {/* Found by a re-read: someone changed it on the platform or in the repository. */}
                    {isOutsideChange(v) && (
                      <Tooltip arrow title={`${OUTSIDE_CHANGE_LABEL} — found when ${v.origin === "push" ? "a push was read" : "the agent was synced"} and saved as a new version.`}>
                        <Box component="span"><Chip label="Outside change" tone="neutral" /></Box>
                      </Tooltip>
                    )}
                    {envs.length > 0 && (
                      <Chip label={`Running in ${envs.length === 1 ? envs[0].envName : `${envs.length} environments`}`} tone="neutral" />
                    )}
                    <Box flex={1} />
                    {draft && onMakeActive && (
                      <Tooltip arrow title={isAdmin ? "Release this version — it becomes the one the agent runs, and environments following production test it next. Pinned ones stay put." : MAKE_ACTIVE_ADMIN_ONLY}>
                        <span>
                          <Button
                            size="small" variant="outlined" disabled={!isAdmin} onClick={() => onMakeActive(v.label)}
                            sx={{ typography: "s3", fontWeight: 700, height: 24, minWidth: 0, color: "text.primary", borderColor: "divider" }}
                          >
                            Make active
                          </Button>
                        </span>
                      </Tooltip>
                    )}
                    {!builtin && (v.pendingDraft || (release[v.label]?.from && !release[v.label]?.released)) && (
                      <Tooltip arrow title={`Mark it released ${RELEASE_WHEN[v.draftOf?.source] || "once it's live"}. It becomes the new baseline every improvement is measured against.`}>
                        <Button
                          size="small" variant="outlined" onClick={() => markReleased(v.label)}
                          sx={{ typography: "s3", fontWeight: 700, height: 24, minWidth: 0, color: "text.primary", borderColor: "divider" }}
                        >
                          Mark released
                        </Button>
                      </Tooltip>
                    )}
                  </Stack>
                  <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.25 }}>
                    {`${ORIGIN_LABEL(v, source)} · ${ago(v.createdAt || v.connectedAt)}`}
                    {stats ? ` · ${stats.runs} run${stats.runs === 1 ? "" : "s"} in ${scopeName || "this environment"}, ${stats.rate}% passed` : ""}
                  </Typography>
                  {/* Every pin, on one version — code, the Future AGI prompts it
                      loads, the platform config and the tools. */}
                  {pins[v.label] && (
                    <Tooltip arrow placement="bottom-start" title={pins[v.label].tip}>
                      <Typography sx={{ typography: "s3", fontFamily: MONO, fontSize: 11.5, color: "text.disabled", mt: 0.25, width: "fit-content" }}>
                        {pins[v.label].pins.map((pin, j) => (
                          <Box component="span" key={pin.id} sx={{ whiteSpace: "nowrap" }}>
                            {j > 0 && " · "}
                            {pin.fagi && <Box component="span" sx={{ fontFamily: "inherit", color: "text.subtitle" }}>{"prompt "}</Box>}
                            {pin.text}
                          </Box>
                        ))}
                      </Typography>
                    </Tooltip>
                  )}
                  {/* The version's own note says why; Compare shows exactly what. */}
                  {(v.note ? [releasedNote(v)] : (v.changes || []).map((c) => c.title)).map((t) => (
                    <Typography key={t} sx={{ typography: "s3", color: "text.secondary", mt: 0.375 }}>{t}</Typography>
                  ))}
                  {/* What was checked when it was saved — said per check, not as one gate. */}
                  <VersionChecks result={versionChecksOf(agent, source, v)} />
                  {/* One row of actions under every version, so they line up down the list. */}
                  <Stack direction="row" alignItems="center" spacing={0.5} flexWrap="wrap" sx={{ mt: 0.5, ml: -0.75, "& .MuiButton-root": { px: 0.75, height: 24 } }}>
                    <Button size="small" onClick={() => onView(v.label)} sx={{ typography: "s3", fontWeight: 700, color: "text.secondary", minWidth: 0 }}>
                      View definition
                    </Button>
                    {!isLatest && !unreleased && onRunIn && others.length > 0 && (
                      <Button size="small" onClick={(e) => runIn(e, v.label, others)} sx={{ typography: "s3", fontWeight: 700, color: "text.secondary", minWidth: 0 }}>
                        {others.length === 1 ? `Test ${v.label} in ${others[0].envName}…` : `Test ${v.label} in an environment…`}
                      </Button>
                    )}
                    {!isLatest && !unreleased && (
                      <Button size="small" onClick={() => setRollbackTo(v.label)} sx={{ typography: "s3", fontWeight: 700, color: "text.secondary", minWidth: 0 }}>
                        {`Roll back to ${v.label}`}
                      </Button>
                    )}
                  </Stack>
                </Box>
              </Stack>
            );
          })}
        </Box>
      </Box>

      <Dialog
        open={!!rollbackTo} onClose={() => setRollbackTo(null)}
        PaperProps={{ sx: { borderRadius: 2, maxWidth: 440, width: "100%", bgcolor: "background.paper", backgroundImage: "none", border: "1px solid", borderColor: "divider" } }}
      >
        <Box sx={{ px: 3, pt: 2.5, pb: 1 }}>
          <Typography sx={{ typography: "m3", fontWeight: 700 }}>{`Roll back to ${rollbackTo}?`}</Typography>
        </Box>
        <Stack spacing={1} sx={{ px: 3, pb: 2 }}>
          <Typography sx={{ typography: "s2", color: "text.secondary" }}>
            {`This saves a new version, v${Math.max(0, ...labels.map(versionNumber)) + 1}, with ${rollbackTo}'s ${source.kind === "repo" || source.kind === "framework" ? "commit" : source.kind === "upload" ? "bundle" : "configuration"}, prompts and tools. History stays as it is.`}
          </Typography>
          <Typography sx={{ typography: "s2", color: "text.secondary" }}>
            {`It doesn't change what's in production until it's released — production stays on ${agent.production}.`}
          </Typography>
        </Stack>
        <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ px: 3, pb: 2.5 }}>
          <Button size="small" onClick={() => setRollbackTo(null)} sx={{ typography: "s2", fontWeight: 700, color: "text.secondary" }}>Cancel</Button>
          <Button size="small" variant="contained" color="primary" onClick={() => rollBack(rollbackTo)} sx={{ typography: "s2", fontWeight: 700 }}>
            {`Roll back to ${rollbackTo}`}
          </Button>
        </Stack>
      </Dialog>

      <Menu
        anchorEl={runPick?.anchor} open={!!runPick} onClose={() => setRunPick(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { minWidth: 180, mt: 0.5 } } }}
      >
        {(runPick?.envs || []).map((u) => (
          <MenuItem key={u.envId} onClick={() => { onRunIn(u.envId, runPick.label); setRunPick(null); }} sx={{ typography: "s2" }}>
            {u.envName}
          </MenuItem>
        ))}
      </Menu>

      {/* ── compare ── */}
      <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1.5, bgcolor: "background.paper", minWidth: 0 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1.25, borderBottom: "1px solid", borderColor: "divider" }}>
          <Typography sx={{ typography: "s2", fontWeight: 700 }}>Compare</Typography>
          <VersionSelect value={from} onChange={setFrom} labels={labels} />
          <Iconify icon="solar:arrow-right-linear" width={14} sx={{ color: "text.subtitle" }} />
          <VersionSelect value={to} onChange={setTo} labels={labels} />
          <Box flex={1} />
          {from !== to && (
            <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
              {changed.length ? `${changed.length} file${changed.length === 1 ? "" : "s"} changed` : "No file changes"}
            </Typography>
          )}
        </Stack>
        {/* What moved between the two, pin by pin — a tools fingerprint that
            didn't change says the difference is prompt or code, not tools. */}
        {from !== to && pins[from] && pins[to] && (
          <Typography sx={{ px: 2, py: 0.75, borderBottom: "1px solid", borderColor: "divider", typography: "s3", fontFamily: MONO, fontSize: 11.5, color: "text.disabled" }}>
            {pinsDiff(pins[from], pins[to]).map((d, i) => (
              <Box component="span" key={d.id}>
                {i > 0 && " · "}
                {`${d.label} `}
                {d.id === "tools"
                  /* Tools are compared by their definitions, said in words. */
                  ? (d.changed ? <Box component="span" sx={{ color: "text.secondary" }}>changed</Box> : "unchanged")
                  : d.changed ? (
                    <Box component="span" sx={{ color: "text.secondary" }}>{`${d.from || "—"} → ${d.to}`}</Box>
                  ) : `${d.to} unchanged`}
              </Box>
            ))}
          </Typography>
        )}
        {from === to ? (
          <Typography sx={{ p: 3, typography: "s2", color: "text.subtitle" }}>Pick two different versions to compare.</Typography>
        ) : changed.length === 0 ? (
          <Typography sx={{ p: 3, typography: "s2", color: "text.subtitle" }}>
            {(() => {
              /* Changes written down by hand that don't touch a file we can read. */
              const between = agent.versions.filter((v) => {
                const n = labels.indexOf(v.label);
                return n > Math.min(labels.indexOf(from), labels.indexOf(to)) && n <= Math.max(labels.indexOf(from), labels.indexOf(to));
              });
              const recorded = between.filter((v) => v.origin === "manual").flatMap((v) => (v.changes || []).map((c) => `${v.label}: ${c.title}${c.detail && c.detail !== "Recorded by hand" ? ` — ${c.detail}` : ""}`));
              return recorded.length
                ? `No file differences. What changed was recorded by hand — ${recorded.join("; ")}.`
                : `${from} and ${to} have the same files — the difference is outside what this source exposes.`;
            })()}
          </Typography>
        ) : (
          changed.map(([path, kind]) => {
            const isOpen = open[path] ?? true;
            const a = compare.a.find((f) => f.path === path);
            const b = compare.b.find((f) => f.path === path);
            const doc = (a || b)?.doc;
            const lines = doc ? [] : diffLines(a ? a.content : null, b ? b.content : null);
            return (
              <Box key={path} sx={{ borderBottom: "1px solid", borderColor: "divider", "&:last-of-type": { borderBottom: "none" } }}>
                <Stack
                  direction="row" alignItems="center" spacing={1}
                  {...clickable(() => setOpen((o) => ({ ...o, [path]: !isOpen })), { expanded: isOpen })}
                  sx={{ px: 2, py: 1, cursor: "pointer", "&:hover": { bgcolor: "action.hover" }, ...focusRing }}
                >
                  <Iconify icon={isOpen ? "eva:chevron-down-fill" : "eva:chevron-right-fill"} width={16} sx={{ color: "text.subtitle" }} />
                  <Typography sx={{ typography: "s2", fontFamily: MONO, fontSize: 12.5, flex: 1 }}>{path}</Typography>
                  <Typography sx={{ typography: "s3", fontWeight: 700, color: TONE[kind] }}>{kind}</Typography>
                </Stack>
                {isOpen && !doc && (
                  <Box sx={{ bgcolor: "background.neutral", py: 0.75, maxHeight: 360, overflow: "auto" }}>
                    {collapse(lines).map((l, i) => (
                      // eslint-disable-next-line react/no-array-index-key
                      <Stack key={i} direction="row" sx={{
                        bgcolor: l.type === "add" ? (t) => alpha("#16A34A", t.palette.mode === "dark" ? 0.16 : 0.1)
                          : l.type === "del" ? (t) => alpha("#DC2626", t.palette.mode === "dark" ? 0.16 : 0.08) : "transparent",
                      }}>
                        <Typography component="span" sx={{ width: 28, flexShrink: 0, textAlign: "center", color: "text.disabled", fontFamily: MONO, fontSize: 12, lineHeight: 1.7 }}>
                          {l.type === "add" ? "+" : l.type === "del" ? "−" : l.type === "gap" ? "⋯" : ""}
                        </Typography>
                        <Typography component="span" sx={{ fontFamily: MONO, fontSize: 12.5, lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word", pr: 2, color: l.type === "gap" ? "text.disabled" : "text.primary" }}>
                          {l.text || " "}
                        </Typography>
                      </Stack>
                    ))}
                  </Box>
                )}
                {isOpen && doc && (
                  <Typography sx={{ px: 5, pb: 1.25, typography: "s3", color: "text.subtitle" }}>
                    {`Document ${kind} — ${(b || a).content}`}
                  </Typography>
                )}
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}

AgentVersionsTab.propTypes = {
  agent: PropTypes.object.isRequired,
  source: PropTypes.object.isRequired,
  filesOf: PropTypes.func.isRequired,
  toolsOf: PropTypes.func,
  statsOf: PropTypes.func.isRequired,
  scopeName: PropTypes.string,
  onView: PropTypes.func.isRequired,
  onRunIn: PropTypes.func,
  onMakeActive: PropTypes.func,
};

/* Keep two lines of context around each change; fold the rest. */
function collapse(lines) {
  const keep = lines.map((l, i) => l.type !== "same"
    || lines.slice(Math.max(0, i - 2), i + 3).some((x) => x.type !== "same"));
  const out = [];
  let skipped = 0;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (skipped) out.push({ type: "gap", text: `${skipped} unchanged line${skipped === 1 ? "" : "s"}` });
      skipped = 0;
      out.push(l);
    } else skipped += 1;
  });
  if (skipped) out.push({ type: "gap", text: `${skipped} unchanged line${skipped === 1 ? "" : "s"}` });
  return out;
}

function VersionSelect({ value, onChange, labels }) {
  return (
    <Select
      size="small" value={value} onChange={(e) => onChange(e.target.value)}
      sx={{ height: 28, typography: "s2", fontFamily: MONO, "& .MuiSelect-select": { py: 0.25 } }}
    >
      {labels.map((l) => <MenuItem key={l} value={l} sx={{ typography: "s2", fontFamily: MONO }}>{l}</MenuItem>)}
    </Select>
  );
}
VersionSelect.propTypes = { value: PropTypes.string, onChange: PropTypes.func, labels: PropTypes.array };

/* One line under a version — "3 checks passed" — that opens to each check. */
function VersionChecks({ result }) {
  const [open, setOpen] = useState(false);
  if (!result) return null;
  if (result.unchecked) {
    return (
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 0.5 }}>
        <Iconify icon="solar:minus-circle-linear" width={13} sx={{ color: "text.disabled", flexShrink: 0 }} />
        <Typography sx={{ typography: "s3", color: "text.subtitle" }}>{result.unchecked}</Typography>
      </Stack>
    );
  }
  if (!result.checks.length) return null;
  const failed = result.checks.some((c) => !c.ok);
  return (
    <Box sx={{ mt: 0.5 }}>
      <Stack
        direction="row" alignItems="center" spacing={0.5}
        {...clickable(() => setOpen((o) => !o), { expanded: open })}
        sx={{ width: "fit-content", cursor: "pointer", borderRadius: 0.5, ...focusRing }}
      >
        <Iconify
          icon={failed ? "solar:danger-circle-linear" : "solar:check-circle-linear"}
          width={13}
          sx={{ color: failed ? TONE.removed : "text.subtitle", flexShrink: 0 }}
        />
        <Typography sx={{ typography: "s3", fontWeight: 600, color: failed ? TONE.removed : "text.secondary" }}>{versionChecksLine(result)}</Typography>
        <Iconify icon={open ? "solar:alt-arrow-up-linear" : "solar:alt-arrow-down-linear"} width={11} sx={{ color: "text.disabled" }} />
      </Stack>
      {open && (
        <Box component="dl" sx={{ m: 0, mt: 0.5, pl: 2.25, display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 1.5, rowGap: 0.25 }}>
          {result.checks.map((c) => (
            <Box key={c.id} sx={{ display: "contents" }}>
              <Stack component="dt" direction="row" alignItems="center" spacing={0.5} sx={{ m: 0 }}>
                <Iconify icon={c.ok ? "eva:checkmark-fill" : "eva:close-fill"} width={12} sx={{ color: c.ok ? "text.subtitle" : TONE.removed, flexShrink: 0 }} />
                <Typography sx={{ typography: "s3", color: c.ok ? "text.secondary" : TONE.removed, whiteSpace: "nowrap" }}>{c.label}</Typography>
              </Stack>
              <Typography component="dd" noWrap sx={{ m: 0, typography: "s3", color: "text.disabled", fontFamily: c.detail && /[/:_.@]/.test(c.detail) ? MONO : undefined, fontSize: c.detail && /[/:_.@]/.test(c.detail) ? 11.5 : undefined, minWidth: 0 }}>
                {c.detail || ""}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
VersionChecks.propTypes = { result: PropTypes.object };

function Chip({ label, tone }) {
  return (
    <Box sx={{
      px: 0.75, height: 18, display: "inline-flex", alignItems: "center", borderRadius: 0.75,
      bgcolor: (t) => alpha(tone === "primary" ? t.palette.primary.main : tone === "neutral" ? t.palette.text.primary : tone, tone === "neutral" ? 0.07 : t.palette.mode === "dark" ? 0.16 : 0.1),
      color: tone === "primary" ? "primary.main" : tone === "neutral" ? "text.secondary" : tone,
    }}>
      <Typography sx={{ typography: "s3", fontWeight: 700 }}>{label}</Typography>
    </Box>
  );
}
Chip.propTypes = { label: PropTypes.string, tone: PropTypes.string };
