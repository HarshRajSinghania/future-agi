import PropTypes from "prop-types";
import { useState } from "react";
import { Box, Button, Dialog, IconButton, Stack, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { ladderOf, protectedLabel } from "../../_mock/optimizationRuns";
import { receiptOf } from "./receipt";
import { CONFIG_AREAS } from "../../_mock/rsiModel";

const MONO = "ui-monospace, Menlo, monospace";
const heading = { typography: "s3", fontWeight: 700, color: "text.subtitle", textTransform: "uppercase", letterSpacing: 0.5, mb: 0.75 };
const ICON = { pass: "solar:check-circle-linear", fail: "solar:close-circle-bold", skip: "solar:minus-circle-linear", todo: "solar:circle-linear", thin: "solar:info-circle-linear" };

/**
 * A list of checks that reads as one line when everything held — "All 11
 * held" — and opens to the rows. It opens on its own when one failed, with
 * the failure in the summary, so nothing that matters is folded away.
 */
export function CheckGroup({ title, summary, failed = false, children }) {
  /* Folded even when something failed — the summary line already says what. */
  const [open, setOpen] = useState(false);
  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
      <Stack
        direction="row" alignItems="center" spacing={1.25} role="button" tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "Enter") setOpen((o) => !o); }}
        sx={{ px: 1.5, py: 1, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
      >
        <Iconify icon={failed ? "solar:close-circle-bold" : "solar:check-circle-linear"} width={15} sx={{ color: failed ? "#DC2626" : "text.secondary", flexShrink: 0 }} />
        <Typography sx={{ typography: "s2", fontWeight: 600, flexShrink: 0 }}>{title}</Typography>
        <Typography noWrap sx={{ typography: "s2", color: failed ? "#DC2626" : "text.subtitle", flex: 1, minWidth: 0 }}>{summary}</Typography>
        <Iconify icon={open ? "solar:alt-arrow-up-linear" : "solar:alt-arrow-down-linear"} width={14} sx={{ color: "text.subtitle", flexShrink: 0 }} />
      </Stack>
      {open && <Box sx={{ borderTop: "1px solid", borderColor: "divider" }}>{children}</Box>}
    </Box>
  );
}
CheckGroup.propTypes = { title: PropTypes.string, summary: PropTypes.string, failed: PropTypes.bool, children: PropTypes.node };

/**
 * How the shipped candidate was proven, cheapest tier first — where a
 * candidate would have stopped had it failed one. One line when every tier
 * passed; `footer` (the must-pass note) sits under the rows.
 */
export function VerificationLadder({ record, trial, footer = null }) {
  const tiers = ladderOf(record, trial);
  if (!tiers.length) return null;
  const failedAt = tiers.find((t) => t.state === "fail");
  const passed = tiers.filter((t) => t.state === "pass").length;
  return (
    <CheckGroup
      title="Verification"
      failed={!!failedAt}
      summary={failedAt ? `Stopped at ${failedAt.label}` : `${passed} of ${tiers.length} checks passed`}
    >
      {tiers.map((t, i) => (
        <Stack key={t.id} direction="row" alignItems="center" spacing={1.25} sx={{ px: 1.5, py: 0.875, borderTop: i ? "1px solid" : "none", borderColor: "divider" }}>
          <Iconify icon={ICON[t.state]} width={15} sx={{ color: t.state === "fail" ? "#DC2626" : t.state === "pass" ? "text.secondary" : "text.disabled", flexShrink: 0 }} />
          <Typography sx={{ typography: "s2", width: 200, flexShrink: 0, color: t.state === "todo" || t.state === "skip" ? "text.subtitle" : "text.primary" }}>{`${i + 1}. ${t.label}`}</Typography>
          <Typography sx={{ typography: "s2", color: t.state === "fail" ? "#DC2626" : "text.subtitle", flex: 1, minWidth: 0 }}>{t.note || (t.state === "todo" ? "not reached" : "")}</Typography>
        </Stack>
      ))}
      {footer && <Box sx={{ px: 1.5, py: 1, borderTop: "1px solid", borderColor: "divider" }}>{footer}</Box>}
    </CheckGroup>
  );
}
VerificationLadder.propTypes = { record: PropTypes.object, trial: PropTypes.object, footer: PropTypes.node };

