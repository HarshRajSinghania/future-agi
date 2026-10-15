import PropTypes from "prop-types";
import { useMemo, useState } from "react";
import { Box, Button, Stack, TextField, Tooltip, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { DEFAULT_LIMITS, SURFACES, allowedLabel, ceilingLabel, modelLimitLabel } from "../../_mock/optimizationRuns";
import { BUILTIN_MODELS, limitsCustomised } from "../../_mock/connectAgent";
import { agentFilesOf } from "../../_mock/agentFiles";
import { costLimitLabel, costModeOf, defaultCostAbs, protectablePartsOf } from "../../_mock/agentConstraints";
import { surfaceAvailability } from "../agentLimits";
import ProtectedPartsPicker, { ProtectedPartLabel } from "../ProtectedPartsPicker";
import { ChipCard, SegmentedToggle } from "../../environments/StartEnvironment";
import { Hint, HintLine } from "./replicationBits";

const MONO = "ui-monospace, Menlo, monospace";

/**
 * The last step of every New agent flow: what an improvement may change and
 * what must not move. Most people keep the safe defaults, so they read as a
 * short summary; Customize turns the same rows into controls in place.
 * Only a customised set is saved — the defaults stay the defaults.
 */
export default function ConnectConstraintsStep({ agent, model, limits, onChange }) {
  const [editing, setEditing] = useState(false);
  const custom = limitsCustomised(limits);
  const avail = surfaceAvailability(agent);
  /* What can be protected, read from the files the record would show. */
  const parts = useMemo(() => protectablePartsOf(agentFilesOf({ agent }).files), [agent]);
  const protectedList = limits.protected || [];
  const protectable = protectedList.length > 0 || parts.files.length + parts.tools.length + parts.sections.length > 0;
  const set = (patch) => onChange({ ...limits, ...patch });

  const toggleSurface = (id) => {
    const on = limits.allowed.includes(id);
    /* Something has to stay changeable, or there's nothing to improve. */
    if (on && limits.allowed.length === 1) return;
    set({ allowed: on ? limits.allowed.filter((x) => x !== id) : [...limits.allowed, id] });
  };
  const toggleApproved = (id) => {
    const list = limits.model.approved || [];
    set({ model: { ...limits.model, approved: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] } });
  };

  return (
    <Stack spacing={1.5}>
      <Typography component="div" sx={{ typography: "s2", color: "text.secondary" }}>
        <HintLine hint="From the Error Feed, a failed run or a goal. The defaults are safe for most agents; change them later on the agent's Constraints tab.">
          Every improvement for this agent is held to these.
        </HintLine>
      </Typography>

      <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
        <Stack
          direction="row" alignItems="center" spacing={1}
          sx={{ px: 1.75, py: 1, borderBottom: "1px solid", borderColor: "divider", bgcolor: "background.neutral" }}
        >
          <Typography sx={{ typography: "s3", fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "text.subtitle", flex: 1 }}>
            {custom ? "Customized" : "Safe defaults"}
          </Typography>
          {custom && (
            <Button
              size="small"
              onClick={() => onChange(DEFAULT_LIMITS)}
              sx={{ typography: "s3", fontWeight: 600, color: "text.secondary", minWidth: 0, py: 0 }}
            >
              Reset to defaults
            </Button>
          )}
          <Button
            size="small"
            onClick={() => setEditing((o) => !o)}
            startIcon={<Iconify icon={editing ? "solar:alt-arrow-up-linear" : "solar:pen-2-linear"} width={13} />}
            sx={{ typography: "s2", fontWeight: 700, color: "text.primary", py: 0 }}
          >
            {editing ? "Done" : "Customize"}
          </Button>
        </Stack>

        <Row label="May change" hint="Deeper changes need stronger proof and stricter review.">
          {editing ? (
            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
              {SURFACES.map((s) => {
                const a = avail[s.id];
                const on = limits.allowed.includes(s.id);
                /* What it can't take is shown locked with the reason — not hidden. */
                return (
                  <Tooltip key={s.id} arrow placement="top" title={a.ok ? `e.g. ${s.example} · ${s.delivered}` : a.why}>
                    <Box sx={{ display: "inline-flex", ...(!a.ok && { opacity: 0.6 }) }}>
                      <ChipCard
                        icon={!a.ok ? "solar:lock-keyhole-minimalistic-linear" : on ? "solar:check-square-bold" : "solar:square-linear"}
                        label={s.label}
                        on={a.ok && on}
                        onClick={a.ok ? () => toggleSurface(s.id) : undefined}
                      />
                    </Box>
                  </Tooltip>
                );
              })}
            </Stack>
          ) : (
            <Value>{`${allowedLabel(limits.allowed.filter((id) => avail[id]?.ok))} only`}</Value>
          )}
        </Row>

        <Row label="Model">
          {editing ? (
            <Stack spacing={1}>
              <SegmentedToggle
                value={limits.model.mode}
                onChange={(mode) => set({ model: { ...limits.model, mode } })}
                options={[{ value: "locked", label: "Locked" }, { value: "approved", label: "Approved list" }]}
              />
              {limits.model.mode === "approved" && (
                <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                  {BUILTIN_MODELS.filter((m) => m.id !== model).map((m) => (
                    <ChipCard
                      key={m.id}
                      label={m.label}
                      on={(limits.model.approved || []).includes(m.id)}
                      onClick={() => toggleApproved(m.id)}
                    />
                  ))}
                </Stack>
              )}
            </Stack>
          ) : (
            <Value mono={!!model}>{modelLimitLabel(limits, model)}</Value>
          )}
        </Row>

        <Row label="Cost per conversation">
          {editing ? (
            <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
              <SegmentedToggle
                value={costModeOf(limits)}
                onChange={(m) => set(m === "abs" ? { costMode: m, costCeilingAbs: limits.costCeilingAbs ?? defaultCostAbs() } : { costMode: m })}
                options={[{ value: "pct", label: "%" }, { value: "abs", label: "$" }]}
              />
              {costModeOf(limits) === "abs" ? (
                <DollarField value={limits.costCeilingAbs ?? defaultCostAbs()} onChange={(n) => set({ costCeilingAbs: n })} />
              ) : (
                <PercentField value={limits.costCeiling} onChange={(n) => set({ costCeiling: n })} />
              )}
            </Stack>
          ) : (
            <Value>{costLimitLabel(limits)}</Value>
          )}
        </Row>

        <Row label="Latency">
          {editing ? (
            <PercentField value={limits.latencyCeiling} onChange={(n) => set({ latencyCeiling: n })} />
          ) : (
            <Value>{ceilingLabel(limits.latencyCeiling)}</Value>
          )}
        </Row>

        <Row label="Budget per improvement" last={!protectable}>
          {editing ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <NumberField value={limits.budget.dollars} prefix="$" width={96} onChange={(n) => set({ budget: { ...limits.budget, dollars: n } })} />
              <NumberField value={limits.budget.minutes} suffix="min" width={96} onChange={(n) => set({ budget: { ...limits.budget, minutes: n } })} />
            </Stack>
          ) : (
            <Value>{`$${limits.budget.dollars} · ${limits.budget.minutes} min`}</Value>
          )}
        </Row>

        {/* Files, tools or prompt sections no change may touch. */}
        {protectable && (
          <Row label="Never edit" last>
            {editing ? (
              <ProtectedPartsPicker value={protectedList} parts={parts} onChange={(next) => set({ protected: next })} />
            ) : (
              <Value>
                {protectedList.length
                  ? protectedList.map((x, i) => <span key={x}>{i > 0 && ", "}<ProtectedPartLabel entry={x} /></span>)
                  : "Nothing protected"}
              </Value>
            )}
          </Row>
        )}
      </Box>
    </Stack>
  );
}

