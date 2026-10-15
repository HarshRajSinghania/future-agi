import PropTypes from "prop-types";
import { useState } from "react";
import { alpha } from "@mui/material/styles";
import { Box, Button, Menu, Stack, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { currentAgentVersion } from "../_mock/versions";
import { versionHistoryOf } from "../_mock/nudgeEffects";
import { snapshotHistoryOf, snapshotPartsLine, SNAPSHOT_KIND_LABEL } from "../_mock/envSnapshot";
import { ago } from "../agents/agentViewUtils";
import useEnvViewAs from "./useEnvViewAs";
import { clickable, focusRing } from "../components/clickable";

const ACCENT = "#7857FC";
const MONO = "ui-monospace, Menlo, monospace";
const runs = (n) => `${n} run${n === 1 ? "" : "s"}`;
const PART_NAME = { env: "World", set: "Scenarios", catalog: "Sub-goals", eval: "Evaluations", caller: "Caller" };

/**
 * Version history: one list of environment versions, newest first.
 *
 * An environment version is a snapshot of everything that decides what is
 * tested and how it is judged — the world and its contract, the scenario set,
 * the sub-goal catalogue, the evaluations and the simulated caller. Any change
 * to any of them is the next version; an agent change never is (envSnapshot.js).
 * Each row reads "v7 · 3 scenarios added from ISS-4529 · 2h ago" and opens to
 * the parts underneath it (world E v3 · scenarios s5 · …) and the scenario and
 * sub-goal bumps that made it.
 *
 * "Use" makes an older world the one runs use; "View" opens it read-only.
 * Both are offered on the newest version of each world only — an older
 * version on the same world differs in its scenario set or evals, which are
 * not rolled back.
 */
export default function VersionHistoryMenu({ anchor, onClose, env, envState, patch, readOnly = false }) {
  const snapshots = snapshotHistoryOf(env, envState);
  const agents = versionHistoryOf(env, envState).agent;
  const activeAgent = currentAgentVersion(envState)?.label;
  const { viewAs, setViewAs } = useEnvViewAs(env, envState);
  const [open, setOpen] = useState(null);
  const canSwitch = !readOnly && !!patch;

  return (
    <Menu
      anchorEl={anchor}
      open={!!anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      transformOrigin={{ vertical: "top", horizontal: "left" }}
      slotProps={{
        paper: {
          sx: {
            width: 460, maxWidth: "calc(100vw - 32px)", maxHeight: "72vh", mt: 0.5, p: 0.75, borderRadius: 1.5,
            border: "1px solid", borderColor: "divider",
            boxShadow: (t) => `0 12px 32px ${alpha(t.palette.common.black, t.palette.mode === "dark" ? 0.5 : 0.16)}`,
          },
        },
        list: { sx: { p: 0 } },
      }}
    >
      <Box sx={{ px: 1.25, pt: 0.75, pb: 1 }}>
        <Typography sx={{ typography: "s3", fontWeight: 700, color: "text.subtitle", textTransform: "uppercase", letterSpacing: 0.5 }}>
          Version history
        </Typography>
        <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.25 }}>
          One environment version covers the world, scenarios, sub-goals, evaluations and simulated caller — any change to them is the next version. An agent change never is.
        </Typography>
      </Box>

      {/* ── environment ── */}
      <Section title="Environment" note={`${snapshots.length} version${snapshots.length === 1 ? "" : "s"}`} />
      <Stack spacing={0.25}>
        {snapshots.map((v) => {
          const isActive = v.current;
          const isViewed = v.worldHead && v.parts.env === viewAs;
          const expanded = open === v.label;
          const offer = v.worldHead && !isActive;
          return (
            <Box
              key={v.label}
              sx={{
                borderRadius: 1, border: "1px solid", borderColor: isActive ? alpha(ACCENT, 0.35) : "transparent",
                bgcolor: (t) => (isActive ? alpha(ACCENT, t.palette.mode === "dark" ? 0.12 : 0.06) : "transparent"),
              }}
            >
              <Stack
                direction="row" spacing={1.25} alignItems="flex-start"
                {...clickable(() => setOpen(expanded ? null : v.label), { expanded })}
                sx={{ ...focusRing, px: 1.25, py: 1, cursor: "pointer", borderRadius: 1, "&:hover": { bgcolor: isActive ? undefined : "action.hover" } }}
              >
                <Iconify icon={isActive ? "solar:check-circle-bold" : "solar:circle-linear"} width={16} sx={{ color: isActive ? ACCENT : "text.disabled", flexShrink: 0, mt: "1px" }} />
                <Box flex={1} minWidth={0}>
                  <Stack direction="row" alignItems="center" spacing={0.625} flexWrap="wrap" rowGap={0.375}>
                    <Typography sx={{ typography: "s2", fontWeight: 700, fontFamily: MONO }}>{v.label}</Typography>
                    {v.latest && <Badge label="latest" />}
                    {isActive && <Badge label="active" tone={ACCENT} />}
                    {isViewed && <Badge label="viewing" />}
                    <Box flex={1} />
                    {offer && canSwitch && (
                      <Button
                        size="small"
                        onClick={(e) => { e.stopPropagation(); patch({ activeEnvVersion: v.parts.env }); onClose(); }}
                        sx={{ typography: "s3", fontWeight: 700, color: "text.secondary", minWidth: 0, px: 0.75, py: 0, height: 20 }}
                      >
                        Use
                      </Button>
                    )}
                    {offer && !isViewed && (
                      <Button
                        size="small"
                        onClick={(e) => { e.stopPropagation(); setViewAs(v.parts.env); onClose(); }}
                        sx={{ typography: "s3", fontWeight: 700, color: "text.secondary", minWidth: 0, px: 0.75, py: 0, height: 20 }}
                      >
                        View
                      </Button>
                    )}
                    <Iconify icon={expanded ? "solar:alt-arrow-up-linear" : "solar:alt-arrow-down-linear"} width={12} sx={{ color: "text.disabled" }} />
                  </Stack>
                  <Typography sx={{ typography: "s3", color: "text.secondary", mt: 0.25 }}>{v.summary}</Typography>
                  <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.25, fontVariantNumeric: "tabular-nums" }}>
                    {[v.kinds.map((k) => SNAPSHOT_KIND_LABEL[k]).join(" + "), runs(v.runs), v.at && ago(v.at)].filter(Boolean).join(" · ")}
                  </Typography>
                </Box>
              </Stack>
              {expanded && (
                <Box sx={{ pl: 4.75, pr: 1.25, pb: 1 }}>
                  <Typography sx={{ typography: "s3", color: "text.secondary", fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
                    {`${v.label} = ${snapshotPartsLine(v)}`}
                  </Typography>
                  {v.details.map((d, i) => (
                    <Typography key={`${d.part}-${d.label}-${i}`} sx={{ typography: "s3", color: "text.subtitle", mt: 0.25 }}>
                      <Box component="span" sx={{ color: "text.secondary", fontWeight: 600 }}>{`${PART_NAME[d.part] || d.part} ${d.label}`}</Box>
                      {d.text ? ` — ${d.text}` : ""}
                    </Typography>
                  ))}
                  {!v.worldHead && (
                    <Typography sx={{ typography: "s3", color: "text.disabled", mt: 0.5 }}>
                      Same world as a later version — switch to that one to run on this world.
                    </Typography>
                  )}
                </Box>
              )}
            </Box>
          );
        })}
      </Stack>

      {/* ── agent ── */}
      <Section title="Agent" note="The test subject — every change is a new version" />
      {agents.length ? agents.map((v) => (
        <Line
          key={v.label}
          label={`Agent ${v.label}`}
          badges={[v.label === activeAgent && { label: "testing", tone: ACCENT }, v.reference && { label: "reference" }].filter(Boolean)}
          summary={v.summary}
          meta={`${runs(v.runs)} · ${ago(v.at)}`}
        />
      )) : <Empty text="No agent connected yet." />}
    </Menu>
  );
}

