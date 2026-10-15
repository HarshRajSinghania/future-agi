import PropTypes from "prop-types";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSnackbar } from "notistack";
import { alpha } from "@mui/material/styles";
import { Box, Button, Collapse, MenuItem, Select, Stack, TextField, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { paths } from "src/routes/paths";
import { useSimStore } from "../store";
import { NUDGE_KINDS, openNudgesOf } from "../_mock/decoupled";
import { currentEnvSnapshot, nextSnapshotLabel } from "../_mock/envSnapshot";
import { envLabelOf } from "../_mock/envVersionKinds";
import {
  ANSWERS, answerRulePatch, approveRewritesPatch, approveAddPatch, approveRemovePatch, approveBehaviourPatch,
  dismissPatch, reopenPatch, forkFromNudge, draftSubGoalOf, runPrice, generationPrice, referenceOf, rerunHref,
  likelyFixLine, channelLabel, plural,
} from "../_mock/nudgeEffects";
import { clickable, focusRing } from "../components/clickable";

const MONO = "ui-monospace, Menlo, monospace";
const MAX_LISTED = 5;

const KIND_ICON = {
  rule: "solar:scale-linear",
  add: "solar:widget-add-linear",
  remove: "solar:minus-circle-linear",
  core: "solar:branching-paths-up-linear",
  behaviour: "solar:refresh-circle-linear",
};

/**
 * The nudges a new agent version raised in this environment — the top of
 * "Needs your input" (PRD v7 §4.10.5–4.10.6). An agent change never moves the
 * environment (E) or the scenario set (S) on its own; each card proposes what
 * would, with a diff, the E and S changes and their price, and waits for
 * Approve / Edit / Dismiss. Answered and dismissed ones stay listed below so
 * an answer can be changed later.
 */
export function NudgesSection({ env, envState, patch, focusId = null, onNavigate }) {
  const all = envState?.nudges || [];
  const open = openNudgesOf(envState);
  const done = all.filter((n) => n.status !== "open");
  const latest = envState?.agentVersions?.[envState.agentVersions.length - 1]?.label;
  const fixes = (envState?.likelyFixes || []).filter((f) => !latest || f.agentVersion === latest);
  const [showDone, setShowDone] = useState(false);
  if (!all.length && !fixes.length) return null;
  const focusNudge = focusId && focusId !== "nudges" ? focusId : null;
  const cardProps = { env, envState, patch, onNavigate };

  return (
    <Box sx={{ borderBottom: "1px solid", borderColor: "divider" }}>
      <Stack direction="row" alignItems="baseline" spacing={0.75} sx={{ px: 2.5, py: 1, bgcolor: "background.neutral" }}>
        <Typography sx={{ typography: "s3", fontWeight: 700, color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
          {`Suggestions · ${open.length}`}
        </Typography>
        <Typography noWrap sx={{ typography: "s3", color: "text.subtitle", flex: 1, minWidth: 0 }}>
          a new agent version asks — the environment and scenarios change only if you approve
        </Typography>
      </Stack>
      <Stack divider={<Box sx={{ borderBottom: "1px solid", borderColor: "divider" }} />} sx={{ borderTop: "1px solid", borderColor: "divider" }}>
        {open.map((n, i) => (
          <NudgeCard
            key={n.id} nudge={n} {...cardProps}
            focused={n.id === focusNudge}
            defaultOpen={n.id === focusNudge || (!focusNudge && i === 0)}
          />
        ))}
        {!open.length && (
          <Typography sx={{ px: 2.5, py: 1.25, typography: "s3", color: "text.subtitle" }}>
            Nothing waiting. Every nudge is answered or dismissed.
          </Typography>
        )}
        {fixes.map((f) => (
          <Stack key={`${f.ruleId}-${f.agentVersion}`} direction="row" spacing={1} alignItems="center" sx={{ px: 2.5, py: 0.875 }}>
            <Iconify icon="solar:check-read-linear" width={14} sx={{ color: "text.subtitle", flexShrink: 0 }} />
            <Typography sx={{ typography: "s3", color: "text.secondary" }}>
              {likelyFixLine(f)}
              <Box component="span" sx={{ color: "text.subtitle" }}>{` Agent ${f.agentVersion} · no question asked`}</Box>
            </Typography>
          </Stack>
        ))}
      </Stack>
      {done.length > 0 && (
        <>
          <Stack
            direction="row" alignItems="baseline" spacing={0.75} {...clickable(() => setShowDone((o) => !o), { expanded: showDone || done.some((n) => n.id === focusNudge) })}
            sx={{ ...focusRing, px: 2.5, py: 0.875, cursor: "pointer", borderTop: "1px solid", borderColor: "divider" }}
          >
            <Typography sx={{ typography: "s3", fontWeight: 700, color: "text.subtitle" }}>{`Answered or dismissed · ${done.length}`}</Typography>
            <Typography noWrap sx={{ typography: "s3", color: "text.subtitle", flex: 1, minWidth: 0 }}>change any answer here</Typography>
            <Iconify icon={showDone || done.some((n) => n.id === focusNudge) ? "solar:alt-arrow-up-linear" : "solar:alt-arrow-down-linear"} width={13} sx={{ color: "text.subtitle" }} />
          </Stack>
          <Collapse in={showDone || done.some((n) => n.id === focusNudge)}>
            <Stack divider={<Box sx={{ borderBottom: "1px solid", borderColor: "divider" }} />} sx={{ borderTop: "1px solid", borderColor: "divider" }}>
              {done.map((n) => <NudgeCard key={n.id} nudge={n} {...cardProps} focused={n.id === focusNudge} defaultOpen={n.id === focusNudge} />)}
            </Stack>
          </Collapse>
        </>
      )}
    </Box>
  );
}
NudgesSection.propTypes = {
  env: PropTypes.object.isRequired,
  envState: PropTypes.object.isRequired,
  patch: PropTypes.func,
  focusId: PropTypes.string,
  /* Called before the card navigates away (the inbox closes itself). */
  onNavigate: PropTypes.func,
};

/* ── one nudge ───────────────────────────────────────────────────────────── */

const statusLine = (n) => {
  if (n.status === "open") return "waiting on you";
  if (n.status === "dismissed") return "dismissed — E and S stay pinned";
  if (n.kind === "rule") return `answered · ${ANSWERS[n.answer]?.label.toLowerCase() || "answered"}`;
  return "approved";
};

export default function NudgeCard({ nudge, env, envState, patch, onNavigate, defaultOpen = false, focused = false }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { if (focused) { setOpen(true); ref.current?.scrollIntoView({ block: "center", behavior: "smooth" }); } }, [focused]);
  const meta = NUDGE_KINDS[nudge.kind] || { label: "Suggestion" };

  return (
    <Box ref={ref} sx={{ ...(focused && { bgcolor: (t) => alpha(t.palette.primary.main, t.palette.mode === "dark" ? 0.08 : 0.04) }) }}>
      <Stack
        direction="row" alignItems="center" spacing={1.5} {...clickable(() => setOpen((o) => !o), { expanded: open })}
        sx={{ ...focusRing, px: 2.5, py: 1.25, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
      >
        <Box sx={{
          width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center",
          border: "1px solid", borderColor: "divider", color: nudge.status === "open" ? "text.primary" : "text.disabled",
        }}>
          <Iconify icon={KIND_ICON[nudge.kind] || "solar:bell-linear"} width={12} />
        </Box>
        <Box flex={1} minWidth={0}>
          <Typography sx={{ typography: "s2", fontWeight: 600, color: nudge.status === "open" ? "text.primary" : "text.secondary" }}>{nudge.title}</Typography>
          <Typography noWrap sx={{ typography: "s3", color: "text.subtitle" }}>
            {`${meta.label} · agent ${nudge.agentVersion}${nudge.prevVersion ? ` vs ${nudge.prevVersion}` : ""} · ${statusLine(nudge)}`}
          </Typography>
        </Box>
        <Iconify icon={open ? "solar:alt-arrow-up-linear" : "solar:alt-arrow-down-linear"} width={14} sx={{ color: "text.subtitle", flexShrink: 0 }} />
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 2.5, pb: 1.75, pl: 6 }}>
          {nudge.kind === "rule"
            ? <RuleQuestion nudge={nudge} env={env} envState={envState} patch={patch} onNavigate={onNavigate} />
            : <ChangeProposal nudge={nudge} env={env} envState={envState} patch={patch} onNavigate={onNavigate} />}
        </Box>
      </Collapse>
    </Box>
  );
}
NudgeCard.propTypes = {
  nudge: PropTypes.object.isRequired,
  env: PropTypes.object.isRequired,
  envState: PropTypes.object.isRequired,
  patch: PropTypes.func,
  onNavigate: PropTypes.func,
  defaultOpen: PropTypes.bool,
  focused: PropTypes.bool,
};

/* ── the fix-or-policy question (§4.10.6) ────────────────────────────────── */

const ANSWER_BODY = (n, sgNext) => ({
  policy: `${n.ruleId} now reads the way ${n.agentVersion} behaves. ${sgNext} is drafted for you to review; ${plural((n.callerIds || []).length, "scenario")} whose caller depends on the old rule go outdated with drafted rewrites. The scenario set gets a new version; the environment doesn't. Compare shows this sub-goal as criteria changed.`,
  "not-intended": `${n.agentVersion} wasn't meant to behave this way. Nothing changes — if it fails the sub-goal, that's a regression, listed first in Compare.`,
  unsure: `Keep @1 as the baseline and record ${sgNext} as a draft shadow. The next run is graded both ways, with a reminder to decide.`,
});

function RuleQuestion({ nudge, env, envState, patch, onNavigate }) {
  const { enqueueSnackbar } = useSnackbar();
  const isOpen = nudge.status === "open";
  const draft0 = useMemo(() => draftSubGoalOf(envState, nudge), [envState, nudge]);
  const [choice, setChoice] = useState(nudge.answer || nudge.prefill?.answer || null);
  const [name, setName] = useState(draft0.name);
  const [criterion, setCriterion] = useState(draft0.criterion);
  const [editing, setEditing] = useState(false);
  const rows = (nudge.scenarioIds || []).map((id) => (envState.scenarios || []).find((s) => s.id === id)).filter(Boolean);
  const callers = new Set(nudge.callerIds || []);
  const sgNext = `${draft0.id}${draft0.version}`;
  const body = ANSWER_BODY(nudge, sgNext);
  const E = currentEnvSnapshot(env, envState)?.label;
  const nextE = nextSnapshotLabel(env, envState);

  const record = () => {
    if (!patch || !choice) return;
    patch(answerRulePatch(env, envState, nudge, choice, { draft: { ...draft0, name: name.trim() || draft0.name, criterion: criterion.trim() || draft0.criterion } }));
    enqueueSnackbar(
      choice === "policy"
        ? `${sgNext} published — ${plural(callers.size, "scenario")} outdated, rewrites drafted. E stays ${E}.`
        : choice === "unsure"
          ? `${nudge.ruleId}: @1 stays the baseline, ${sgNext} kept as a shadow`
          : `${nudge.ruleId}: nothing changes — a failure on it is a regression`,
      { variant: "success", autoHideDuration: 4000 },
    );
  };

  return (
    <Stack spacing={1.25}>
      <Typography sx={{ typography: "s2", color: "text.secondary" }}>
        {`${nudge.agentVersion} changed how the agent handles ${nudge.ruleId}. An agent that follows the new wording could fail the sub-goal written for the old one — a policy change, not intended, or unsure?`}
      </Typography>

      <Diff lines={[
        { sign: "−", text: `${nudge.ruleId}  ${nudge.rule}` },
        { sign: "+", text: nudge.to || nudge.rule },
      ]} caption={nudge.change ? `${nudge.change.title}${nudge.change.detail ? ` · ${nudge.change.detail}` : ""}` : null} />

      {isOpen ? (
        <>
          {nudge.prefill && (
            <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
              {`Pre-filled from the change note: “${nudge.prefill.from}”`}
            </Typography>
          )}
          <Stack spacing={0.75}>
            {Object.entries(ANSWERS).map(([id, a]) => (
              <Choice key={id} on={choice === id} onClick={() => setChoice(id)} title={a.label} body={body[id]} />
            ))}
          </Stack>

          {(choice === "policy" || choice === "unsure") && (
            <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1.25, overflow: "hidden" }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 0.875, bgcolor: "background.neutral" }}>
                <Typography sx={{ typography: "s3", fontWeight: 700, flex: 1 }}>
                  <Box component="span" sx={{ fontFamily: MONO }}>{sgNext}</Box>
                  {choice === "unsure" ? " · draft shadow" : " · drafted for you to review"}
                </Typography>
                {patch && (
                  <Button size="small" onClick={() => setEditing((e) => !e)} sx={{ typography: "s3", fontWeight: 700, color: "text.secondary", minWidth: 0, py: 0 }}>
                    {editing ? "Done" : "Edit"}
                  </Button>
                )}
              </Stack>
              {editing ? (
                <Stack spacing={1} sx={{ p: 1.5 }}>
                  <TextField size="small" label="Sub-goal" value={name} onChange={(e) => setName(e.target.value)} InputProps={{ sx: { typography: "s2" } }} />
                  <TextField size="small" label="Passes when" multiline maxRows={4} value={criterion} onChange={(e) => setCriterion(e.target.value)} InputProps={{ sx: { typography: "s2" } }} />
                </Stack>
              ) : (
                <Box sx={{ px: 1.5, py: 1 }}>
                  <Typography sx={{ typography: "s2", fontWeight: 600 }}>{name}</Typography>
                  <Typography sx={{ typography: "s3", color: "text.secondary", mt: 0.25 }}>{criterion}</Typography>
                </Box>
              )}
            </Box>
          )}

          <TestedBy nudge={nudge} rows={rows} callers={callers} choice={choice} />

          <Effects rows={[
            ["Environment", choice === "policy" ? `${E} → ${nextE} · the sub-goal and the scenarios that test it change` : `stays ${E}`],
            ["Scenario set", choice === "policy" ? `${plural(callers.size, "scenario")} outdated until rewritten` : "unchanged"],
            ["Sub-goal", choice === "policy" ? `${sgNext} published; @1 stays on every past run` : choice === "unsure" ? `@1 baseline · ${sgNext} shadow` : "unchanged"],
            ["Price", "Free to answer. A bridge run is offered after rewrites, priced, never started for you"],
          ]} />

          {patch && (
            <Stack direction="row" spacing={0.75} justifyContent="flex-end">
              <Button size="small" onClick={() => patch(dismissPatch(envState, nudge))} sx={{ typography: "s2", fontWeight: 700, color: "text.secondary" }}>Dismiss</Button>
              <Button size="small" variant="contained" color="primary" disabled={!choice} onClick={record} sx={{ typography: "s2", fontWeight: 700 }}>
                {!choice ? "Pick an answer" : choice === "policy" ? `Publish ${sgNext}` : `Record · ${ANSWERS[choice].label.toLowerCase()}`}
              </Button>
            </Stack>
          )}
        </>
      ) : (
        <RuleOutcome nudge={nudge} env={env} envState={envState} patch={patch} onNavigate={onNavigate} />
      )}
    </Stack>
  );
}
RuleQuestion.propTypes = { nudge: PropTypes.object, env: PropTypes.object, envState: PropTypes.object, patch: PropTypes.func, onNavigate: PropTypes.func };

