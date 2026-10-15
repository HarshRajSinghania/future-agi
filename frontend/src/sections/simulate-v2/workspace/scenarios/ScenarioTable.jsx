import PropTypes from "prop-types";
import { Fragment, useContext, useEffect, useMemo, useState } from "react";
import {
  Box, Stack, Typography, Table, TableBody, TableCell, TableHead, TableRow,
  IconButton, Tooltip, Checkbox,
} from "@mui/material";
import Iconify from "src/components/iconify";
import { subTasksFor } from "../../_mock/contract";
import { admissionOf } from "../../_mock/coverage";
import { versionNumber } from "../../_mock/versions";
import { ScenarioRowContext } from "./scenarioRowContext";
import BlockerFlag from "./BlockerFlag";
import { StateChip, ArchiveControl, TextAction, TierBadge, CanaryBadge, PriorityPicker } from "./ScenarioStateBits";
import { goalKeyOf } from "../../_mock/mustPassProtection";
import { stateActionOf, STATE_ACTION_LABEL, archivedOf } from "../../_mock/scenarioStates";
import { isAnchor } from "../../_mock/tiers";
import { subGoalResultsOf } from "../../_mock/scenarioSubGoals";
import { envLabelOf } from "../../_mock/envVersionKinds";
import { clickable, focusRing } from "../../components/clickable";

/* Neutral white-on-selected checkbox — no primary colour, keeps the
   table's monochrome treatment. */
const selectableCheckboxSx = {
  p: 0,
  color: "text.disabled",
  "&.Mui-checked": { color: "text.primary" },
  "&.MuiCheckbox-indeterminate": { color: "text.primary" },
};

const PASS = "#16A34A";
const FAIL = "#DC2626";
const FLAKY = "#E9690C";

/* Shown on row hover only — so thirty rows of icons don't shout. */
const onHover = { opacity: 0, transition: "opacity .12s ease", ".MuiTableRow-root:hover &, &:focus-within": { opacity: 1 } };

/**
 * Scenarios as a table — one calm line each.
 *
 * The row answers "which scenario is this, who calls, can I trust it, and how
 * has it been doing": its name, the caller, its state when it needs
 * attention, whether it's must-pass or in the anchor core, and its last runs.
 * Everything else — the situation, sub-goals, tools, ideal outcome, proof —
 * is one click away in the scenario itself. Edit, archive and delete sit on
 * the row's hover.
 */
/* A scenario a later rebuild added is not part of an older pinned version. */
const laterThanPinned = (row, envVersion) => !!(row?.addedInEnv && envVersion
  && versionNumber(row.addedInEnv) > versionNumber(envVersion));

const COLUMNS = [
  { id: "select", w: 40 },
  { id: "#", label: "#", w: 40 },
  { id: "scenario", label: "Scenario", tip: "A status shows only when the scenario needs something" },
  { id: "persona", label: "Persona", w: 180 },
  { id: "subgoals", label: "Sub-goals", w: 88, align: "right", tip: "Sub-goals met in the scenario's latest run, of all it's graded on" },
  { id: "priority", label: "Priority", w: 84, tip: "What a quick run takes, and what goes first when a run is capped. Must-pass scenarios are always high." },
  { id: "mustPass", label: "Must-pass", w: 84, align: "center", tip: "An improvement that breaks a must-pass scenario is rejected" },
  { id: "runs", label: "Last runs", w: 116, tip: "This scenario in the environment's last runs, oldest to latest" },
  { id: "actions", w: 104 },
];

/*
  The state only when it asks for something — a column of "Valid" is noise.
  Its one action shows on hover.
*/
function StatusCell({ row, state, onAction, locked }) {
  if (!state || state.id === "valid") return null;
  const action = stateActionOf(state);
  return (
    <Stack direction="row" alignItems="center" spacing={1}>
      <StateChip state={state} />
      {action && onAction && !locked && (
        <Box sx={onHover}>
          <TextAction onClick={(e) => { e.stopPropagation(); onAction(action, row); }}>
            {STATE_ACTION_LABEL[action]}
          </TextAction>
        </Box>
      )}
    </Stack>
  );
}
StatusCell.propTypes = { row: PropTypes.object.isRequired, state: PropTypes.object, onAction: PropTypes.func, locked: PropTypes.bool };