VersionHistoryMenu.propTypes = {
  anchor: PropTypes.object,
  onClose: PropTypes.func.isRequired,
  env: PropTypes.object.isRequired,
  envState: PropTypes.object.isRequired,
  patch: PropTypes.func,
  readOnly: PropTypes.bool,
};

function Section({ title, note }) {
  return (
    <Stack direction="row" alignItems="baseline" spacing={0.75} sx={{ px: 1.25, pt: 1.25, pb: 0.5, mt: 0.5, borderTop: "1px solid", borderColor: "divider" }}>
      <Typography sx={{ typography: "s3", fontWeight: 700, color: "text.secondary" }}>{title}</Typography>
      <Typography noWrap sx={{ typography: "s3", color: "text.subtitle", minWidth: 0 }}>{note}</Typography>
    </Stack>
  );
}
Section.propTypes = { title: PropTypes.string, note: PropTypes.string };

function Line({ label, badges = [], summary, meta }) {
  return (
    <Box sx={{ px: 1.25, py: 0.75 }}>
      <Stack direction="row" alignItems="center" spacing={0.625}>
        {label && <Typography sx={{ typography: "s2", fontWeight: 700, fontFamily: MONO }}>{label}</Typography>}
        {badges.map((b) => <Badge key={b.label} label={b.label} tone={b.tone} />)}
        <Box flex={1} />
        <Typography sx={{ typography: "s3", color: "text.subtitle", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{meta}</Typography>
      </Stack>
      <Typography sx={{ typography: "s3", color: "text.secondary", mt: label ? 0.25 : 0 }}>{summary}</Typography>
    </Box>
  );
}
Line.propTypes = { label: PropTypes.string, badges: PropTypes.array, summary: PropTypes.string, meta: PropTypes.string };

function Empty({ text }) {
  return <Typography sx={{ px: 1.25, py: 0.75, typography: "s3", color: "text.subtitle" }}>{text}</Typography>;
}
Empty.propTypes = { text: PropTypes.string };

/* Small pill — neutral outline by default, tinted when a tone is given. */
function Badge({ label, tone }) {
  return (
    <Box
      sx={{
        px: 0.625, height: 16, borderRadius: 0.5, display: "inline-flex", alignItems: "center",
        border: "1px solid",
        borderColor: (t) => (tone ? alpha(tone, 0.4) : t.palette.divider),
        color: tone || "text.subtitle",
        bgcolor: (t) => (tone ? alpha(tone, t.palette.mode === "dark" ? 0.14 : 0.08) : "transparent"),
      }}
    >
      <Typography sx={{ typography: "s3", fontWeight: 700 }}>{label}</Typography>
    </Box>
  );
}
Badge.propTypes = { label: PropTypes.string, tone: PropTypes.string };
