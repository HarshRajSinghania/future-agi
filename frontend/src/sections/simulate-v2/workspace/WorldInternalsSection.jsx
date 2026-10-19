import PropTypes from "prop-types";
import { useState } from "react";
import { alpha } from "@mui/material/styles";
import { Box, Stack, Typography, Collapse, IconButton, Tooltip, Menu, MenuItem, Button } from "@mui/material";
import { useSnackbar } from "notistack";
import Iconify from "src/components/iconify";
import { SectionCard } from "../components/primitives";
import { schemaFor, toolImplFor } from "../_mock/envInternals";
import { PROOF_CHECKS } from "../_mock/proofs";
import {
  FAULT_PRESETS, allToolsFaultPatch, downgradeTierPatch, faultLine, needsSafeTarget, safeTargetPatch, tierOf,
  toolEnvPatch, toolEnvSummaryWords, toolSettingOf, allowLivePatch, liveAdvisoryOf,
} from "../_mock/toolEnv";
import { TierDial, FaultsControl, SafeTargetPrompt, LiveAdvisory } from "./ToolDial";
import { toolArgsOf } from "../_mock/rlContract";
import ToolArgsGrid from "./ToolArgsGrid";
import { clickable, focusRing } from "../components/clickable";

/**
 * World internals on the World tab.
 *
 * Three sections: DB schema, the world's tools (each with its fidelity dial
 * and fault profile; open one for its arguments and code), and the checks that prove
 * a scenario can be staged. Rows are compact by default — click one open to
 * inspect columns or read the code. Graders aren't here: sub-goals decide
 * pass or fail, and the evaluations that score on top live on the
 * Evaluations tab.
 */
export default function WorldInternalsSection({ env, envState, patch, onGo, locked = false }) {
  const schema = schemaFor(env);
  const tools = env?.tools || [];

  const totalRows = schema.reduce((a, t) => a + (t.rows || 0), 0);

  return (
    <Stack spacing={2} sx={{ mb: 2 }}>
      {schema.length > 0 && (
        <SchemaCard schema={schema} totalRows={totalRows} />
      )}
      {tools.length > 0 && (
        <ToolImplsCard env={env} tools={tools} envState={envState} patch={locked ? null : patch} />
      )}
      <ProofChecksCard onGo={onGo} />
    </Stack>
  );
}
WorldInternalsSection.propTypes = {
  env: PropTypes.object.isRequired,
  envState: PropTypes.object,
  patch: PropTypes.func,
  onGo: PropTypes.func,
  locked: PropTypes.bool,
};

/* ── DB schema ────────────────────────────────────────────────────────── */