/* What an answered question did, its history, and changing your mind. */
function RuleOutcome({ nudge, env, envState, patch, onNavigate }) {
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const rw = nudge.rewrites;
  const ref = referenceOf(envState);
  const go = (href) => { onNavigate?.(); navigate(href); };
  const rewritten = rw?.status === "approved" ? rw.ids : [];

  return (
    <Stack spacing={1}>
      {nudge.status === "dismissed" ? (
        <Typography sx={{ typography: "s3", color: "text.secondary" }}>
          Dismissed. The sub-goal and scenarios stay as they were; the new version is graded against the old rule, and the drift badge stays.
        </Typography>
      ) : (
        <Typography sx={{ typography: "s3", color: "text.secondary" }}>
          {nudge.answer === "policy" && `${nudge.published} published as a policy change from agent ${nudge.agentVersion}. Compare reports it as criteria changed: ${nudge.prevVersion || "the old version"} under @1, ${nudge.agentVersion} under the new one.`}
          {nudge.answer === "not-intended" && `Not intended — nothing changed. If ${nudge.agentVersion} fails the sub-goal, Compare lists it first as a regression.`}
          {nudge.answer === "unsure" && `Unsure — @1 stays the baseline; the drafted criteria are kept as a shadow and graded alongside.`}
        </Typography>
      )}

      {nudge.answer === "policy" && rw?.drafts?.length > 0 && (
        <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1.25, overflow: "hidden" }}>
          <Typography sx={{ px: 1.5, py: 0.75, typography: "s3", fontWeight: 700, bgcolor: "background.neutral" }}>
            {rw.status === "approved" ? `${plural(rw.drafts.length, "rewrite")} approved · major version each` : `${plural(rw.drafts.length, "drafted rewrite")} · outdated until approved`}
          </Typography>
          {rw.drafts.slice(0, MAX_LISTED).map((d) => (
            <Box key={d.id} sx={{ px: 1.5, py: 0.75, borderTop: "1px solid", borderColor: "divider" }}>
              <Typography noWrap sx={{ typography: "s3", fontWeight: 600 }}>{d.name}</Typography>
              <Typography sx={{ typography: "s3", color: "text.secondary" }}>{d.to}</Typography>
            </Box>
          ))}
          {rw.drafts.length > MAX_LISTED && (
            <Typography sx={{ px: 1.5, py: 0.75, borderTop: "1px solid", borderColor: "divider", typography: "s3", color: "text.subtitle" }}>{`and ${rw.drafts.length - MAX_LISTED} more`}</Typography>
          )}
          {patch && rw.status !== "approved" && (
            <Stack direction="row" justifyContent="flex-end" sx={{ px: 1.5, py: 0.75, borderTop: "1px solid", borderColor: "divider" }}>
              <Button
                size="small" variant="outlined"
                onClick={() => { patch(approveRewritesPatch(envState, nudge)); enqueueSnackbar(`${plural(rw.drafts.length, "scenario")} rewritten — each a new major version`, { variant: "success" }); }}
                sx={{ typography: "s3", fontWeight: 700, color: "text.primary", borderColor: "divider" }}
              >
                {`Approve ${plural(rw.drafts.length, "rewrite")}`}
              </Button>
            </Stack>
          )}
        </Box>
      )}

      {/* New S version → bridge and reference re-runs, priced, started only on a click. */}
      {rewritten.length > 0 && (
        <Offers>
          {nudge.prevVersion && (
            <Offer
              label={`Bridge: run ${nudge.prevVersion} on the ${plural(rewritten.length, "rewritten scenario")}`}
              price={runPrice(env, rewritten.length).line}
              onClick={() => go(rerunHref(env.id, { agent: nudge.prevVersion, only: rewritten }))}
            />
          )}
          {ref && ref.label !== nudge.prevVersion && (
            <Offer
              label={`Re-run reference ${ref.label} on them`}
              price={runPrice(env, rewritten.length).line}
              onClick={() => go(rerunHref(env.id, { agent: ref.label, only: rewritten }))}
            />
          )}
        </Offers>
      )}

      <History nudge={nudge} />
      {patch && (
        <Box>
          <Button size="small" onClick={() => patch(reopenPatch(envState, nudge))} sx={{ typography: "s3", fontWeight: 700, color: "text.secondary", minWidth: 0, px: 0 }}>
            {nudge.status === "dismissed" ? "Reopen" : "Change answer"}
          </Button>
        </Box>
      )}
    </Stack>
  );
}
RuleOutcome.propTypes = { nudge: PropTypes.object, env: PropTypes.object, envState: PropTypes.object, patch: PropTypes.func, onNavigate: PropTypes.func };