ConnectConstraintsStep.propTypes = {
  /* A preview of the record being connected — decides which kinds of change it can take. */
  agent: PropTypes.object.isRequired,
  model: PropTypes.string,
  limits: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
};

function Row({ label, hint, last, children }) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={{ xs: 0.5, sm: 2 }}
      alignItems={{ sm: "center" }}
      sx={{ px: 1.75, py: 1.125, borderBottom: last ? "none" : "1px solid", borderColor: "divider" }}
    >
      <Box sx={{ width: { sm: 180 }, flexShrink: 0 }}>
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <Typography sx={{ typography: "s2", color: "text.subtitle" }}>{label}</Typography>
          <Hint text={hint} />
        </Stack>
      </Box>
      <Box flex={1} minWidth={0}>{children}</Box>
    </Stack>
  );
}
Row.propTypes = { label: PropTypes.string, hint: PropTypes.string, last: PropTypes.bool, children: PropTypes.node };

function Value({ mono, children }) {
  return (
    <Typography sx={{ typography: "s2", fontWeight: 600, ...(mono && { fontFamily: MONO }) }}>
      {children}
    </Typography>
  );
}
Value.propTypes = { mono: PropTypes.bool, children: PropTypes.node };

function NumberField({ value, onChange, prefix, suffix, width = 110 }) {
  return (
    <TextField
      size="small"
      value={String(value ?? "")}
      onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "").slice(0, 5)) || 0)}
      inputProps={{ inputMode: "numeric" }}
      InputProps={{
        startAdornment: prefix ? <Typography sx={{ typography: "s2", color: "text.subtitle", mr: 0.5 }}>{prefix}</Typography> : null,
        endAdornment: suffix ? <Typography sx={{ typography: "s3", color: "text.subtitle", ml: 0.5 }}>{suffix}</Typography> : null,
      }}
      sx={{ width, "& .MuiInputBase-input": { typography: "s2", fontVariantNumeric: "tabular-nums" } }}
    />
  );
}
NumberField.propTypes = { value: PropTypes.number, onChange: PropTypes.func, prefix: PropTypes.string, suffix: PropTypes.string, width: PropTypes.number };

/* Dollars to the cent — typed as text so "0." survives until the next digit. */
function DollarField({ value, onChange }) {
  const [text, setText] = useState(() => Number(value || 0).toFixed(2));
  return (
    <Stack direction="row" alignItems="center" spacing={1}>
      <TextField
        size="small"
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.]/g, "");
          if (!/^\d{0,3}(\.\d{0,2})?$/.test(t)) return;
          setText(t);
          onChange(Number(t) || 0);
        }}
        onBlur={() => setText(Number(text || 0).toFixed(2))}
        inputProps={{ inputMode: "decimal" }}
        InputProps={{ startAdornment: <Typography sx={{ typography: "s2", color: "text.subtitle", mr: 0.5 }}>$</Typography> }}
        sx={{ width: 96, "& .MuiInputBase-input": { typography: "s2", fontVariantNumeric: "tabular-nums" } }}
      />
      <Typography sx={{ typography: "s3", color: "text.subtitle" }}>{Number(value) > 0 ? "at most, per conversation" : "Set an amount"}</Typography>
    </Stack>
  );
}
DollarField.propTypes = { value: PropTypes.number, onChange: PropTypes.func };

function PercentField({ value, onChange }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1}>
      <NumberField value={value} prefix="+" suffix="%" width={96} onChange={onChange} />
      <Typography sx={{ typography: "s3", color: "text.subtitle" }}>{value <= 0 ? "No increase allowed" : "at most, against today's agent"}</Typography>
    </Stack>
  );
}
PercentField.propTypes = { value: PropTypes.number, onChange: PropTypes.func };