/*
  A tier worth saying on the row: exploration, or a proposal with its Approve.
  Anchor core and core sit in the scenario itself and in Filter.
*/
function TierTag({ row, onAction, locked }) {
  if (row.proposed) {
    return (
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ flexShrink: 0 }}>
        <TierBadge row={row} compact />
        {onAction && !locked && (
          <TextAction onClick={(e) => { e.stopPropagation(); onAction("approve", row); }}>Approve</TextAction>
        )}
      </Stack>
    );
  }
  return row.tier === "exploration" ? <Box sx={{ display: "inline-flex", flexShrink: 0 }}><TierBadge row={row} compact /></Box> : null;
}
TierTag.propTypes = { row: PropTypes.object.isRequired, onAction: PropTypes.func, locked: PropTypes.bool };

/* "2/3" — sub-goals met in the latest run the scenario was in, each one on
   hover. No run yet: just how many it has. */
function SubGoalsCell({ total, latest, env, envState }) {
  const results = latest ? subGoalResultsOf(latest.task, env, envState).items : [];
  /* Never run: just how many it's graded on — "–/3" read as empty. */
  if (!latest && total) {
    return (
      <Tooltip arrow title={`Graded on ${total} sub-goal${total === 1 ? "" : "s"} · how many were met shows after the first run`}>
        <Typography sx={{ typography: "s2", color: "text.secondary", fontVariantNumeric: "tabular-nums", cursor: "default" }}>{total}</Typography>
      </Tooltip>
    );
  }
  if (!results.length) {
    return (
      <Tooltip arrow title={total ? `${total} sub-goals · not scored in a recent run` : ""}>
        <Typography sx={{ typography: "s2", color: "text.subtitle", fontVariantNumeric: "tabular-nums", cursor: "default" }}>{total ? `–/${total}` : "—"}</Typography>
      </Tooltip>
    );
  }
  const met = results.filter((g) => g.status === "met").length;
  const title = (
    <Stack spacing={0.25} sx={{ py: 0.25 }}>
      <Typography sx={{ typography: "s3", fontWeight: 700, color: "inherit" }}>{`${latest.name} · ${met} of ${results.length} met`}</Typography>
      {results.map((g) => (
        <Typography key={g.key || g.text} sx={{ typography: "s3", color: "inherit" }}>
          {`${g.status === "met" ? "✓" : g.status === "inconclusive" ? "?" : "✗"} ${g.text || g.label}`}
        </Typography>
      ))}
    </Stack>
  );
  return (
    <Tooltip arrow title={title}>
      <Typography sx={{ typography: "s2", fontVariantNumeric: "tabular-nums", cursor: "default", color: "text.secondary" }}>
        <Box component="span" sx={{ color: met < results.length ? "text.primary" : "text.secondary", fontWeight: met < results.length ? 600 : 400 }}>{met}</Box>
        <Box component="span" sx={{ color: "text.subtitle" }}>{`/${results.length}`}</Box>
      </Typography>
    </Tooltip>
  );
}
SubGoalsCell.propTypes = { total: PropTypes.number, latest: PropTypes.object, env: PropTypes.object, envState: PropTypes.object };

/* The last runs as dots, oldest to latest: green passed, red failed, orange
   flaky, hollow when the scenario wasn't in that run or wasn't scored. */
function RunDots({ history }) {
  if (!history?.length) return <Typography sx={{ typography: "s3", color: "text.disabled" }}>No runs yet</Typography>;
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      {history.map((h) => {
        const color = { passed: PASS, failed: FAIL, flaky: FLAKY }[h.status] || null;
        const word = { passed: "Passed", failed: "Failed", flaky: "Flaky" }[h.status] || (h.status ? "Not scored" : "Not in this run");
        return (
          <Tooltip key={h.runId} arrow title={`${h.name} · ${word}`}>
            <Box
              sx={{
                width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                bgcolor: color || "transparent",
                border: color ? "none" : "1px solid",
                borderColor: "text.disabled",
              }}
            />
          </Tooltip>
        );
      })}
    </Stack>
  );
}
RunDots.propTypes = { history: PropTypes.array };