function TestedBy({ nudge, rows, callers, choice }) {
  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1.25, overflow: "hidden" }}>
      <Typography sx={{ px: 1.5, pt: 0.875, pb: 0.5, typography: "s3", fontWeight: 700, color: "text.subtitle", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {`Tested by · ${plural((nudge.subGoals || []).length, "sub-goal")} · ${plural(rows.length, "scenario")}`}
      </Typography>
      {(nudge.subGoals || []).map((g) => (
        <Row key={g.id} icon="solar:checklist-minimalistic-linear" text={g.name} right={choice === "policy" ? "new version" : choice === "unsure" ? "@1 + shadow" : "unchanged"} />
      ))}
      {rows.slice(0, MAX_LISTED).map((s) => (
        <Row key={s.id} icon="solar:layers-minimalistic-linear" text={s.name || s.title || s.id} right={choice === "policy" && callers.has(s.id) ? "outdated · caller depends on it" : "unchanged"} />
      ))}
      {rows.length > MAX_LISTED && (
        <Typography sx={{ px: 1.5, py: 0.75, borderTop: "1px solid", borderColor: "divider", typography: "s3", color: "text.subtitle" }}>{`and ${rows.length - MAX_LISTED} more`}</Typography>
      )}
    </Box>
  );
}
TestedBy.propTypes = { nudge: PropTypes.object, rows: PropTypes.array, callers: PropTypes.object, choice: PropTypes.string };

