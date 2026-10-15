import PropTypes from "prop-types";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { alpha } from "@mui/material/styles";
import {
  Box, Button, Chip, Dialog, IconButton, ListSubheader, MenuItem, Select, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import Iconify from "src/components/iconify";
import { clickable, focusRing } from "../../components/clickable";
import { connectedAgentPath } from "../../improvements/improvementNav";
import { useSimStore, useConnectedAgents } from "../../store";
import { agentDefinitionOf } from "../../_mock/agentRegistry";
import { getEval } from "../../_mock/evals";
import { currentAgentVersion } from "../../_mock/versions";
import { limitRows, OPTIMIZER_MODELS } from "../../_mock/optimizationRuns";
import { OPTIMIZERS, goalWords, improvementRunName } from "../../_mock/optimizer";
import { baseRunOf, budgetsWithin, improvementEstimate, outcomeMetricsOf, planSearch } from "../../_mock/improvementStart";
import { agentStatusOf } from "../../_mock/agentLifecycle";
import { runIdentityOf } from "../../_mock/runIdentity";
import { DEFAULT_METHOD } from "./improvementView";
import { limitsOf } from "../../agents/agentLimits";
import { rereadFor, textSearchDefault } from "../../_mock/improvementPolicy";
import { recordOutsideChange } from "../../_mock/nudgeEffects";
import { creditsLabel } from "../../_mock/metering";

const ACCENT = "#7857FC";
/* "Raise the pass rate", "Raise booking success rate", "Raise Policy adherence". */
const goalText = (g) => (g.id === "pass-rate" ? "Raise the pass rate" : `Raise ${g.group === "outcome" ? g.label.toLowerCase() : g.label}`);
const fieldLabel = { typography: "s2", fontWeight: 700, mb: 0.875 };
const selectSx = { height: 34, typography: "s2", "& .MuiSelect-select": { typography: "s2", py: 0.75 } };

/**
 * Improve my agent — the step between a run's Fix my agent diagnosis and
 * the search. The same smallest set of decisions it always asked for (a name,
 * an optimizer, the model doing the improving), plus the two the search can't
 * guess: the goal and what it may spend. The agent's constraints come along
 * as they are — summarised, changed on the agent.
 *
 * The caller (Fix my agent) has already decided the agent and environment
 * (`preset`) and starts the run itself (`onStart`).
 */
export default function ImprovementSetup({ open, onClose, preset, tasks, included = [], onStart }) {
  const navigate = useNavigate();
  const { state, commit } = useSimStore();
  const { agents } = useConnectedAgents();

  const main = state.myEnvironments.find((e) => e.id === preset?.envId) || null;
  const es = main ? state.byEnv[main.id] : null;
  const agent = agents.find((a) => a.key === preset?.agentKey) || null;

  const [name, setName] = useState("");
  const [optimizerId, setOptimizerId] = useState(DEFAULT_METHOD);
  const [model, setModel] = useState(OPTIMIZER_MODELS[0].id);
  const [goal, setGoal] = useState("pass-rate");
  const [budget, setBudget] = useState(null);

  useEffect(() => {
    if (!open) return;
    setName(improvementRunName(es, null));
    setOptimizerId(DEFAULT_METHOD);
    setModel(OPTIMIZER_MODELS[0].id);
    setGoal("pass-rate");
    setBudget(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const limits = useMemo(() => limitsOf(state, preset?.agentKey), [state, preset?.agentKey]);
  /* A voice agent searches in text; its finalists are confirmed as real calls. */
  const inText = main?.surface === "voice" && textSearchDefault(main?.surface);

  /* What the search scores candidates on: the pass rate, an outcome read
     from the tool calls, or one eval. */
  const goals = useMemo(() => [
    { id: "pass-rate", label: "Pass rate", group: "rate" },
    ...outcomeMetricsOf(main).map((m) => ({ ...m, group: "outcome" })),
    ...((es?.evals || []).map((e) => {
      const id = typeof e === "string" ? e : e.id;
      return { id, label: getEval(id)?.name || id, group: "eval" };
    })),
  ], [es, main]);
  const goalOf = goals.find((g) => g.id === goal) || goals[0];
  const goalArg = goalOf ? { id: goalOf.id, label: goalOf.label, group: goalOf.group } : undefined;

  const base = useMemo(() => (main ? baseRunOf(main, es) : null), [main, es]);
  const searchTasks = tasks || base?.tasks;
  const seed = `goal-${main?.id}-${(es?.optimizations || []).length}`;
  const envIds = main ? [main.id] : [];
  const preview = useMemo(
    () => (main && searchTasks ? planSearch({ env: main, es, agentVersion: base?.agentVersion || currentAgentVersion(es)?.label || null, tasks: searchTasks, limits, seed, textSearch: inText, goal: goalArg, optimizerId, state, regressionEnvIds: envIds }) : null),
    [main, es, base, searchTasks, limits, seed, inText, goalArg?.id, optimizerId, state], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const nothing = !!preview?.goal && preview.goalTargets === 0;
  const status = agent ? agentStatusOf(agent) : null;
  const blocked = status && status.status !== "connected" ? status.reason : null;
  const identity = main && es ? runIdentityOf({ agentVersion: base?.agentVersion || currentAgentVersion(es)?.label || null, envVersion: base?.envVersion || null }, es, main).label : null;
  const estimate = improvementEstimate({ preview, surface: main?.surface, extraScenarios: 0 });
  const budgets = budgetsWithin(limits.budget.dollars);
  const spend = budget ?? budgets[budgets.length - 1];
  const overBudget = estimate.likely > spend;

  const agentModel = useMemo(() => {
    if (!agent || !main) return null;
    const def = agentDefinitionOf({ agent, env: main, envState: es });
    return def.model?.visible ? def.model.name : null;
  }, [agent, main, es]);
  const constraints = limitRows(limits, agentModel).filter((c) => c.id !== "budget").map((c) => `${c.label}: ${c.value}`).join(" · ");

  const train = preview?.trainMeasured || 0;
  const held = preview?.heldMeasured || 0;
  const trials = preview?.trials?.length || 0;
  const ready = !!(agent && main && searchTasks && !blocked && !nothing && name.trim());

  const start = () => {
    /* Re-read the agent first; a change made outside Future AGI is saved as
       a version and becomes the baseline. */
    const reread = rereadFor(agent, state);
    recordOutsideChange(commit, state, { agent, reread, activateEnvId: main.id });
    onStart({
      name: name.trim(), model, optimizerId,
      agent, env: main, envIds, goal: goalOf, budget: spend, limits, seed, reread, textSearch: inText,
    });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 1.5, backgroundImage: "none" } }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 2.5, py: 2, borderBottom: "1px solid", borderColor: "divider" }}>
        <Box flex={1}>
          <Typography sx={{ typography: "s1", fontWeight: 700 }}>Improve my agent</Typography>
          <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
            {`Searches for a better ${agent?.name ? `${agent.name}` : "agent"}, scored by this environment`}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose}><Iconify icon="eva:close-fill" width={17} /></IconButton>
      </Stack>

      <Stack spacing={2.5} sx={{ px: 2.5, py: 2.5, maxHeight: "62vh", overflowY: "auto" }}>
        <Box>
          <Typography sx={fieldLabel}>Name</Typography>
          <TextField size="small" fullWidth value={name} onChange={(e) => setName(e.target.value)} sx={{ "& .MuiInputBase-input": { typography: "s2" } }} />
        </Box>

        <Box>
          <Typography sx={fieldLabel}>Search method</Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" rowGap={1} useFlexGap role="radiogroup" aria-label="Search method">
            {OPTIMIZERS.map((o) => {
              const active = o.id === optimizerId;
              return (
                <Tooltip key={o.id} arrow title={o.fit}>
                  <Box
                    {...clickable(() => setOptimizerId(o.id), { role: "radio", checked: active })}
                    sx={{
                      ...focusRing,
                      px: 1.5, py: 1.125, borderRadius: 1, cursor: "pointer", flex: "1 1 46%", minWidth: 190,
                      border: "1px solid", borderColor: active ? ACCENT : "divider",
                      bgcolor: (t) => (active ? alpha(ACCENT, t.palette.mode === "dark" ? 0.1 : 0.05) : "transparent"),
                      "&:hover": { borderColor: active ? ACCENT : "text.disabled" },
                    }}
                  >
                    <Stack direction="row" alignItems="center" spacing={0.75}>
                      <Iconify icon={active ? "solar:check-circle-bold" : "solar:circle-linear"} width={14} sx={{ color: active ? ACCENT : "text.disabled" }} />
                      {/* How many runs it tries is in Cost below — set by the budget, not the card. */}
                      <Typography sx={{ typography: "s2", fontWeight: 700 }}>{o.label}</Typography>
                    </Stack>
                    <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.25 }}>{o.desc}</Typography>
                  </Box>
                </Tooltip>
              );
            })}
          </Stack>
        </Box>

        <Box>
          <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.875 }}>
            <Typography sx={{ typography: "s2", fontWeight: 700 }}>Model</Typography>
            <Tooltip arrow title="The model doing the improving — reading failures and writing the changes each run tries. Not the model your agent runs on.">
              <Box component="span" sx={{ display: "flex" }}>
                <Iconify icon="solar:info-circle-linear" width={13} sx={{ color: "text.disabled" }} />
              </Box>
            </Tooltip>
          </Stack>
          <Stack direction="row" spacing={0.875} flexWrap="wrap" rowGap={0.875} useFlexGap>
            {OPTIMIZER_MODELS.map((m) => {
              const active = m.id === model;
              return (
                <Tooltip key={m.id} arrow title={m.note}>
                  <Chip
                    label={m.label}
                    onClick={() => setModel(m.id)}
                    sx={{
                      height: 27, borderRadius: 0.75, border: "1px solid",
                      borderColor: active ? ACCENT : "divider",
                      bgcolor: (t) => (active ? alpha(ACCENT, t.palette.mode === "dark" ? 0.12 : 0.06) : "transparent"),
                      color: active ? "text.primary" : "text.secondary",
                      "& .MuiChip-label": { px: 1.125, typography: "s2", fontWeight: 600 },
                      "&:hover": { bgcolor: (t) => alpha(ACCENT, t.palette.mode === "dark" ? 0.12 : 0.06) },
                    }}
                  />
                </Tooltip>
              );
            })}
          </Stack>
        </Box>

        {/* The two things the search can't guess — what to aim at, what it may spend. */}
        {main && (
          <Box>
            <Stack direction="row" spacing={1.5}>
              <Box flex={1} minWidth={0}>
                <Typography sx={fieldLabel}>Goal</Typography>
                <Select size="small" fullWidth value={goalOf.id} onChange={(e) => setGoal(e.target.value)} sx={selectSx} renderValue={() => goalText(goalOf)}>
                  {[["rate", null], ["outcome", "Outcomes · from tool calls"], ["eval", "Evaluations"]].flatMap(([group, title]) => {
                    const list = goals.filter((g) => g.group === group);
                    if (!list.length) return [];
                    return [
                      ...(title ? [<ListSubheader key={group} sx={{ typography: "s3", fontWeight: 700, color: "text.subtitle", lineHeight: "28px" }}>{title}</ListSubheader>] : []),
                      ...list.map((g) => <MenuItem key={g.id} value={g.id} sx={{ typography: "s2" }}>{goalText(g)}</MenuItem>),
                    ];
                  })}
                </Select>
              </Box>
              <Box sx={{ width: 180, flexShrink: 0 }}>
                <Typography sx={fieldLabel}>Budget</Typography>
                <Select size="small" fullWidth value={spend} onChange={(e) => setBudget(e.target.value)} sx={selectSx}>
                  {budgets.map((b) => <MenuItem key={b} value={b} sx={{ typography: "s2" }}>{creditsLabel(b)}</MenuItem>)}
                </Select>
              </Box>
            </Stack>
            <Typography sx={{ typography: "s3", color: nothing || overBudget ? "text.primary" : "text.subtitle", mt: 0.75 }}>
              {nothing
                ? `Nothing to improve — every scenario already meets ${goalWords(goalOf)}. Pick another goal.`
                : `${preview?.goal ? `Targets the ${preview.goalTargets} ${preview.goalTargets === 1 ? "scenario" : "scenarios"} short of it. ` : ""}${overBudget ? "Likely to stop at the budget — you'll get the best it found by then." : "If it runs over, it stops at the budget with the best it found."}`}
            </Typography>
          </Box>
        )}

        {/* What the search starts from, what it's never allowed to see, and what it costs. */}
        {main && (
          <Box sx={{ px: 2, py: 1.75, borderRadius: 1, border: "1px solid", borderColor: "divider", bgcolor: (t) => alpha(t.palette.text.primary, t.palette.mode === "dark" ? 0.03 : 0.015) }}>
            <Stack spacing={1.25}>
              <Row
                label="Starts from"
                value={`${identity || "the current version"} · ${included.length} ${included.length === 1 ? "change" : "changes"} you included`}
                note={included.length ? "Every run is built from these, so each one can be read line by line." : "Nothing included — the search explores every change the diagnosis found."}
              />
              <Row
                label="Scenarios"
                value={`${train} training · ${held} held back`}
                note="The headline number comes from the held-back scenarios, which are never shown while searching."
              />
              <Row
                label="Cost"
                value={`${trials} runs × ${train} scenarios · likely ${creditsLabel(estimate.likely)} · about ${estimate.minutes} min`}
                note={inText ? "Runs as text conversations; only the finalists are confirmed as real calls." : "A run is a full pass through the real tools, not a dataset lookup."}
              />
              <Row
                label="Limits"
                value="From the agent"
                note={constraints}
                action={agent ? { label: "Change", onClick: () => { onClose(); navigate(connectedAgentPath(agent.id, "constraints")); } } : null}
              />
            </Stack>
          </Box>
        )}
      </Stack>

      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 2.5, py: 2, borderTop: "1px solid", borderColor: "divider" }}>
        <Typography sx={{ typography: "s3", color: blocked ? "#DC2626" : "text.subtitle", flex: 1 }}>
          {blocked || (main && !searchTasks ? `${main.name} hasn't been run yet — run it once to set the baseline.` : "Nothing ships on its own — a winner comes back as a draft.")}
        </Typography>
        <Button onClick={onClose} sx={{ typography: "s2", fontWeight: 600, color: "text.secondary" }}>Cancel</Button>
        <Button
          variant="contained" color="primary" disabled={!ready} onClick={start}
          startIcon={<Iconify icon="solar:play-bold" width={15} />}
          sx={{ typography: "s2", fontWeight: 700 }}
        >
          Start improvement
        </Button>
      </Stack>
    </Dialog>
  );
}

