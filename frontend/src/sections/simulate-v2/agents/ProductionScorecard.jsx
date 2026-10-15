import PropTypes from "prop-types";
import { useMemo, useState } from "react";
import { Box, Button, Menu, MenuItem, Stack, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import Iconify from "src/components/iconify";
import { evalRates } from "./agentCalls";
import { MONO } from "./agentViewUtils";
import FitDataTable from "../components/FitDataTable";

const SIM = "#7857FC";
const PROD = "#0EA5E9";
/* A gap is only called out when it's bigger than the noise of the two
   samples behind it (≈95% interval of the difference) — and never under
   GAP points, however big the samples. With 14 production calls, ±25 points
   is noise; with 400 it's ±5. */
const GAP = 5;
const noiseOf = (s, p) => {
  if (!s?.n || !p?.n || s.rate == null || p.rate == null) return null;
  const a = s.rate / 100;
  const b = p.rate / 100;
  return Math.round(1.96 * Math.sqrt((a * (1 - a)) / s.n + (b * (1 - b)) / p.n) * 100);
};
const isRealGap = (s, p) => {
  const noise = noiseOf(s, p);
  return noise != null && Math.abs(p.rate - s.rate) >= Math.max(GAP, noise);
};

/**
 * Simulation vs production, eval by eval, for one version. The old screens
 * kept test and live analytics on separate tabs; side by side they answer the
 * question that matters — do the tests predict reality? A big gap means real
 * callers do things the scenarios don't, and the fix is to test those calls.
 */
export default function ProductionScorecard({ agent, viewing, simulation, production, weekTotal, addTargets = [], onAddFromProduction }) {
  /* Production calls become scenarios in an environment testing this agent —
     named, so it's clear where they land. Several? Pick one. */
  const [pickAnchor, setPickAnchor] = useState(null);
  const sim = useMemo(() => simulation.filter((r) => r.version === viewing && r.result !== "unmeasured"), [simulation, viewing]);
  const prod = useMemo(() => production.filter((r) => r.version === viewing), [production, viewing]);
  const simRates = useMemo(() => evalRates(sim), [sim]);
  const prodRates = useMemo(() => evalRates(prod), [prod]);
  const ids = [...new Set([...Object.keys(simRates), ...Object.keys(prodRates)])];
  /* The run screen's pass rate: a simulated scenario counts for the share of
     its repeats that passed; a production call passes when every eval does. */
  const passOf = (rows) => {
    const shares = rows.map((r) => (typeof r.passShare === "number" ? r.passShare : r.result === "passed" ? 1 : 0));
    return shares.length ? Math.round((shares.reduce((a, b) => a + b, 0) / shares.length) * 100) : null;
  };
  const overall = { sim: { rate: passOf(sim), n: sim.length }, prod: { rate: passOf(prod), n: prod.length } };

  const worse = ids
    .map((id) => ({ id, name: (simRates[id] || prodRates[id]).name, sr: simRates[id], pr: prodRates[id] }))
    .filter((x) => isRealGap(x.sr, x.pr) && x.pr.rate < x.sr.rate)
    .map((x) => ({ ...x, s: x.sr.rate, p: x.pr.rate }))
    .sort((a, b) => (b.s - b.p) - (a.s - a.p));

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="baseline" spacing={1}>
        <Typography sx={{ typography: "s1", fontWeight: 700 }}>
          {"How "}
          <Box component="span" sx={{ fontFamily: MONO }}>{viewing}</Box>
          {viewing === agent.latest ? " (latest)" : ""}
          {" scores"}
        </Typography>
        <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
          {`${sim.length} simulated call${sim.length === 1 ? "" : "s"} · ${prod.length} production call${prod.length === 1 ? "" : "s"} sampled${weekTotal ? ` from this week's ${weekTotal.toLocaleString()}` : ""} · change version at the top`}
        </Typography>
      </Stack>

      {/* The gap, said in words — the reason to look at this tab. */}
      {worse.length > 0 && (
        <Stack direction="row" spacing={1.25} alignItems="flex-start" sx={{ p: 1.5, borderRadius: 1.5, border: "1px solid", borderColor: alpha("#CA8A04", 0.4), bgcolor: (t) => alpha("#CA8A04", t.palette.mode === "dark" ? 0.08 : 0.05) }}>
          <Iconify icon="solar:danger-triangle-linear" width={17} sx={{ color: "#CA8A04", mt: 0.25, flexShrink: 0 }} />
          <Box flex={1} minWidth={0}>
            <Typography sx={{ typography: "s2", fontWeight: 700 }}>
              {`Production does worse than simulation on ${worse.map((w) => w.name).join(", ")}`}
            </Typography>
            <Typography sx={{ typography: "s3", color: "text.secondary", mt: 0.25 }}>
              {`${worse[0].name}: ${worse[0].p}% in production vs ${worse[0].s}% in simulation. Real callers are doing something your scenarios don't — turn those calls into scenarios so the next run tests it.`}
            </Typography>
          </Box>
          {onAddFromProduction && addTargets.length > 0 && (
            <>
              <Button
                size="small" variant="outlined"
                onClick={(e) => (addTargets.length === 1 ? onAddFromProduction(addTargets[0].envId) : setPickAnchor(e.currentTarget))}
                endIcon={addTargets.length > 1 ? <Iconify icon="eva:chevron-down-fill" width={14} /> : null}
                sx={{ typography: "s3", fontWeight: 700, color: "text.primary", borderColor: "divider", whiteSpace: "nowrap", flexShrink: 0 }}
              >
                {addTargets.length === 1 ? `Add to ${addTargets[0].envName}` : "Add to an environment"}
              </Button>
              <Menu
                anchorEl={pickAnchor} open={!!pickAnchor} onClose={() => setPickAnchor(null)}
                anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                transformOrigin={{ vertical: "top", horizontal: "right" }}
                slotProps={{ paper: { sx: { minWidth: 180, mt: 0.5 } } }}
              >
                {addTargets.map((t) => (
                  <MenuItem key={t.envId} onClick={() => { setPickAnchor(null); onAddFromProduction(t.envId); }} sx={{ typography: "s2" }}>
                    {t.envName}
                  </MenuItem>
                ))}
              </Menu>
            </>
          )}
        </Stack>
      )}

      {ids.length === 0 ? (
        <Typography sx={{ py: 2, typography: "s2", color: "text.subtitle" }}>
          {`${viewing} hasn't been simulated yet — switch an environment to it and run, and its scores show up here.`}
        </Typography>
      ) : (
        <FitDataTable
          columns={scoreColumns}
          getRowId={(r) => r.id}
          data={[
            { id: "__pass", name: "Pass rate", strong: true, s: overall.sim, p: overall.prod, simEmpty: sim.length ? null : "Not simulated", prodEmpty: prod.length ? null : "No calls yet" },
            ...ids.map((id) => ({
              id, name: (simRates[id] || prodRates[id]).name, s: simRates[id], p: prodRates[id], showN: true,
              simEmpty: sim.length ? "Not graded" : "Not simulated", prodEmpty: prod.length ? "Not graded" : "No calls yet",
            })),
          ]}
        />
      )}

      <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
        {"Production is a sample — a gap counts only when it's bigger than its noise. Hover a gap for the margin."}
      </Typography>
    </Stack>
  );
}

ProductionScorecard.propTypes = {
  agent: PropTypes.object.isRequired, viewing: PropTypes.string, simulation: PropTypes.array.isRequired, production: PropTypes.array.isRequired,
  weekTotal: PropTypes.number,
  addTargets: PropTypes.array,
  onAddFromProduction: PropTypes.func,
};

/* The product's DataTable columns: eval, each side's rate, the gap. */
const scoreColumns = [
  {
    id: "name", header: "Eval", meta: { flex: 1.4 }, minSize: 160,
    cell: ({ row: { original: r } }) => (
      <Typography
        noWrap
        title={r.strong ? "Same pass rate as the run screen. A production call passes when every eval does; a simulated scenario counts for the share of its repeats that passed." : undefined}
        sx={{ typography: "s2", fontWeight: r.strong ? 700 : 400 }}
      >
        {r.name}
      </Typography>
    ),
  },
  { id: "sim", header: "Simulation", meta: { flex: 1.2 }, cell: ({ row: { original: r } }) => <Rate value={r.s?.rate} n={r.showN ? r.s?.n : null} color={SIM} empty={r.simEmpty} /> },
  { id: "prod", header: "Production", meta: { flex: 1.2 }, cell: ({ row: { original: r } }) => <Rate value={r.p?.rate} n={r.showN ? r.p?.n : null} color={PROD} empty={r.prodEmpty} /> },
  { id: "gap", header: "Gap", size: 96, cell: ({ row: { original: r } }) => <Gap s={r.s} p={r.p} /> },
];

function Rate({ value, n, color, empty }) {
  if (value == null) return <Typography sx={{ typography: "s3", color: "text.disabled" }}>{empty || "—"}</Typography>;
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ width: "100%", pr: 2 }}>
      <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: (t) => alpha(t.palette.text.primary, 0.08), overflow: "hidden" }}>
        <Box sx={{ width: `${value}%`, height: "100%", bgcolor: color, borderRadius: 3 }} />
      </Box>
      <Typography sx={{ typography: "s2", fontWeight: 700, fontVariantNumeric: "tabular-nums", width: 40, textAlign: "right" }}>{`${value}%`}</Typography>
      {n != null && <Typography sx={{ typography: "s3", color: "text.subtitle", width: 36, fontVariantNumeric: "tabular-nums" }}>{`of ${n}`}</Typography>}
    </Stack>
  );
}
Rate.propTypes = { value: PropTypes.number, n: PropTypes.number, color: PropTypes.string, empty: PropTypes.string };

/* Production minus simulation, in points — coloured only when the gap is
   bigger than the samples' noise; otherwise it reads as within noise. */
function Gap({ s, p }) {
  if (s?.rate == null || p?.rate == null) return <Typography sx={{ typography: "s3", color: "text.disabled" }}>—</Typography>;
  const d = p.rate - s.rate;
  const noise = noiseOf(s, p);
  const real = isRealGap(s, p);
  const color = !real ? "text.subtitle" : d < 0 ? "#DC2626" : "#16A34A";
  const title = noise == null ? "" : real
    ? `Beyond the ±${noise} pt noise of ${s.n} simulated and ${p.n} production calls.`
    : `Within noise — with ${s.n} simulated and ${p.n} production calls, anything under ±${Math.max(GAP, noise)} pts can be chance.`;
  return (
    <Typography title={title} sx={{ typography: "s2", fontWeight: real ? 700 : 500, color, fontVariantNumeric: "tabular-nums", cursor: title ? "help" : "default" }}>
      {`${d > 0 ? "+" : ""}${d} pts`}
    </Typography>
  );
}
Gap.propTypes = { s: PropTypes.object, p: PropTypes.object };