/* ── Add / Remove / Core / Behaviour (§4.10.5) ───────────────────────────── */

function ChangeProposal({ nudge, env, envState, patch, onNavigate }) {
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const { dispatch } = useSimStore();
  const [editing, setEditing] = useState(false);
  const [count, setCount] = useState(3);
  const [picked, setPicked] = useState(() => new Set(nudge.scenarioIds || []));
  const [forkName, setForkName] = useState(`${env.name} · ${channelLabel(nudge.channel?.to)}`);
  const isOpen = nudge.status === "open";
  const E = currentEnvSnapshot(env, envState)?.label;
  const nextE = nextSnapshotLabel(env, envState);
  const ref = referenceOf(envState);
  const rows = (nudge.scenarioIds || []).map((id) => (envState.scenarios || []).find((s) => s.id === id)).filter(Boolean);
  const go = (href) => { onNavigate?.(); navigate(href); };

  const approve = () => {
    if (!patch) return;
    if (nudge.kind === "add") {
      const { patch: p, ids } = approveAddPatch(env, envState, nudge, { count });
      patch(p);
      enqueueSnackbar(`Environment ${nextE} has a ${nudge.capability} handler · ${plural(ids.length, "exploration scenario")} added`, { variant: "success" });
    } else if (nudge.kind === "remove") {
      patch(approveRemovePatch(envState, { ...nudge, scenarioIds: [...picked] }));
      enqueueSnackbar(`${plural(picked.size, "scenario")} not applicable to versions without ${nudge.capability} — kept in the set`, { variant: "success" });
    } else if (nudge.kind === "behaviour") {
      patch(approveBehaviourPatch(env, envState, nudge));
      enqueueSnackbar(`Environment ${nextE}: ${nudge.capability} handler updated`, { variant: "success" });
    } else if (nudge.kind === "core") {
      const { forked, forkState, sourcePatch } = forkFromNudge(env, envState, nudge);
      const named = { ...forked, name: forkName.trim() || forked.name };
      dispatch({ type: "adoptEnvironment", env: named, now: new Date().toISOString() });
      dispatch({ type: "patchEnvState", envId: named.id, patch: forkState });
      patch({ ...sourcePatch, nudges: sourcePatch.nudges.map((n) => (n.id === nudge.id ? { ...n, forkName: named.name } : n)) });
      enqueueSnackbar(`${named.name} created — ${forkState.envVersions[0].note}`, { variant: "success" });
    }
  };

  const diff = {
    add: [{ sign: "+", text: `tool ${nudge.capability}` }],
    remove: [{ sign: "−", text: `tool ${nudge.capability}` }],
    behaviour: [{ sign: "~", text: `${nudge.capability} handler · ${(nudge.paths || []).slice(0, 2).join(", ")}` }],
    core: [
      { sign: "−", text: `channel ${channelLabel(nudge.channel?.from).toLowerCase()}` },
      { sign: "+", text: `channel ${channelLabel(nudge.channel?.to).toLowerCase()}` },
    ],
  }[nudge.kind] || [];

  const n = nudge.kind === "remove" ? picked.size : rows.length;
  const effects = {
    add: [
      ["Environment", `${E} → ${nextE} · adds a ${nudge.capability} handler and ${plural(count, "exploration scenario")}`],
      ["Scenario set", `+${plural(count, "exploration scenario")} in a New band`],
      ["Price", `Generating ${count} · ${generationPrice(count).line}. Backfill is offered after, priced`],
    ],
    remove: [
      ["Environment", `${E} → ${nextE} · the scenario set changes, the world doesn't`],
      ["Scenario set", `${plural(n, "scenario")} not applicable to versions without ${nudge.capability}, kept`],
      ["Price", "Free · they aren't run or charged for versions without it"],
      ["If dismissed", `they keep running and score fail · capability-missing, counted`],
    ],
    behaviour: [
      ["Environment", `${E} → ${nextE} · handler follows the agent`],
      ["Scenario set", "unchanged · scenarios using it are rechecked"],
      ["Price", "Free to approve; rechecks run in a sandbox"],
    ],
    core: [
      ["Environment", `new environment, forked from ${env.name}, environment ${envLabelOf(env, envState, nudge.envVersion)}`],
      ["Scenario set", `${nudge.scenarioIds.length} of ${nudge.total} carried with their ids · the rest stay here`],
      ["Price", `Free to fork. A reference re-run is offered after (${runPrice({ surface: nudge.channel?.to }, nudge.scenarioIds.length, 1).line} at 1 repeat)`],
      ["This environment", `stays ${E}`],
    ],
  }[nudge.kind] || [];

  return (
    <Stack spacing={1.25}>
      <Typography sx={{ typography: "s2", color: "text.secondary" }}>{nudge.ask}</Typography>
      <Diff lines={diff} caption={nudge.detail} />

      {isOpen ? (
        <>
          {nudge.kind === "remove" && rows.length > 0 && (
            <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1.25, overflow: "hidden" }}>
              {(editing ? rows : rows.slice(0, MAX_LISTED)).map((s) => (
                <Row
                  key={s.id} icon={picked.has(s.id) ? "solar:check-square-linear" : "solar:stop-linear"} text={s.name || s.title || s.id}
                  right={picked.has(s.id) ? "not applicable" : "keeps running"}
                  onClick={editing ? () => setPicked((p) => { const x = new Set(p); if (x.has(s.id)) x.delete(s.id); else x.add(s.id); return x; }) : undefined}
                />
              ))}
              {!editing && rows.length > MAX_LISTED && (
                <Typography sx={{ px: 1.5, py: 0.75, borderTop: "1px solid", borderColor: "divider", typography: "s3", color: "text.subtitle" }}>{`and ${rows.length - MAX_LISTED} more`}</Typography>
              )}
            </Box>
          )}
          {editing && nudge.kind === "add" && (
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography sx={{ typography: "s3", color: "text.secondary" }}>Scenarios to generate</Typography>
              <Select size="small" value={count} onChange={(e) => setCount(Number(e.target.value))} sx={{ typography: "s2", height: 28 }}>
                {[1, 2, 3].map((k) => <MenuItem key={k} value={k} sx={{ typography: "s2" }}>{k}</MenuItem>)}
              </Select>
            </Stack>
          )}
          {editing && nudge.kind === "core" && (
            <TextField size="small" label="New environment" value={forkName} onChange={(e) => setForkName(e.target.value)} InputProps={{ sx: { typography: "s2" } }} />
          )}

          <Effects rows={effects} />

          {patch && (
            <Stack direction="row" spacing={0.75} justifyContent="flex-end">
              <Button size="small" onClick={() => patch(dismissPatch(envState, nudge))} sx={{ typography: "s2", fontWeight: 700, color: "text.secondary" }}>Dismiss</Button>
              {nudge.kind !== "behaviour" && (
                <Button size="small" variant="outlined" onClick={() => setEditing((e) => !e)} sx={{ typography: "s2", fontWeight: 700, color: "text.primary", borderColor: "divider" }}>
                  {editing ? "Done" : "Edit"}
                </Button>
              )}
              <Button size="small" variant="contained" color="primary" onClick={approve} disabled={nudge.kind === "remove" && !picked.size} sx={{ typography: "s2", fontWeight: 700 }}>
                {nudge.kind === "core" ? "Approve · fork" : "Approve"}
              </Button>
            </Stack>
          )}
        </>
      ) : (
        <Stack spacing={1}>
          <Typography sx={{ typography: "s3", color: "text.secondary" }}>
            {nudge.status === "dismissed" && (nudge.kind === "remove"
              ? `Dismissed. The ${plural(nudge.scenarioIds.length, "scenario")} keep running and score fail · capability-missing on versions without ${nudge.capability}.`
              : "Dismissed. The environment stays pinned; the drift badge stays so nothing is hidden.")}
            {nudge.status === "approved" && nudge.kind === "add" && `Approved · environment ${envLabelOf(env, envState, nudge.envVersion)} has the handler · ${plural((nudge.addedIds || []).length, "exploration scenario")} added, in the New band until backfilled.`}
            {nudge.status === "approved" && nudge.kind === "remove" && `Approved · not applicable to agent versions without ${nudge.capability}. Nothing retired — they come back if ${nudge.capability} does.`}
            {nudge.status === "approved" && nudge.kind === "behaviour" && `Approved · environment ${envLabelOf(env, envState, nudge.envVersion)} follows the new ${nudge.capability} behaviour.`}
            {nudge.status === "approved" && nudge.kind === "core" && `Approved · forked as ${nudge.forkName}. This environment stays as it was.`}
          </Typography>

          {nudge.status === "approved" && nudge.kind === "add" && (nudge.addedIds || []).length > 0 && (
            <Offers>
              {nudge.prevVersion && (
                <Offer
                  label={`Backfill: run ${nudge.prevVersion} on the ${plural(nudge.addedIds.length, "new scenario")}`}
                  price={runPrice(env, nudge.addedIds.length).line}
                  onClick={() => go(rerunHref(env.id, { agent: nudge.prevVersion, only: nudge.addedIds }))}
                />
              )}
              {ref && ref.label !== nudge.prevVersion && (
                <Offer
                  label={`Re-run reference ${ref.label} on them`}
                  price={runPrice(env, nudge.addedIds.length).line}
                  onClick={() => go(rerunHref(env.id, { agent: ref.label, only: nudge.addedIds }))}
                />
              )}
            </Offers>
          )}
          {nudge.status === "approved" && nudge.kind === "remove" && ref && (
            <Offers>
              <Offer
                label={`Re-run reference ${ref.label} on the new scenario set`}
                price={runPrice(env, Math.max(0, (envState.scenarios || []).filter((r) => !r.archived && !r.retired).length - nudge.scenarioIds.length), 1).line}
                onClick={() => go(rerunHref(env.id, { agent: ref.label, trials: 1 }))}
              />
            </Offers>
          )}
          {nudge.status === "approved" && nudge.kind === "core" && nudge.forkId && (
            <Offers>
              <Offer label={`Open ${nudge.forkName}`} onClick={() => go(paths.dashboard.simulate.environmentDetail(nudge.forkId))} />
              <Offer
                label={`Re-run reference ${nudge.agentVersion} in the fork to re-anchor`}
                price={runPrice({ surface: nudge.channel?.to }, nudge.scenarioIds.length, 1).line}
                onClick={() => go(rerunHref(nudge.forkId, { agent: nudge.agentVersion, trials: 1 }))}
              />
            </Offers>
          )}
          {patch && nudge.status === "dismissed" && (
            <Box>
              <Button size="small" onClick={() => patch(reopenPatch(envState, nudge))} sx={{ typography: "s3", fontWeight: 700, color: "text.secondary", minWidth: 0, px: 0 }}>Reopen</Button>
            </Box>
          )}
        </Stack>
      )}
    </Stack>
  );
}
ChangeProposal.propTypes = { nudge: PropTypes.object, env: PropTypes.object, envState: PropTypes.object, patch: PropTypes.func, onNavigate: PropTypes.func };