export default function ScenarioTable({
  rows, groups, env, envState, envVersion, onEdit, onRemove, selectedIds, onSelectionChange, locked = false,
  goalActions = false, mustPassGoals = [],
}) {
  /* Stored env labels read as major.minor ("v3" → "v2.1"). */
  const vl = (label) => (envState ? envLabelOf(env, envState, label) : label);
  const { stateOf, onStateAction, onOpen, historyOf, latestOf } = useContext(ScenarioRowContext);
  /*
    Two shapes come in: pre-grouped (list view mirror) or a flat rows
    array (fallback). If groups are given, render section-header rows
    between them so the table reads the same use-case story as the
    list; if not, fall back to a flat table.
  */
  const sections = useMemo(
    () => (groups?.length ? groups : [{ id: "all", label: null, rows: rows || [] }]),
    [groups, rows],
  );

  const allIds = useMemo(
    () => sections.flatMap((s) => (s.rows || []).map((r) => r.id)).filter(Boolean),
    [sections],
  );

  /*
    Selection is a bulk-action affordance, not a run gate — every scenario in
    the table runs on the next simulation regardless. Controlled from the
    parent so the SelectionBar and the workspace chat stay in sync; falls
    back to internal state when unwired.
  */
  const [internalSelected, setInternalSelected] = useState(() => new Set());
  const isControlled = Array.isArray(selectedIds);
  const selected = isControlled ? new Set(selectedIds) : internalSelected;

  const commit = (next) => {
    if (!isControlled) setInternalSelected(next);
    onSelectionChange?.(Array.from(next));
  };

  /* Uncontrolled only: drop ids for rows that are gone. Controlled tables
     (one per batch, sharing one selection) leave pruning to the parent. */
  useEffect(() => {
    if (isControlled) return;
    const cleaned = Array.from(selected).filter((id) => allIds.includes(id));
    if (cleaned.length !== selected.size) commit(new Set(cleaned));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allIds.join("|")]);

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    commit(next);
  };
  /* Select-all affects only this batch's rows. */
  const hereSelected = allIds.filter((id) => selected.has(id)).length;
  const toggleAll = () => {
    const next = new Set(selected);
    if (hereSelected === allIds.length && allIds.length > 0) allIds.forEach((id) => next.delete(id));
    else allIds.forEach((id) => next.add(id));
    commit(next);
  };
  const allChecked = allIds.length > 0 && hereSelected === allIds.length;
  const someChecked = hereSelected > 0 && hereSelected < allIds.length;
  let counter = 0;

  const cellSx = { py: 0, height: 48, verticalAlign: "middle", borderColor: "divider" };
  /* The runs column says how many runs its dots cover — the environment's last
     eight, or fewer while it has fewer. */
  const firstRow = (rows && rows[0]) || groups?.find((g) => g.rows?.length)?.rows[0];
  const runsShown = historyOf && firstRow ? (historyOf(firstRow) || []).length : 0;
  /* No runs yet: the runs column would be "No runs yet" on every row — leave it out. */
  const columns = runsShown ? COLUMNS : COLUMNS.filter((c) => c.id !== "runs");
  const labelOf = (c) => (c.id === "runs" && runsShown ? `Last ${runsShown} run${runsShown === 1 ? "" : "s"}` : c.label);

  return (
    <Box sx={{ overflowX: "auto" }}>
      <Table size="small" sx={{ minWidth: 860, tableLayout: "fixed" }}>
        <colgroup>
          {columns.map((c) => <col key={c.id} style={c.w ? { width: c.w } : undefined} />)}
        </colgroup>
        <TableHead>
          <TableRow>
            {columns.map((c) => (
              <TableCell
                key={c.id}
                align={c.align || (c.id === "actions" ? "right" : "left")}
                padding={c.id === "select" ? "checkbox" : "normal"}
                sx={{
                  typography: "s3", fontWeight: 600, color: "text.subtitle", whiteSpace: "nowrap",
                  bgcolor: "background.paper", borderBottom: "1px solid", borderColor: "divider", py: 1,
                  ...(c.id === "select" && { pl: 1.5 }),
                  ...(c.id === "#" && { px: 1 }),
                }}
              >
                {c.id === "select" ? (
                  <Checkbox
                    size="small" checked={allChecked} indeterminate={someChecked}
                    onChange={toggleAll} disabled={locked} sx={selectableCheckboxSx}
                  />
                ) : c.tip ? (
                  <Tooltip arrow title={c.tip}><span>{labelOf(c)}</span></Tooltip>
                ) : labelOf(c)}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>

        <TableBody>
          {sections.map((section) => (
            <Fragment key={section.id}>
              {section.label && (
                <TableRow sx={{ "&:hover .goal-act, & .goal-act:focus-within": { opacity: 1 } }}>
                  <TableCell colSpan={columns.length} sx={{ borderBottom: "1px solid", borderColor: "divider", py: 1, px: 2 }}>
                    <Stack direction="row" alignItems="center" spacing={1.25}>
                      <Typography noWrap sx={{ typography: "s2", fontWeight: 600, flex: 1, minWidth: 0 }}>{section.label}</Typography>
                      {/* A goal marked must-pass covers every scenario in it, and ones added later. */}
                      {goalActions && goalKeyOf(section.rows[0]) && (() => {
                        const key = goalKeyOf(section.rows[0]);
                        const on = mustPassGoals.includes(key);
                        return (
                          <>
                            {on && (
                              <Tooltip arrow title="Every scenario in this goal is must-pass, and scenarios added to it join. An improvement that breaks one is rejected.">
                                <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flexShrink: 0 }}>
                                  <Iconify icon="solar:shield-check-bold" width={13} sx={{ color: "text.primary" }} />
                                  <Typography sx={{ typography: "s3", fontWeight: 600, color: "text.secondary" }}>Must-pass goal</Typography>
                                </Stack>
                              </Tooltip>
                            )}
                            {onStateAction && !locked && (
                              <Box className="goal-act" sx={{ opacity: 0, transition: "opacity .12s ease", flexShrink: 0 }}>
                                <TextAction onClick={() => onStateAction("goal-blocker", section.rows[0], !on)}>
                                  {on ? "Remove goal must-pass" : "Mark goal must-pass"}
                                </TextAction>
                              </Box>
                            )}
                          </>
                        );
                      })()}
                      <Typography sx={{ typography: "s3", fontWeight: 600, color: "text.subtitle", fontVariantNumeric: "tabular-nums" }}>
                        {section.rows.length}
                      </Typography>
                    </Stack>
                  </TableCell>
                </TableRow>
              )}

              {section.rows.map((row) => {
                counter += 1;
                const idx = counter;
                const p = row.persona;
                const archived = !!archivedOf(row);
                const goals = (row.subTasks?.length ? row.subTasks : subTasksFor(row, env)) || [];
                const headline = row.summary || row.title || row.name;
                const adm = admissionOf(row, env);
                const personaMeta = [p?.ageGroup, !p?.ageGroup && p?.role].filter(Boolean).join(" · ");
                const open = onOpen ? () => onOpen(row) : undefined;
                const stop = (e) => e.stopPropagation();
                return (
                  <TableRow
                    key={row.id}
                    hover
                    {...clickable(open, { role: "row" })}
                    sx={{ ...focusRing,
                      cursor: open ? "pointer" : "default",
                      ...(selected.has(row.id) && { bgcolor: "action.selected" }),
                      /* Archived rows stay listed, dimmed; the state and the actions keep full strength. */
                      ...(archived && { "& .scn-dim": { opacity: 0.45 } }),
                    }}
                  >
                    <TableCell padding="checkbox" sx={{ ...cellSx, pl: 1.5 }} onClick={stop}>
                      <Checkbox
                        size="small" checked={selected.has(row.id)} onChange={() => toggle(row.id)}
                        disabled={locked} sx={selectableCheckboxSx}
                      />
                    </TableCell>
                    <TableCell sx={{ ...cellSx, px: 1, typography: "s3", color: "text.subtitle", fontVariantNumeric: "tabular-nums" }}>
                      {idx}
                    </TableCell>

                    {/* SCENARIO — what it is, in words, and how many sub-goals
                        grade it. The id-style name is on hover and inside. */}
                    <TableCell className="scn-dim" sx={cellSx}>
                      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
                        <Tooltip arrow enterDelay={400} title={row.name && row.name !== headline ? row.name : ""}>
                          <Typography noWrap sx={{ typography: "s2", fontWeight: 500, minWidth: 40, flexShrink: 1 }}>{headline}</Typography>
                        </Tooltip>
                        {row.newTool && (
                          <Tooltip
                            arrow
                            title={laterThanPinned(row, envVersion)
                              ? `Added when environment ${vl(row.addedInEnv)} learned ${row.newTool}. It isn't part of environment ${vl(envVersion)}, so runs on ${vl(envVersion)} leave it out.`
                              : `Added when environment ${vl(row.addedInEnv)} learned ${row.newTool}`}
                          >
                            <Typography noWrap sx={{ typography: "s3", color: "text.secondary", flexShrink: 0, px: 0.5, border: "1px solid", borderColor: "divider", borderRadius: 0.5 }}>
                              {laterThanPinned(row, envVersion) ? `Needs environment ${vl(row.addedInEnv)}` : "New"}
                            </Typography>
                          </Tooltip>
                        )}
                        {row.canary && <CanaryBadge />}
                        <TierTag row={row} onAction={onStateAction} locked={locked} />
                        {!adm.admitted && (
                          <Tooltip arrow title={`Quarantined — ${adm.reason}`}>
                            <Box sx={{ display: "flex", flexShrink: 0 }}>
                              <Iconify icon="solar:shield-cross-bold" width={13} sx={{ color: FAIL }} />
                            </Box>
                          </Tooltip>
                        )}
                        {stateOf && (
                          <Box onClick={stop} sx={{ display: "inline-flex", flexShrink: 0 }}>
                            <StatusCell row={row} state={stateOf(row)} onAction={onStateAction} locked={locked} />
                          </Box>
                        )}
                      </Stack>
                    </TableCell>

                    {/* PERSONA — who calls, in one line. */}
                    <TableCell className="scn-dim" sx={cellSx}>
                      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minWidth: 0 }}>
                        {p?.libraryId != null && (
                          <Tooltip arrow title={p.edited ? "From the persona library, edited here" : "From the persona library"}>
                            <Box sx={{ display: "flex", flexShrink: 0 }}>
                              <Iconify icon="solar:users-group-rounded-linear" width={13} sx={{ color: "text.subtitle" }} />
                            </Box>
                          </Tooltip>
                        )}
                        <Typography noWrap sx={{ typography: "s2", color: "text.secondary", minWidth: 0 }}>
                          {p?.name || "—"}
                          {personaMeta && <Box component="span" sx={{ color: "text.subtitle" }}>{` · ${personaMeta}`}</Box>}
                        </Typography>
                      </Stack>
                    </TableCell>

                    {/* SUB-GOALS — met in the latest run, of all. */}
                    <TableCell align="right" sx={cellSx}>
                      <SubGoalsCell total={goals.length} latest={latestOf ? latestOf(row) : null} env={env} envState={envState} />
                    </TableCell>

                    {/* PRIORITY — plain text, changed in place. */}
                    <TableCell sx={cellSx} onClick={stop}>
                      <PriorityPicker
                        row={row}
                        locked={locked}
                        onChange={onStateAction ? (p) => onStateAction("priority", row, p) : undefined}
                      />
                    </TableCell>

                    {/* MUST-PASS — the triangle, toggled in place; hollow on hover. */}
                    <TableCell align="center" sx={cellSx} onClick={stop}>
                      <BlockerFlag
                        row={row}
                        size={14}
                        locked={locked || !!row.archived}
                        onToggle={onStateAction ? () => onStateAction("blocker", row, !row.critical) : undefined}
                      />
                    </TableCell>

                    {/* LAST RUNS — how it's been doing (once there are runs). */}
                    {runsShown > 0 && (
                      <TableCell sx={cellSx}>
                        <RunDots history={historyOf ? historyOf(row) : null} />
                      </TableCell>
                    )}

                    {/* Edit · archive · delete, on hover. */}
                    <TableCell align="right" sx={{ ...cellSx, whiteSpace: "nowrap", pr: 1 }} onClick={stop}>
                      <Box sx={onHover}>
                        <Tooltip arrow title={locked ? "Fork this environment to edit." : "Edit scenario"}>
                          <span>
                            <IconButton size="small" disabled={locked} onClick={() => onEdit(row)}>
                              <Iconify icon="solar:pen-new-square-linear" width={15} sx={{ color: "text.subtitle" }} />
                            </IconButton>
                          </span>
                        </Tooltip>
                        {archived ? (
                          <Tooltip arrow title={locked ? "Read-only." : "Restore — run and count it again"}>
                            <span>
                              <IconButton size="small" disabled={locked} onClick={() => onStateAction?.("restore", row)} aria-label="Restore scenario">
                                <Iconify icon="solar:restart-linear" width={15} sx={{ color: "text.subtitle" }} />
                              </IconButton>
                            </span>
                          </Tooltip>
                        ) : (
                          <ArchiveControl disabled={locked} anchor={isAnchor(row)} onArchive={(note) => onStateAction?.("archive", row, note)} />
                        )}
                        <Tooltip arrow title={locked ? "Fork this environment to edit." : "Remove from this environment"}>
                          <span>
                            <IconButton size="small" disabled={locked} onClick={() => onRemove(row.id)}>
                              <Iconify icon="solar:trash-bin-trash-linear" width={15} sx={{ color: "text.subtitle" }} />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  </TableRow>
                );
              })}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

ScenarioTable.propTypes = {
  goalActions: PropTypes.bool,
  mustPassGoals: PropTypes.array,
  rows: PropTypes.array.isRequired,
  rowHeight: PropTypes.string,
  groups: PropTypes.array,
  env: PropTypes.object,
  envState: PropTypes.object,
  envVersion: PropTypes.string,
  onEdit: PropTypes.func,
  onRemove: PropTypes.func,
  onHideGroup: PropTypes.func,
  selectedIds: PropTypes.array,
  onSelectionChange: PropTypes.func,
  locked: PropTypes.bool,
};