function SchemaCard({ schema, totalRows }) {
  const [openTable, setOpenTable] = useState(null);
  return (
    <SectionCard
      title="World state · database schema"
      subtitle="The tables and columns that make up this environment's world"
      action={
        <Typography sx={{ typography: "s3", color: "text.subtitle", fontVariantNumeric: "tabular-nums" }}>
          {schema.length} tables · {totalRows.toLocaleString()} rows
        </Typography>
      }
    >
      <Stack divider={<Box sx={{ borderBottom: "1px solid", borderColor: "divider" }} />}>
        {schema.map((t) => {
          const open = openTable === t.name;
          return (
            <Box key={t.name}>
              <Stack
                direction="row"
                alignItems="center"
                spacing={1.5}
                {...clickable(() => setOpenTable(open ? null : t.name), { expanded: open })}
                sx={{ ...focusRing, px: 2.5, py: 1.375, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
              >
                <Iconify
                  icon={open ? "solar:alt-arrow-down-linear" : "solar:alt-arrow-right-linear"}
                  width={13}
                  sx={{ color: "text.subtitle", flexShrink: 0 }}
                />
                <Iconify icon="solar:database-linear" width={15} sx={{ color: "#2563EB", flexShrink: 0 }} />
                <Typography
                  sx={{ typography: "s2", fontWeight: 600, fontFamily: "ui-monospace, Menlo, monospace", minWidth: 140 }}
                >
                  {t.name}
                </Typography>
                <Typography sx={{ typography: "s3", color: "text.subtitle", flex: 1, minWidth: 0 }} noWrap>
                  {t.cols.length} columns · {t.note}
                </Typography>
                <Typography
                  sx={{ typography: "s3", color: "text.subtitle", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}
                >
                  {(t.rows || 0).toLocaleString()} rows
                </Typography>
              </Stack>
              <Collapse in={open}>
                <Box
                  sx={{
                    px: 2.5,
                    py: 1.5,
                    bgcolor: "background.neutral",
                    borderTop: "1px solid",
                    borderColor: "divider",
                  }}
                >
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "20px 1fr 1fr",
                      rowGap: 0.5,
                      columnGap: 1.5,
                    }}
                  >
                    {t.cols.map((c) => (
                      <SchemaColumnRow key={c.name} col={c} />
                    ))}
                  </Box>
                </Box>
              </Collapse>
            </Box>
          );
        })}
      </Stack>
    </SectionCard>
  );
}
SchemaCard.propTypes = { schema: PropTypes.array, totalRows: PropTypes.number };

function SchemaColumnRow({ col }) {
  return (
    <>
      <Box sx={{ display: "grid", placeItems: "center" }}>
        {col.pk && (
          <Tooltip arrow title="Primary key">
            <Iconify icon="solar:key-minimalistic-linear" width={11} sx={{ color: "#CA8A04" }} />
          </Tooltip>
        )}
      </Box>
      <Typography sx={{ typography: "s2", fontFamily: "ui-monospace, Menlo, monospace", fontWeight: col.pk ? 700 : 600 }}>
        {col.name}
      </Typography>
      <Typography sx={{ typography: "s3", fontFamily: "ui-monospace, Menlo, monospace", color: "text.subtitle" }}>
        {col.type}
      </Typography>
    </>
  );
}
SchemaColumnRow.propTypes = { col: PropTypes.object };

/* ── tool implementations ─────────────────────────────────────────────── */

/*
  The world's tool handlers, each with its fidelity dial (PRD v6 Story 5):
  how the tool answers in a run, and what goes wrong with it on purpose. A
  change to either is a world edit — the next run is on a new minor version.
*/
function ToolImplsCard({ env, tools, envState, patch }) {
  const [openTool, setOpenTool] = useState(null);
  const [allAnchor, setAllAnchor] = useState(null);
  const summary = toolEnvSummaryWords({ tools }, envState);

  const setTier = (setting, tier) => {
    if (!patch || setting.tier === tier) return;
    patch(toolEnvPatch(envState, setting.name, { tier, ...(tier !== "live" && { safeTarget: null }) }, `${setting.name} set to ${tierOf(tier).word}`));
  };
  /* Allow Live for one read-only tool and switch it there — one patch, so
     the permission and the tier land together. A world edit, like any tier. */
  const allowLive = (setting) => {
    if (!patch) return;
    const allowed = allowLivePatch(envState, setting.name, true).toolEnv;
    patch(toolEnvPatch({ ...envState, toolEnv: allowed }, setting.name, { tier: "live" }, `${setting.name} set to ${tierOf("live").word}`));
  };
  const setFaults = (setting, faults, word) => {
    if (!patch) return;
    patch(toolEnvPatch(envState, setting.name, { faults }, `${setting.name} faults set to ${word}`));
  };
  const applyAll = (presetId) => {
    setAllAnchor(null);
    if (patch) patch(allToolsFaultPatch({ ...env, tools }, envState, presetId));
  };

  return (
    <SectionCard
      title={`Tools · ${tools.length}`}
      subtitle={(
        <>
          <Box component="span" sx={{ color: "text.primary", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{summary}</Box>
          {" — how each tool answers during a run. A change is a world edit, saved as the next environment version."}
        </>
      )}
      action={patch && (
        <>
          <Button
            size="small"
            onClick={(e) => setAllAnchor(e.currentTarget)}
            startIcon={<Iconify icon="solar:bolt-linear" width={14} />}
            endIcon={<Iconify icon="solar:alt-arrow-down-linear" width={12} />}
            sx={{ typography: "s2", fontWeight: 600, color: "text.secondary", flexShrink: 0, whiteSpace: "nowrap" }}
          >
            Faults for all tools
          </Button>
          <Menu
            anchorEl={allAnchor}
            open={!!allAnchor}
            onClose={() => setAllAnchor(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
            slotProps={{ paper: { sx: { minWidth: 260, mt: 0.5 } } }}
          >
            {Object.entries(FAULT_PRESETS).map(([id, p]) => (
              <MenuItem key={id} onClick={() => applyAll(id)} sx={{ display: "block", py: 1 }}>
                <Typography sx={{ typography: "s2", fontWeight: 600 }}>{p.label}</Typography>
                <Typography sx={{ typography: "s3", color: "text.subtitle" }}>{faultLine(p.faults)}</Typography>
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
    >
      <Stack divider={<Box sx={{ borderBottom: "1px solid", borderColor: "divider" }} />}>
        {tools.map((tool) => {
          const open = openTool === tool.name;
          const impl = toolImplFor(tool);
          const setting = toolSettingOf(tool, envState);
          const unsafe = needsSafeTarget(setting);
          return (
            <Box key={tool.name}>
              <Stack
                direction="row"
                alignItems="center"
                spacing={1.5}
                {...clickable(() => setOpenTool(open ? null : tool.name), { expanded: open })}
                sx={{ ...focusRing, px: 2.5, py: 1.125, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
              >
                <Iconify
                  icon={open ? "solar:alt-arrow-down-linear" : "solar:alt-arrow-right-linear"}
                  width={13}
                  sx={{ color: "text.subtitle", flexShrink: 0 }}
                />
                <Iconify icon="solar:code-linear" width={15} sx={{ color: "#7857FC", flexShrink: 0 }} />
                <Typography
                  noWrap
                  sx={{ typography: "s2", fontWeight: 600, fontFamily: "ui-monospace, Menlo, monospace", width: 220, flexShrink: 0 }}
                >
                  {tool.name}
                </Typography>
                <Typography sx={{ typography: "s3", color: "text.subtitle", flex: 1, minWidth: 0 }} noWrap>
                  {setting.safeTarget && setting.tier === "live" ? `Live at ${setting.safeTarget}` : tool.desc}
                </Typography>
                <TierDial
                  setting={setting}
                  onChange={patch ? (tier) => setTier(setting, tier) : null}
                  onAllowLive={patch ? () => allowLive(setting) : null}
                />
                <FaultsControl
                  setting={setting}
                  onApply={patch ? (faults, word) => setFaults(setting, faults, word) : null}
                />
              </Stack>
              {liveAdvisoryOf(setting) && (
                <Box sx={{ px: 2.5, pb: 1.25, pl: 7.25 }}>
                  <LiveAdvisory setting={setting} onSwitch={patch ? (tier) => patch(downgradeTierPatch(envState, setting.name, tier)) : null} />
                </Box>
              )}
              {unsafe && (
                <Box sx={{ px: 2.5, pb: 1.25, pl: 7.25 }}>
                  <SafeTargetPrompt
                    setting={setting}
                    onConfirm={patch ? (url) => patch(safeTargetPatch(envState, setting.name, url)) : null}
                    onDowngrade={patch ? (tier) => patch(downgradeTierPatch(envState, setting.name, tier)) : null}
                  />
                </Box>
              )}
              <Collapse in={open} unmountOnExit>
                <ToolArgs tool={tool} envState={envState} />
                <CodeBlock file={impl.file} code={impl.code} />
              </Collapse>
            </Box>
          );
        })}
      </Stack>
    </SectionCard>
  );
}
ToolImplsCard.propTypes = { env: PropTypes.object, tools: PropTypes.array, envState: PropTypes.object, patch: PropTypes.func };

/* A tool's arguments, read-only — the limits among them are edited on the Contract tab. */
function ToolArgs({ tool, envState }) {
  const args = toolArgsOf(tool, envState);
  return (
    <Box sx={{ borderTop: "1px solid", borderColor: "divider", px: 2.5, pl: 7.25, py: 1.25 }}>
      <Typography sx={{ typography: "s3", fontWeight: 600, color: "text.subtitle", mb: 0.5 }}>Arguments</Typography>
      {args.length === 0
        ? <Typography sx={{ typography: "s3", color: "text.disabled" }}>None</Typography>
        : <ToolArgsGrid args={args} />}
    </Box>
  );
}
ToolArgs.propTypes = { tool: PropTypes.object.isRequired, envState: PropTypes.object };

/* ── scenario checks ──────────────────────────────────────────────────── */

/* What proves a scenario before it runs. Graders are a link, not a copy —
   one home for them, one versioning rule. */
function ProofChecksCard({ onGo }) {
  const [openCheck, setOpenCheck] = useState(null);
  /* The same eight checks in every environment — folded to one line until asked for. */
  const [shown, setShown] = useState(false);
  if (!shown) {
    return (
      <Stack
        direction="row" alignItems="center" spacing={1}
        {...clickable(() => setShown(true), { expanded: false })}
        sx={{ ...focusRing, px: 2, py: 1.25, borderRadius: 1, border: "1px solid", borderColor: "divider", cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
      >
        <Iconify icon="solar:shield-check-linear" width={15} sx={{ color: "text.subtitle" }} />
        <Typography sx={{ typography: "s2", fontWeight: 600 }}>{`Scenario checks · ${PROOF_CHECKS.length}`}</Typography>
        <Typography sx={{ typography: "s3", color: "text.subtitle", flex: 1 }}>What proves each scenario before it runs</Typography>
        <Iconify icon="solar:alt-arrow-down-linear" width={14} sx={{ color: "text.subtitle" }} />
      </Stack>
    );
  }
  return (
    <SectionCard
      title="Scenario checks"
      subtitle="What proves each scenario before it runs. On a run, sub-goals decide pass or fail; evaluations score each conversation"
      action={onGo && (
        <Typography
          {...clickable(() => onGo("evals"), { role: "link" })}
          sx={{ ...focusRing, typography: "s3", color: "primary.main", fontWeight: 700, cursor: "pointer" }}
        >
          Evaluations
        </Typography>
      )}
    >
      <Stack divider={<Box sx={{ borderBottom: "1px solid", borderColor: "divider" }} />}>
        {PROOF_CHECKS.map((check) => {
          const open = openCheck === check.id;
          return (
            <Box key={check.id}>
              <Stack
                direction="row"
                alignItems="center"
                spacing={1.5}
                {...clickable(() => setOpenCheck(open ? null : check.id), { expanded: open })}
                sx={{ ...focusRing, px: 2.5, py: 1.375, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
              >
                <Iconify
                  icon={open ? "solar:alt-arrow-down-linear" : "solar:alt-arrow-right-linear"}
                  width={13}
                  sx={{ color: "text.subtitle", flexShrink: 0 }}
                />
                <Iconify icon="solar:shield-check-linear" width={15} sx={{ color: "text.subtitle", flexShrink: 0 }} />
                <Typography
                  sx={{ typography: "s2", fontWeight: 600, fontFamily: "ui-monospace, Menlo, monospace", minWidth: 220 }}
                >
                  {check.name}
                </Typography>
                <Typography sx={{ typography: "s3", color: "text.subtitle", flex: 1, minWidth: 0 }} noWrap>
                  {check.desc}
                </Typography>
              </Stack>
              <Collapse in={open}>
                <CodeBlock file={check.file} code={check.code} />
              </Collapse>
            </Box>
          );
        })}
      </Stack>
    </SectionCard>
  );
}
ProofChecksCard.propTypes = { onGo: PropTypes.func };

/* ── shared code viewer ───────────────────────────────────────────────── */

function CodeBlock({ file, code }) {
  const { enqueueSnackbar } = useSnackbar();
  const copy = () => {
    navigator.clipboard?.writeText(code);
    enqueueSnackbar("Copied to clipboard", { variant: "info" });
  };
  return (
    <Box
      sx={{
        borderTop: "1px solid",
        borderColor: "divider",
        bgcolor: "background.neutral",
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{
          px: 2.5,
          py: 0.75,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: (t) => alpha(t.palette.text.primary, t.palette.mode === "dark" ? 0.06 : 0.03),
        }}
      >
        <Iconify icon="solar:file-text-linear" width={12} sx={{ color: "text.subtitle" }} />
        <Typography
          sx={{ typography: "s3", fontFamily: "ui-monospace, Menlo, monospace", color: "text.secondary", flex: 1 }}
        >
          {file}
        </Typography>
        <Tooltip arrow title="Copy code">
          <IconButton size="small" onClick={copy}>
            <Iconify icon="solar:copy-linear" width={12} sx={{ color: "text.subtitle" }} />
          </IconButton>
        </Tooltip>
      </Stack>
      <Box sx={{ px: 2.5, py: 1.5, maxHeight: 360, overflow: "auto" }}>
        <Typography
          component="pre"
          sx={{
            typography: "s3",
            fontFamily: "ui-monospace, Menlo, monospace",
            color: "text.primary",
            whiteSpace: "pre",
            m: 0,
            lineHeight: 1.6,
          }}
        >
          {code}
        </Typography>
      </Box>
    </Box>
  );
}
CodeBlock.propTypes = { file: PropTypes.string, code: PropTypes.string };