/* ── small parts ─────────────────────────────────────────────────────────── */

function Diff({ lines, caption }) {
  if (!lines.length) return null;
  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1.25, overflow: "hidden", bgcolor: "background.neutral" }}>
      {lines.map((l, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <Stack key={i} direction="row" sx={{ borderTop: i ? "1px solid" : "none", borderColor: "divider" }}>
          <Typography component="span" sx={{ width: 26, flexShrink: 0, textAlign: "center", fontFamily: MONO, fontSize: 12, lineHeight: 1.8, color: "text.subtitle" }}>{l.sign}</Typography>
          <Typography component="span" sx={{
            fontFamily: MONO, fontSize: 12, lineHeight: 1.8, pr: 1.5, wordBreak: "break-word",
            color: l.sign === "−" ? "text.subtitle" : "text.primary",
            textDecoration: l.sign === "−" ? "line-through" : "none",
            textDecorationColor: (t) => alpha(t.palette.text.primary, 0.3),
          }}>
            {l.text}
          </Typography>
        </Stack>
      ))}
      {caption && (
        <Typography sx={{ px: 1.5, py: 0.625, borderTop: "1px solid", borderColor: "divider", typography: "s3", color: "text.subtitle", bgcolor: "background.paper" }}>{caption}</Typography>
      )}
    </Box>
  );
}
Diff.propTypes = { lines: PropTypes.array, caption: PropTypes.string };

