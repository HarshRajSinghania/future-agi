import PropTypes from "prop-types";
import { useMemo, useState } from "react";
import { Box, Drawer, MenuItem, Select, Stack, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import VoiceDetailDrawerV2 from "src/components/VoiceDetailDrawerV2";
import FitDataTable from "../components/FitDataTable";
import { fmtCost, fmtDuration, fmtTokens } from "./agentCalls";
import { MONO, ago } from "./agentViewUtils";
import { clickable, focusRing } from "../components/clickable";

const RESULT = {
  passed: { label: "All passed", color: "#16A34A" },
  failed: { label: "Failed", color: "#DC2626" },
  flaky: { label: "Mixed", color: "#71717A" },
  unmeasured: { label: "Not measured", color: "#71717A" },
};

/* The overview shows the newest few; the rest are one click away. */
const FIRST = 8;

/**
 * This agent's real calls, newest first. The same columns as a simulated
 * call and the same drawer Observe uses, so a production call reads like a
 * test one. Simulated calls aren't repeated here — they live on each run.
 */
export default function ProductionCalls({ agent, rows: all, observe, viewing }) {
  const [version, setVersion] = useState("all");
  const [openIdx, setOpenIdx] = useState(null);
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(() => (version === "all" ? all : all.filter((r) => r.version === version)), [all, version]);
  const open = openIdx != null ? rows[openIdx] : null;
  const versions = useMemo(() => [...new Set(all.map((r) => r.version))].sort((a, b) => parseInt(b.slice(1), 10) - parseInt(a.slice(1), 10)), [all]);

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.25 }}>
        <Typography sx={{ typography: "s1", fontWeight: 700 }}>Production calls</Typography>
        <Typography noWrap sx={{ typography: "s3", color: "text.subtitle", flex: 1, minWidth: 0 }}>
          {`Last 7 days · ${all.length} sampled of ${observe.weekTotal.toLocaleString()} calls · Observe project `}
          <Box component="span" sx={{ fontFamily: MONO }}>{observe.project}</Box>
        </Typography>
        {all.length > 0 && (
          <Select
            size="small" value={version} onChange={(e) => { setVersion(e.target.value); setOpenIdx(null); }}
            sx={{ height: 32, typography: "s2", minWidth: 140, "& .MuiSelect-select": { typography: "s2" } }}
          >
            <MenuItem value="all" sx={{ typography: "s2" }}>All versions</MenuItem>
            {versions.map((v) => (
              <MenuItem key={v} value={v} sx={{ typography: "s2" }}>
                <Box component="span" sx={{ fontFamily: MONO, fontWeight: 600, mr: 1 }}>{v}</Box>
                {v === agent.latest ? "latest" : v === viewing ? "viewing" : ""}
              </MenuItem>
            ))}
          </Select>
        )}
      </Stack>

      {rows.length === 0 ? (
        <Box sx={{ py: 5, textAlign: "center", border: "1px solid", borderColor: "divider", borderRadius: 1.5 }}>
          <Typography sx={{ typography: "s2", color: "text.subtitle" }}>
            {version === "all" ? "No production calls in the last 7 days." : `No production calls on ${version} in the last 7 days.`}
          </Typography>
        </Box>
      ) : (
        <Box>
          <FitDataTable
            columns={CALL_COLUMNS}
            data={showAll ? rows : rows.slice(0, FIRST)}
            getRowId={(r) => r.id}
            rowHeight={56}
            onRowClick={(r) => setOpenIdx(rows.findIndex((x) => x.id === r.id))}
          />
          {rows.length > FIRST && (
            <Typography
              {...clickable(() => setShowAll((v) => !v), { expanded: showAll })}
              sx={{ typography: "s3", fontWeight: 700, color: "text.secondary", cursor: "pointer", mt: 1, width: "fit-content", "&:hover": { color: "text.primary" }, ...focusRing }}
            >
              {showAll ? "Show fewer" : `Show all ${rows.length} calls`}
            </Typography>
          )}
        </Box>
      )}

      <Drawer
        anchor="right" open={!!open} onClose={() => setOpenIdx(null)}
        ModalProps={{ BackdropProps: { style: { backgroundColor: "transparent" } } }}
        sx={{
          zIndex: (t) => t.zIndex.modal,
          "&& .MuiDrawer-paper": { width: "auto", maxWidth: "100vw", bgcolor: "background.paper", backgroundImage: "none", overflow: "hidden", boxShadow: "-10px 0px 100px #00000035" },
        }}
      >
        {open && (
          <VoiceDetailDrawerV2
            key={open.id}
            data={open.open()}
            hideEvalRowFix
            hideAnnotationTab
            onClose={() => setOpenIdx(null)}
            onPrev={openIdx > 0 ? () => setOpenIdx(openIdx - 1) : undefined}
            onNext={openIdx < rows.length - 1 ? () => setOpenIdx(openIdx + 1) : undefined}
            hasPrev={openIdx > 0}
            hasNext={openIdx < rows.length - 1}
          />
        )}
      </Drawer>
    </Box>
  );
}