/**
 * What was frozen when the improvement started — the inputs every verdict
 * is computed against. For a fix, the issue snapshot: it doesn't change
 * after Fix is pressed, whatever the Error Feed learns later.
 */
export function FrozenInputs({ record, model, identity = null, envSnapshot = null }) {
  const [open, setOpen] = useState(false);
  const f = record.frozen;
  const snap = record.snapshot;
  if (!f && !snap) return null;
  const rows = [
    ...(snap ? [
      ["Issue", `${snap.issueId} · ${snap.title}${snap.severity ? ` · ${snap.severity}` : ""}`],
      ["Evidence traces", (snap.traceIds || []).join(", ") || "—"],
      ["Root cause", snap.rootCause || "—"],
      ["Fix layer", snap.fixLayer || "—"],
      ["Must start passing", `${snap.mustStartPassing.length} scenarios from the issue's traces`],
      ["Must keep passing", `${snap.mustKeepPassing} scenarios that pass today`],
    ] : []),
    ...(f ? [
      ["Scenario set", `${f.scenarios} scenarios · ${f.held} held back, never shown while searching`],
      ["Evaluations", (f.evaluations || []).join(", ") || "—"],
      ["Must-pass", f.mustPassParts
        ? `${f.mustPass} scenarios · ${[f.mustPassParts.marked ? `${f.mustPassParts.marked} marked` : null, f.mustPassParts.remembered ? `${f.mustPassParts.remembered} regression memory` : null, `${f.mustPassParts.passing} passing every repeat today`].filter(Boolean).join(", ")}${f.anchors ? ` · ${f.anchors} anchor core` : ""}`
        : `${f.mustPass} critical scenarios${f.anchors ? ` · ${f.anchors} anchor core` : ""}`],
      ...(f.compat ? [["Sealed environment", `${envSnapshot ? `environment ${envSnapshot}` : f.compat.envVersion || "this version"} · entry point ${f.compat.entry} — a code change that moves it, changes the build or the start command doesn't fit`]] : []),
      ...(f.repoTests ? [["Repository tests", `${f.repoTests} — every code change must still pass`]] : []),
      ...(record.targetMember ? [["Target member", record.targetMember]] : []),
      ...((f.protectedMembers || []).length ? [["Protected members", `${f.protectedMembers.join(", ")} — never changed`]] : []),
      ...(f.repeats ? [["Repeats", `each scenario ${f.repeats}× — from the environment's run defaults${f.voiceCap ? ` · voice: ${f.voiceCap.scenarios} of ${f.voiceCap.of} scenarios, up to ${f.voiceCap.trials} runs` : ""}`]] : []),
      ...(record.calibration ? [["Baseline twice", `${record.calibration.disagreed} of ${record.calibration.scenarios} scenarios disagreed with themselves · noise ±${f.calibrationNoise ?? record.result?.noise ?? "—"} pts`]] : []),
      ...(f.areas ? [["Configuration areas", (() => {
        const off = Object.entries(f.areas).filter(([, on]) => !on).map(([id]) => CONFIG_AREAS.find((a) => a.id === id)?.label || id);
        return off.length ? `switched off: ${off.join(", ")} — a change there stops at Static checks` : "every area on";
      })()]] : []),
      ...((f.approvedSpeech || []).length ? [["Approved speech", f.approvedSpeech.join(", ")]] : []),
      ["Model lock", f.model?.mode === "approved" ? `approved list: ${[model, ...(f.model.approved || [])].filter(Boolean).join(", ")}` : `locked${model ? ` to ${model}` : ""}`],
      ["Cost ceiling", f.cost],
      ...(envSnapshot || f.suiteVersion ? [["Held fixed", `${identity || (envSnapshot ? `environment ${envSnapshot}` : "the environment version")} — the world, scenarios, sub-goals, evaluations and simulated caller; only the agent changes`]] : []),
      ...(f.rules ? [["Rules", `${f.rules} rules frozen — a run can't change one; that's a spec change, decided outside the loop`]] : []),
      ...((f.protected || []).length ? [["Never edited", f.protected.map(protectedLabel).join(", ")]] : []),
    ] : []),
  ];
  return (
    <Box sx={{ px: 2.5, pb: 1 }}>
      <Button
        size="small" onClick={() => setOpen((o) => !o)}
        endIcon={<Iconify icon={open ? "eva:arrow-ios-upward-fill" : "eva:arrow-ios-downward-fill"} width={13} />}
        sx={{ typography: "s3", fontWeight: 700, color: "text.secondary", px: 0.5 }}
      >
        {snap ? "Issue snapshot and frozen inputs" : "Frozen inputs"}
      </Button>
      {open && (
        <Box sx={{ mt: 0.5, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
          <Typography sx={{ px: 1.5, py: 0.875, typography: "s3", color: "text.subtitle", borderBottom: "1px solid", borderColor: "divider" }}>
            {`Frozen ${new Date(record.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} — every verdict below is computed against these, and they don't change afterwards.`}
          </Typography>
          {rows.map(([k, v], i) => (
            <Stack key={k} direction="row" spacing={2} sx={{ px: 1.5, py: 0.75, borderTop: i ? "1px solid" : "none", borderColor: "divider" }}>
              <Typography sx={{ typography: "s2", color: "text.subtitle", width: 170, flexShrink: 0 }}>{k}</Typography>
              <Typography sx={{ typography: "s2", flex: 1, minWidth: 0, fontFamily: k === "Evidence traces" ? MONO : undefined }}>{v}</Typography>
            </Stack>
          ))}
        </Box>
      )}
    </Box>
  );
}
FrozenInputs.propTypes = { record: PropTypes.object, model: PropTypes.string, identity: PropTypes.string, envSnapshot: PropTypes.string };

/** The receipt, one click from the header. */
export function ReceiptButton({ record, outcome, attempts, identity = null, envSnapshot = null }) {
  const [open, setOpen] = useState(false);
  const entries = receiptOf(record, outcome, { attempts: attempts || [], identity, envSnapshot });
  if (!entries.length) return null;
  return (
    <>
      <Button
        size="small" variant="outlined" onClick={() => setOpen(true)}
        startIcon={<Iconify icon="solar:document-text-linear" width={14} />}
        sx={{ typography: "s3", fontWeight: 700, color: "text.primary", borderColor: "divider", height: 26, flexShrink: 0 }}
      >
        Receipt
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: 1.5, backgroundImage: "none" } }}>
        <Stack direction="row" alignItems="flex-start" sx={{ px: 2.5, py: 2, borderBottom: "1px solid", borderColor: "divider" }}>
          <Box flex={1}>
            <Typography sx={{ typography: "s1", fontWeight: 700 }}>{`Receipt · ${record.id}`}</Typography>
            <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
              Every check, in order. Each entry is hashed with the one before it, so none can be changed or dropped afterwards — and the model writing changes never writes to it.
            </Typography>
          </Box>
          <IconButton size="small" onClick={() => setOpen(false)}><Iconify icon="eva:close-fill" width={17} /></IconButton>
        </Stack>
        <Box sx={{ px: 2.5, py: 1.5 }}>
          {entries.map((e, i) => (
            <Stack key={e.n} direction="row" spacing={1.5} sx={{ py: 0.875, borderTop: i ? "1px solid" : "none", borderColor: "divider" }}>
              <Typography sx={{ typography: "s3", color: "text.disabled", width: 18, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{e.n}</Typography>
              <Box flex={1} minWidth={0}>
                <Typography sx={{ typography: "s2", fontWeight: 600 }}>{e.step}</Typography>
                <Typography sx={{ typography: "s3", color: "text.subtitle" }}>{e.detail}</Typography>
              </Box>
              <Typography sx={{ typography: "s3", color: "text.disabled", fontFamily: MONO, flexShrink: 0 }}>{e.hash.slice(0, 12)}</Typography>
            </Stack>
          ))}
        </Box>
      </Dialog>
    </>
  );
}
ReceiptButton.propTypes = { record: PropTypes.object, outcome: PropTypes.object, attempts: PropTypes.array, identity: PropTypes.string, envSnapshot: PropTypes.string };