function Effects({ rows }) {
  return (
    <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "112px 1fr", columnGap: 1.5, rowGap: 0.5 }}>
      {rows.map(([k, v]) => (
        <Box key={k} sx={{ display: "contents" }}>
          <Typography component="dt" sx={{ typography: "s3", color: "text.subtitle" }}>{k}</Typography>
          <Typography component="dd" sx={{ m: 0, typography: "s3", color: "text.primary", fontVariantNumeric: "tabular-nums" }}>{v}</Typography>
        </Box>
      ))}
    </Box>
  );
}
Effects.propTypes = { rows: PropTypes.array };

function Choice({ on, onClick, title, body }) {
  return (
    <Stack direction="row" alignItems="flex-start" spacing={1.25} {...clickable(onClick, { role: "radio", checked: on })}
      sx={{ ...focusRing,
        px: 1.5, py: 1, borderRadius: 1.25, cursor: "pointer", border: "1px solid",
        borderColor: on ? "text.primary" : "divider",
        bgcolor: (t) => (on ? alpha(t.palette.text.primary, t.palette.mode === "dark" ? 0.06 : 0.03) : "transparent"),
      }}
    >
      <Box sx={{ width: 14, height: 14, mt: 0.375, borderRadius: "50%", flexShrink: 0, border: "1.5px solid", borderColor: on ? "text.primary" : "text.disabled", display: "grid", placeItems: "center" }}>
        {on && <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: "text.primary" }} />}
      </Box>
      <Box minWidth={0}>
        <Typography sx={{ typography: "s2", fontWeight: 700 }}>{title}</Typography>
        <Typography sx={{ typography: "s3", color: "text.secondary", mt: 0.125 }}>{body}</Typography>
      </Box>
    </Stack>
  );
}
Choice.propTypes = { on: PropTypes.bool, onClick: PropTypes.func, title: PropTypes.string, body: PropTypes.string };