ProductionCalls.propTypes = {
  agent: PropTypes.object.isRequired, rows: PropTypes.array.isRequired, observe: PropTypes.object.isRequired, viewing: PropTypes.string,
};

/* The product's DataTable columns — the same columns a simulated call shows. */
const CALL_COLUMNS = [
  {
    id: "title", header: "Call", meta: { flex: 2.6 }, minSize: 220,
    cell: ({ row: { original: r } }) => (
      <Box minWidth={0}>
        <Typography noWrap sx={{ typography: "s2", fontWeight: 600 }}>{r.title}</Typography>
        <Typography noWrap sx={{ typography: "s3", color: "text.subtitle" }}>
          {`${r.who} · ${ago(r.at)}${r.endedReason ? ` · ${r.endedReason}` : ""}`}
        </Typography>
      </Box>
    ),
  },
  { id: "version", header: "Version", size: 84, cell: ({ row: { original: r } }) => <Typography sx={{ typography: "s2", fontFamily: MONO, fontWeight: 600 }}>{r.version}</Typography> },
  { id: "result", header: "Evals", size: 140, cell: ({ row: { original: r } }) => <ResultChip row={r} /> },
  { id: "duration", header: "Duration", size: 92, cell: ({ row: { original: r } }) => <Num>{fmtDuration(r.durationS)}</Num> },
  { id: "turns", header: "Turns", size: 72, cell: ({ row: { original: r } }) => <Num>{r.turns}</Num> },
  { id: "latency", header: "Avg latency", size: 108, cell: ({ row: { original: r } }) => <Num>{`${r.latencyMs} ms`}</Num> },
  { id: "tokens", header: "Tokens", size: 84, cell: ({ row: { original: r } }) => <Num>{fmtTokens(r.tokens)}</Num> },
  { id: "cost", header: "Cost", size: 80, cell: ({ row: { original: r } }) => <Num>{fmtCost(r.cost)}</Num> },
];

function ResultChip({ row }) {
  const res = RESULT[row.result] || RESULT.unmeasured;
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.625, px: 0.75, height: 22, width: "fit-content", borderRadius: 0.75, bgcolor: (t) => alpha(res.color, t.palette.mode === "dark" ? 0.16 : 0.1) }}>
      <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: res.color }} />
      <Typography sx={{ typography: "s3", fontWeight: 600, color: res.color }}>
        {row.result === "failed" && row.failedEvals ? `${row.failedEvals} eval${row.failedEvals === 1 ? "" : "s"} failed` : res.label}
      </Typography>
    </Box>
  );
}
ResultChip.propTypes = { row: PropTypes.object };

function Num({ children }) {
  return <Typography noWrap sx={{ typography: "s2", fontVariantNumeric: "tabular-nums", color: "text.secondary" }}>{children}</Typography>;
}
Num.propTypes = { children: PropTypes.node };
