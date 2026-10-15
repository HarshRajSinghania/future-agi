import PropTypes from "prop-types";
import { useState } from "react";
import { alpha } from "@mui/material/styles";
import { Box, Button, ButtonBase, CircularProgress, Divider, IconButton, InputBase, Menu, MenuItem, Popover, Stack, Tooltip, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { STATE_TONE, NO_DECISION_NOTE, countsTowardNoDecision } from "../../_mock/scenarioStates";
import { personalDataLine, personalDataDetail, REPRO_LABEL } from "../../_mock/scenarioSources";
import { TIERS, tierOf } from "../../_mock/tiers";
import { PRIORITIES, PRIORITY_LABEL, PRIORITY_NOTE, priorityOf } from "../../_mock/scenarioPriority";
import { CANARY_NOTE } from "../../_mock/cheatControls";
import { scenarioVersionOf, SCENARIO_BUMPS } from "../../_mock/decoupled";

/*
  The pieces every view of a scenario's state shares: the chip, the tier and
  canary marks, the version, and the quiet Archive control. The chip is the
  table's old status chip, worded to the versioning doc's states — Valid ·
  Re-check · Outdated · Not applicable · Archived — with the detail on hover.
*/

const ICON = {
  valid: "solar:check-circle-linear",
  recheck: "solar:refresh-linear",
  archived: "solar:archive-linear",
  na: "solar:forbidden-circle-linear",
};
const MUTED = new Set(["archived", "na", "later"]);

export function StateChip({ state }) {
  const tone = STATE_TONE[state.id] || null;
  const checking = state.proof?.id === "checking";
  /* The proof's own words, when they add something to the state's. */
  const proofLabel = state.proof?.label && state.proof.label !== state.label ? state.proof.label : null;
  const title = (
    <Stack spacing={0.375} sx={{ py: 0.25, maxWidth: 300 }}>
      <Typography sx={{ typography: "s3", fontWeight: 700, color: "inherit" }}>
        {`${state.label} — ${state.note}`}
      </Typography>
      {state.why && <Typography sx={{ typography: "s3", color: "inherit" }}>{state.why}</Typography>}
      {proofLabel && <Typography sx={{ typography: "s3", color: "inherit", opacity: 0.7 }}>{proofLabel}</Typography>}
      {countsTowardNoDecision(state) && <Typography sx={{ typography: "s3", color: "inherit" }}>{NO_DECISION_NOTE}</Typography>}
    </Stack>
  );
  return (
    <Tooltip arrow title={title}>
      <Box
        sx={{
          display: "inline-flex", alignItems: "center", gap: 0.625, flexShrink: 0,
          height: 22, px: 0.875, borderRadius: 0.75, border: "1px solid",
          borderColor: tone ? alpha(tone, 0.4) : "divider",
          bgcolor: (t) => (tone ? alpha(tone, t.palette.mode === "dark" ? 0.12 : 0.06) : "transparent"),
          color: tone || (MUTED.has(state.id) ? "text.disabled" : "text.secondary"),
        }}
      >
        {checking
          ? <CircularProgress size={10} thickness={6} sx={{ color: "text.disabled" }} />
          : ICON[state.id] && <Iconify icon={ICON[state.id]} width={12} sx={{ color: "text.disabled" }} />}
        <Typography noWrap sx={{ typography: "s3", fontWeight: 600, color: "inherit" }}>
          {checking ? "Checking…" : state.label}
        </Typography>
      </Box>
    </Tooltip>
  );
}
StateChip.propTypes = { state: PropTypes.object.isRequired };

/*
  Archive — a hand edit, reversible with Restore. No reason to pick; a note
  is optional. An anchor-core scenario says so first: archiving one is an
  explicit decision, and it is logged. An icon in the table's actions
  column, a text link in the detail.
*/
export function ArchiveControl({ onArchive, variant = "icon", disabled = false, anchor = false }) {
  const [el, setEl] = useState(null);
  const open = (e) => { e.stopPropagation(); setEl(e.currentTarget); };
  return (
    <>
      {variant === "icon" ? (
        <Tooltip arrow title={disabled ? "Fork this environment to edit." : "Archive — keep it listed, stop running it"}>
          <span>
            <IconButton size="small" disabled={disabled} onClick={open} aria-label="Archive scenario">
              <Iconify icon="solar:archive-linear" width={15} sx={{ color: "text.subtitle" }} />
            </IconButton>
          </span>
        </Tooltip>
      ) : (
        <TextAction onClick={open} disabled={disabled}>Archive</TextAction>
      )}
      <ArchivePopover anchorEl={el} onClose={() => setEl(null)} onArchive={onArchive} anchor={anchor} />
    </>
  );
}
ArchiveControl.propTypes = { onArchive: PropTypes.func.isRequired, variant: PropTypes.oneOf(["icon", "text"]), disabled: PropTypes.bool, anchor: PropTypes.bool };

/* Archive's confirm, with its note — opened from a control or a menu item. */
export function ArchivePopover({ anchorEl, onClose, onArchive, anchor = false }) {
  const [note, setNote] = useState("");
  const done = () => { onClose(); onArchive(note.trim()); setNote(""); };
  return (
    <Popover
      open={!!anchorEl}
      anchorEl={anchorEl}
      onClose={onClose}
      onClick={(e) => e.stopPropagation()}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      transformOrigin={{ vertical: "top", horizontal: "right" }}
      slotProps={{ paper: { sx: { width: 300, p: 1.5, mt: 0.5 } } }}
    >
      <Typography sx={{ typography: "s2", fontWeight: 700 }}>
        {anchor ? "Archive an anchor scenario?" : "Archive this scenario?"}
      </Typography>
      <Typography sx={{ typography: "s3", color: "text.secondary", mt: 0.25 }}>
        {anchor
          ? "It's in the anchor core — the frozen slice every agent version is compared on. Archiving it is logged. It stays listed and can be restored."
          : "It stays listed and can be restored. It stops running and counting, and the scenario set moves to a new version."}
      </Typography>
      <InputBase
        fullWidth
        multiline
        minRows={2}
        autoFocus
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={anchor ? "Why — kept in the log" : "Note (optional)"}
        sx={{ mt: 1.25, px: 1, py: 0.75, borderRadius: 1, border: "1px solid", borderColor: "divider", typography: "s2" }}
      />
      <Stack direction="row" justifyContent="flex-end" spacing={0.75} sx={{ mt: 1.25 }}>
        <Button size="small" onClick={onClose} sx={{ typography: "s2", fontWeight: 600, color: "text.secondary" }}>
          Cancel
        </Button>
        <Button size="small" variant="contained" color="primary" onClick={done} sx={{ typography: "s2", fontWeight: 700 }}>
          {anchor ? "Archive anchor" : "Archive"}
        </Button>
      </Stack>
    </Popover>
  );
}
ArchivePopover.propTypes = { anchorEl: PropTypes.any, onClose: PropTypes.func.isRequired, onArchive: PropTypes.func.isRequired, anchor: PropTypes.bool };

/* A small bordered word — the shape the table's "New · env" tag already uses. */
function Tag({ children, strong = false, dashed = false }) {
  return (
    <Box
      sx={{
        display: "inline-flex", alignItems: "center", gap: 0.375, flexShrink: 0,
        height: 18, px: 0.625, borderRadius: 0.5,
        border: "1px solid", borderStyle: dashed ? "dashed" : "solid",
        borderColor: strong ? "text.disabled" : "divider",
        color: strong ? "text.primary" : "text.secondary",
      }}
    >
      {children}
    </Box>
  );
}
Tag.propTypes = { children: PropTypes.node, strong: PropTypes.bool, dashed: PropTypes.bool };

/* The scenario's tier — Anchor / Core / Exploration — named on hover. A
   proposal not yet approved says so. */
export function TierBadge({ row, compact = false }) {
  const tier = tierOf(row);
  const meta = TIERS[tier];
  return (
    <Tooltip arrow title={`${meta.long} — ${meta.note}${row?.proposed ? " Proposed — joins the set once approved." : ""}`}>
      <Box sx={{ display: "inline-flex" }}>
        <Tag strong={tier === "anchor"} dashed={!!row?.proposed}>
          {tier === "anchor" && <Iconify icon="solar:pin-linear" width={11} sx={{ color: "text.secondary" }} />}
          <Typography noWrap sx={{ typography: "s3", fontWeight: tier === "anchor" ? 700 : 600, color: "inherit" }}>
            {row?.proposed ? "Proposed" : compact ? meta.label : meta.long}
          </Typography>
        </Tag>
      </Box>
    </Tooltip>
  );
}
TierBadge.propTypes = { row: PropTypes.object.isRequired, compact: PropTypes.bool };

/* Impossible by design — a cheat check, not counted in the pass rate. */
export function CanaryBadge() {
  return (
    <Tooltip arrow title={`Canary — ${CANARY_NOTE}`}>
      <Box sx={{ display: "inline-flex" }}>
        <Tag>
          <Typography noWrap sx={{ typography: "s3", fontWeight: 700, color: "inherit" }}>Canary</Typography>
        </Tag>
      </Box>
    </Tooltip>
  );
}

/* "1.2.0", mono — with the last change on hover. */
export function VersionTag({ row }) {
  const v = scenarioVersionOf(row);
  const last = (row?.versionLog || []).slice(-1)[0];
  const tip = last
    ? `${last.v} — ${last.level}: ${last.why || "edited"}. ${SCENARIO_BUMPS[last.level]?.note || ""}`
    : "1.0.0 — as written. Every edit bumps it by kind: patch, minor or major.";
  return (
    <Tooltip arrow title={tip}>
      <Typography noWrap sx={{ typography: "s3", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11.5, color: last ? "text.primary" : "text.subtitle", fontVariantNumeric: "tabular-nums" }}>
        {v}
      </Typography>
    </Tooltip>
  );
}
VersionTag.propTypes = { row: PropTypes.object };

/* A quiet text action — the detail's Re-prove / Rewrite / Archive / Restore. */
export function TextAction({ onClick, disabled = false, children }) {
  return (
    <Box
      component="button"
      type="button"
      disabled={disabled}
      onClick={onClick}
      sx={{
        p: 0, border: 0, bgcolor: "transparent", font: "inherit", flexShrink: 0,
        typography: "s2", fontWeight: 600, lineHeight: 1.6,
        color: disabled ? "text.disabled" : "text.primary",
        cursor: disabled ? "default" : "pointer",
        "&:hover": disabled ? undefined : { textDecoration: "underline" },
      }}
    >
      {children}
    </Box>
  );
}
TextAction.propTypes = { onClick: PropTypes.func, disabled: PropTypes.bool, children: PropTypes.node };

/*
  Critical or supporting, per sub-goal. A failed critical one fails the
  scenario; a failed supporting one only lowers its score. Read-only, it is
  just the word.
*/
export function MarkToggle({ value, onChange, disabled = false }) {
  if (disabled || !onChange) {
    return (
      <Typography sx={{ typography: "s3", fontWeight: value === "critical" ? 700 : 500, color: value === "critical" ? "text.primary" : "text.subtitle", flexShrink: 0 }}>
        {value === "critical" ? "Critical" : "Supporting"}
      </Typography>
    );
  }
  return (
    <Stack
      direction="row"
      onClick={(e) => e.stopPropagation()}
      sx={{ flexShrink: 0, border: "1px solid", borderColor: "divider", borderRadius: 0.75, p: "1px" }}
    >
      {["critical", "supporting"].map((m) => {
        const on = value === m;
        return (
          <Tooltip
            key={m}
            arrow
            title={m === "critical" ? "Fails the scenario if it isn't met" : "Only lowers the score if it isn't met"}
          >
            <Box
              component="button"
              type="button"
              aria-pressed={on}
              onClick={() => !on && onChange(m)}
              sx={{
                p: 0, px: 0.75, height: 20, border: 0, borderRadius: 0.5, font: "inherit",
                typography: "s3", fontWeight: on ? 700 : 500, cursor: on ? "default" : "pointer",
                color: on ? "text.primary" : "text.subtitle",
                bgcolor: on ? "action.selected" : "transparent",
                "&:hover": on ? undefined : { color: "text.primary" },
              }}
            >
              {m === "critical" ? "Critical" : "Supporting"}
            </Box>
          </Tooltip>
        );
      })}
    </Stack>
  );
}
MarkToggle.propTypes = { value: PropTypes.string, onChange: PropTypes.func, disabled: PropTypes.bool };

/*
  Where a production-derived scenario came from, in the words the PRD uses:
  "Personal data replaced · 5 values", the reproduce state of an Error Feed
  conversation, and the Phase 2 mark on a word-for-word replay. Quiet tags —
  the same bordered word as the tier.
*/
export function PersonalDataTag({ row }) {
  const line = personalDataLine(row);
  if (!line) return null;
  return (
    <Tooltip arrow title={personalDataDetail(row) || ""}>
      <Box sx={{ display: "inline-flex", cursor: "help" }}>
        <Tag>
          <Iconify icon="solar:shield-user-linear" width={11} sx={{ color: "text.subtitle" }} />
          <Typography noWrap sx={{ typography: "s3", fontWeight: 600, color: "inherit" }}>{line}</Typography>
        </Tag>
      </Box>
    </Tooltip>
  );
}
PersonalDataTag.propTypes = { row: PropTypes.object };

/* Reproduced is the one that becomes a target; the others are said plainly. */
export function ReproTag({ repro, target = false }) {
  if (!repro?.state) return null;
  const label = REPRO_LABEL[repro.state] || repro.state;
  const tip = repro.state === "reproduced"
    ? `Failed ${repro.fails} of ${repro.of} on today's agent — ${target ? "a target the fix has to make pass" : "it becomes a target"}.`
    : repro.state === "inconclusive"
      ? `Failed ${repro.fails} of ${repro.of} — once in three is neither a reproduction nor a pass. Not a target.`
      : "Passed every time on today's agent — the failure didn't happen. Not a target.";
  return (
    <Tooltip arrow title={tip}>
      <Box sx={{ display: "inline-flex", cursor: "help" }}>
        <Tag strong={repro.state === "reproduced"} dashed={repro.state === "inconclusive"}>
          <Typography noWrap sx={{ typography: "s3", fontWeight: repro.state === "reproduced" ? 700 : 600, color: "inherit" }}>{label}</Typography>
        </Tag>
      </Box>
    </Tooltip>
  );
}
ReproTag.propTypes = { repro: PropTypes.object, target: PropTypes.bool };


/*
  A scenario's priority as plain text — High reads strongest, Low quietest —
  and, where it can change, a menu on click. A must-pass scenario is always
  high, so it never offers one.
*/
export function PriorityPicker({ row, onChange, locked = false }) {
  const [el, setEl] = useState(null);
  const p = priorityOf(row);
  const forced = !!row.critical;
  const can = !!onChange && !locked && !forced && !row.archived;
  const text = (
    <Typography
      sx={{
        typography: "s2", fontWeight: p === "high" ? 600 : 500, whiteSpace: "nowrap",
        color: p === "high" ? "text.primary" : p === "med" ? "text.secondary" : "text.subtitle",
      }}
    >
      {PRIORITY_LABEL[p]}
    </Typography>
  );
  if (!can) {
    return (
      <Tooltip arrow title={forced ? "Must-pass scenarios are always high priority" : PRIORITY_NOTE}>
        <Box sx={{ display: "inline-flex" }}>{text}</Box>
      </Tooltip>
    );
  }
  return (
    <>
      <ButtonBase
        onClick={(e) => { e.stopPropagation(); setEl(e.currentTarget); }}
        aria-label={`Priority: ${PRIORITY_LABEL[p]} — change`}
        sx={{
          gap: 0.25, px: 0.625, mx: -0.625, py: 0.125, borderRadius: 0.5,
          "&:hover": { bgcolor: "action.hover" },
          "& .pp-caret": { opacity: el ? 1 : 0, transition: "opacity .12s ease" },
          "&:hover .pp-caret, &.Mui-focusVisible .pp-caret": { opacity: 1 },
        }}
      >
        {text}
        <Iconify className="pp-caret" icon="solar:alt-arrow-down-linear" width={12} sx={{ color: "text.subtitle" }} />
      </ButtonBase>
      <Menu
        anchorEl={el}
        open={!!el}
        onClose={() => setEl(null)}
        onClick={(e) => e.stopPropagation()}
        slotProps={{ paper: { sx: { width: 240 } } }}
      >
        {PRIORITIES.map((o) => (
          <MenuItem
            key={o.id}
            selected={o.id === p}
            onClick={() => { setEl(null); if (o.id !== p) onChange(o.id); }}
            sx={{ typography: "s2", fontWeight: o.id === p ? 600 : 400 }}
          >
            <Box sx={{ flex: 1 }}>{o.label}</Box>
            {o.id === p && <Iconify icon="eva:checkmark-fill" width={15} sx={{ color: "text.secondary" }} />}
          </MenuItem>
        ))}
        <Divider />
        <Typography sx={{ px: 1.5, py: 0.75, typography: "s3", color: "text.subtitle", whiteSpace: "normal" }}>{PRIORITY_NOTE}</Typography>
      </Menu>
    </>
  );
}
PriorityPicker.propTypes = { row: PropTypes.object.isRequired, onChange: PropTypes.func, locked: PropTypes.bool };