function Row({ icon, text, right, onClick }) {
  return (
    <Stack
      direction="row" alignItems="center" spacing={1} {...clickable(onClick)}
      sx={{ ...focusRing, px: 1.5, py: 0.625, borderTop: "1px solid", borderColor: "divider", ...(onClick && { cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }) }}
    >
      <Iconify icon={icon} width={14} sx={{ color: "text.subtitle", flexShrink: 0 }} />
      <Typography noWrap sx={{ typography: "s3", flex: 1, minWidth: 0 }}>{text}</Typography>
      <Typography noWrap sx={{ typography: "s3", color: "text.subtitle", flexShrink: 0 }}>{right}</Typography>
    </Stack>
  );
}
Row.propTypes = { icon: PropTypes.string, text: PropTypes.string, right: PropTypes.string, onClick: PropTypes.func };

function Offers({ children }) {
  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1.25, overflow: "hidden" }}>
      <Typography sx={{ px: 1.5, pt: 0.75, pb: 0.25, typography: "s3", color: "text.subtitle" }}>Offered, not started — nothing is spent until you click</Typography>
      {children}
    </Box>
  );
}
Offers.propTypes = { children: PropTypes.node };

function Offer({ label, price, onClick }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 0.75, borderTop: "1px solid", borderColor: "divider" }}>
      <Typography sx={{ typography: "s3", flex: 1, minWidth: 0 }}>{label}</Typography>
      {price && <Typography sx={{ typography: "s3", color: "text.subtitle", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{price}</Typography>}
      <Button
        size="small" variant="outlined" onClick={onClick}
        endIcon={<Iconify icon="solar:arrow-right-linear" width={13} />}
        sx={{ flexShrink: 0, typography: "s3", fontWeight: 700, color: "text.primary", borderColor: "divider", py: 0.125 }}
      >
        {price ? "Run" : "Open"}
      </Button>
    </Stack>
  );
}
Offer.propTypes = { label: PropTypes.string, price: PropTypes.string, onClick: PropTypes.func };

function History({ nudge }) {
  const answers = nudge.answers || [];
  if (answers.length < 2) return null;
  return (
    <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
      {`History: ${answers.map((a) => `${ANSWERS[a.answer]?.label || a.answer} (${new Date(a.at).toLocaleDateString()})`).join(" → ")}`}
    </Typography>
  );
}
History.propTypes = { nudge: PropTypes.object };