ImprovementSetup.propTypes = {
  open: PropTypes.bool,
  onClose: PropTypes.func.isRequired,
  preset: PropTypes.shape({ agentKey: PropTypes.string, envId: PropTypes.string }).isRequired,
  tasks: PropTypes.array,
  /* The diagnosis changes ticked in Fix my agent. */
  included: PropTypes.array,
  onStart: PropTypes.func.isRequired,
};

function Row({ label, value, note, action }) {
  return (
    <Box>
      <Stack direction="row" alignItems="baseline" spacing={1}>
        <Typography sx={{ typography: "s3", color: "text.subtitle", width: 78, flexShrink: 0 }}>{label}</Typography>
        <Typography sx={{ typography: "s2", fontWeight: 600, flex: 1, minWidth: 0 }}>{value}</Typography>
        {action && (
          <Typography {...clickable(action.onClick)} sx={{ typography: "s3", fontWeight: 700, color: "text.secondary", cursor: "pointer", "&:hover": { color: "text.primary" }, ...focusRing }}>
            {action.label}
          </Typography>
        )}
      </Stack>
      {note && <Typography sx={{ typography: "s3", color: "text.subtitle", pl: "86px" }}>{note}</Typography>}
    </Box>
  );
}
Row.propTypes = { label: PropTypes.string, value: PropTypes.string, note: PropTypes.string, action: PropTypes.object };
