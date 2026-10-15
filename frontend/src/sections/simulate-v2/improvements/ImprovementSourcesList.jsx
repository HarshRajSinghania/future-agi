import PropTypes from "prop-types";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  InputAdornment, Stack, TextField, Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { neutralCheckboxSx } from "../components/primitives";
import Iconify from "src/components/iconify";
import { paths } from "src/routes/paths";
import { DataTable } from "src/components/data-table";
import FilterPanel from "src/components/filter-panel/FilterPanel";
import { useSimStore, useConnectedAgents } from "../store";
import { useIntegrations } from "../_mock/integrations";
import { improvementRowsOf } from "./improvementRows";
import { DATASET_SOURCES, MODALITY, formatCreatedAt, modalityOfSurface, relativeTime } from "./improvementSources";
import StatusPill from "./ImprovementStatusPill";

const compactInputSx = {
  "& .MuiInputBase-root": { typography: "s2", height: 34 },
  "& .MuiOutlinedInput-input": { py: 0 },
};
const ROW_HEIGHT = 52;
const HEADER_HEIGHT = 40;

/**
 * Improvements, level 1 — every improvement: one trigger (an Error Feed
 * issue, a schedule, a goal, a manual start) and the search it ran. Run name
 * · Agent type · Status · Runs · Created · Latest run. A row opens level 2,
 * that improvement's runs — chart, compare, choose winner; a run there opens
 * its run page (level 3).
 *
 * With `agent` it's the agent page's Improvements tab: only that agent's.
 */
export default function ImprovementSourcesList({ agent }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { state, dispatch } = useSimStore();
  const { agents } = useConnectedAgents();
  const { prs } = useIntegrations();
  const [query, setQuery] = useState("");
  const [filterAnchorEl, setFilterAnchorEl] = useState(null);
  const [filters, setFilters] = useState({});
  const [selectedIds, setSelectedIds] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /* Sample dataset rows have nothing behind them — deleting hides them here. */
  const [hiddenDatasets, setHiddenDatasets] = useState(() => new Set());

  /* A running improvement ticks its phase — read the clock while one runs. */
  const [now, setNow] = useState(() => Date.now());
  const improvements = useMemo(() => improvementRowsOf({ state, agents, prs, now }), [state, agents, prs, now]);
  const anyRunning = improvements.some((r) => r.status?.key === "running");
  useEffect(() => {
    if (!anyRunning) return undefined;
    const t = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(t);
  }, [anyRunning]);

  const rows = useMemo(() => {
    const mine = agent ? improvements.filter((r) => r.agentKey === agent.key) : improvements;
    const envRows = mine.map((r) => {
      const env = (state.myEnvironments || []).find((e) => e.id === r.envId);
      const record = (state.byEnv?.[r.envId]?.optimizations || []).find((o) => o.id === r.recordId);
      const a = agents.find((x) => x.key === r.agentKey);
      return {
        ...r,
        kind: "env",
        modality: modalityOfSurface(env?.surface),
        /* A running search hasn't settled on its runs yet — "—" until it has. */
        runCount: r.status?.key === "running" ? 0 : record?.result?.trials?.length || 0,
        latestAt: record?.completedAt || r.createdAt,
        latestIsRunning: r.status?.key === "running",
        /* The platform's id when it has one — tells same-named environments apart. */
        agentId: a?.values?.agentId || r.agentKey || null,
      };
    });
    /* Datasets aren't tied to one agent, so they're listed on the page, not an agent's tab. */
    const datasetRows = agent ? [] : DATASET_SOURCES.filter((d) => !hiddenDatasets.has(d.id)).map((d) => ({
      id: d.id,
      kind: "dataset",
      datasetId: d.datasetId,
      /* No dataset improvement flow exists yet — the row says so instead of
         showing results nobody produced; its page says Coming soon too. */
      name: `Improve on ${d.name}`,
      envName: "Dataset",
      sub: `${d.rowCount.toLocaleString()} rows run as scenarios`,
      modality: MODALITY[d.modalityKey] || MODALITY.chat,
      status: { key: "soon", label: "Coming soon" },
      headline: "Improving an agent against a dataset isn't available yet.",
      runCount: 0,
      createdAt: d.latestAt,
      latestAt: d.latestAt,
    }));
    const all = [...envRows, ...datasetRows];
    /* Two environments with one name: say which agent each is. */
    const counts = new Map();
    all.filter((r) => r.kind === "env").forEach((r) => counts.set(r.envId, r.envName));
    const names = new Map();
    [...counts.values()].forEach((n) => names.set(n, (names.get(n) || 0) + 1));
    return all
      .map((r) => ({ ...r, duplicate: r.kind === "env" && names.get(r.envName) > 1 }))
      .sort((a, b) => (Date.parse(b.createdAt || 0) || 0) - (Date.parse(a.createdAt || 0) || 0));
  }, [improvements, agent, agents, state.myEnvironments, state.byEnv, hiddenDatasets]);

  const filterFields = useMemo(() => {
    const choicesOf = (pick) => [...new Set(rows.map(pick).filter(Boolean))].sort();
    return [
      { value: "agentType", label: "Agent type", type: "enum", choices: choicesOf((r) => r.modality?.label) },
      { value: "status", label: "Status", type: "enum", choices: choicesOf((r) => r.status?.label) },
      { value: "trigger", label: "Trigger", type: "enum", choices: choicesOf((r) => r.trigger?.source) },
    ];
  }, [rows]);
  const activeFilterCount = Object.values(filters).filter((v) => v?.length).length;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !`${r.name} ${r.envName} ${r.agentName || ""} ${r.trigger?.label || ""} ${r.recordId || ""}`.toLowerCase().includes(q)) return false;
      if (filters.agentType?.length && !filters.agentType.includes(r.modality?.label)) return false;
      if (filters.status?.length && !filters.status.includes(r.status?.label)) return false;
      if (filters.trigger?.length && !filters.trigger.includes(r.trigger?.source)) return false;
      return true;
    });
  }, [rows, query, filters]);

  /* Level 2 comes back here — this page, or the agent's Improvements tab. */
  const back = { to: `${location.pathname}${location.search}`, label: agent ? agent.name : "Improvements" };
  const openRow = (r) => navigate(r.kind === "dataset"
    ? paths.dashboard.simulate.improvementDataset(r.datasetId)
    : r.href, { state: { back } });

  const toggleRow = (id) => setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const selectedRows = rows.filter((r) => selectedIds.includes(r.id));
  const performDelete = () => {
    const byEnv = {};
    selectedRows.filter((r) => r.kind === "env").forEach((r) => { byEnv[r.envId] = [...(byEnv[r.envId] || []), r.recordId]; });
    Object.entries(byEnv).forEach(([envId, ids]) => {
      const opts = state.byEnv?.[envId]?.optimizations || [];
      dispatch({ type: "patchEnvState", envId, patch: { optimizations: opts.filter((o) => !ids.includes(o.id)) } });
    });
    const datasets = selectedRows.filter((r) => r.kind === "dataset").map((r) => r.id);
    if (datasets.length) setHiddenDatasets((h) => new Set([...h, ...datasets]));
    setSelectedIds([]);
    setConfirmDelete(false);
  };

  const columns = [
    {
      id: "select",
      header: () => null,
      size: 44,
      enableSorting: false,
      cell: ({ row }) => (
        <Checkbox
          size="small"
          checked={selectedIds.includes(row.original.id)}
          onChange={(e) => { e.stopPropagation(); toggleRow(row.original.id); }}
          onClick={(e) => e.stopPropagation()}
          sx={{ p: 0, ...neutralCheckboxSx }}
        />
      ),
    },
    {
      id: "name", header: "Name", meta: { flex: 1.6 }, minSize: 260, enableSorting: false,
      cell: ({ row: { original: r } }) => (
        <Box minWidth={0}>
          <Typography noWrap sx={{ typography: "s2", fontWeight: 600 }}>{r.name}</Typography>
          {/* Where it ran and what started it — the Source column's job, folded in. */}
          <Typography noWrap sx={{ typography: "s3", color: "text.subtitle" }}>
            {r.kind === "dataset" ? `${r.envName} · ${r.sub}` : (
              <>
                {r.envName}
                {r.duplicate && r.agentId && <Box component="span" sx={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{` · ${r.agentId}`}</Box>}
                {r.trigger && ` · ${r.trigger.source} · ${r.trigger.label}`}
              </>
            )}
          </Typography>
        </Box>
      ),
    },
    {
      id: "agentType", header: "Agent type", size: 150, enableSorting: false,
      cell: ({ row: { original: r } }) => (
        <Stack direction="row" alignItems="center" spacing={0.875} sx={{ minWidth: 0 }}>
          <Box sx={{ width: 22, height: 22, borderRadius: 0.75, flexShrink: 0, display: "grid", placeItems: "center", bgcolor: "background.neutral", color: "text.secondary" }}>
            <Iconify icon={r.modality.icon} width={13} />
          </Box>
          <Typography noWrap sx={{ typography: "s2" }}>{r.modality.label}</Typography>
        </Stack>
      ),
    },
    {
      id: "status", header: "Status", size: 190, enableSorting: false,
      cell: ({ row: { original: r } }) => <StatusPill ending={r.status} headline={r.headline} />,
    },
    {
      id: "runs", header: "Runs", size: 90, enableSorting: false,
      cell: ({ row: { original: r } }) => (r.runCount ? (
        <Box sx={{ display: "inline-flex", alignItems: "center", px: 0.75, py: 0.25, borderRadius: 0.75, border: "1px solid", borderColor: "divider" }}>
          <Typography sx={{ typography: "s3", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "text.secondary" }}>{r.runCount}</Typography>
        </Box>
      ) : <Typography sx={{ typography: "s3", color: "text.disabled" }}>—</Typography>),
    },
    {
      id: "createdAt", header: "Created", size: 170, enableSorting: false,
      cell: ({ row: { original: r } }) => <Typography noWrap sx={{ typography: "s3", color: "text.subtitle" }}>{formatCreatedAt(r.createdAt)}</Typography>,
    },
    {
      id: "latestAt", header: "Latest run", size: 140, enableSorting: false,
      cell: ({ row: { original: r } }) => (r.latestIsRunning
        ? <Typography sx={{ typography: "s3", color: "text.secondary", fontWeight: 600 }}>in progress</Typography>
        : <Typography noWrap sx={{ typography: "s3", color: "text.subtitle" }}>{relativeTime(r.latestAt)}</Typography>),
    },
  ];

  const embedded = !!agent;
  return (
    <Box sx={embedded ? { display: "flex", flexDirection: "column", gap: 2 } : { height: "100%", display: "flex", flexDirection: "column", gap: 2, overflow: "hidden", minHeight: 0, p: 2 }}>
      {!embedded && (
        <Box sx={{ flexShrink: 0 }}>
          <Typography sx={{ typography: "m2", fontWeight: 600 }}>Improvements</Typography>
          <Typography sx={{ typography: "s1", color: "text.secondary" }}>
            Every improvement across your environments and datasets.
          </Typography>
        </Box>
      )}

      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ flexShrink: 0 }}>
        <TextField
          size="small" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, environment or issue"
          InputProps={{ startAdornment: <InputAdornment position="start"><Iconify icon="solar:magnifer-linear" width={15} sx={{ color: "text.subtitle" }} /></InputAdornment> }}
          sx={{ width: 300, ...compactInputSx }}
        />
        <Button
          size="small" variant="outlined"
          startIcon={<Iconify icon="mage:filter" width={16} />}
          endIcon={<Iconify icon="solar:alt-arrow-down-linear" width={14} />}
          onClick={(e) => setFilterAnchorEl(e.currentTarget)}
          sx={{ textTransform: "none", fontSize: "13px", height: "32px", borderColor: activeFilterCount ? "primary.main" : "divider", color: activeFilterCount ? "primary.main" : "text.secondary" }}
        >
          {`Filter${activeFilterCount ? ` (${activeFilterCount})` : ""}`}
        </Button>
        <Box flex={1} />
        {/* As it always read: improvements start from a run's Debug failures,
            so the way in is a simulation. The agent's tab has its own header. */}
        {!embedded && (
          <Button
            size="small" variant="contained" color="primary"
            startIcon={<Iconify icon="solar:play-bold" width={15} />}
            onClick={() => navigate(paths.dashboard.simulate.environments)}
            sx={{ textTransform: "none", fontSize: "13px", height: "32px", fontWeight: 700 }}
          >
            Run simulation
          </Button>
        )}
      </Stack>

      <FilterPanel
        anchorEl={filterAnchorEl} open={Boolean(filterAnchorEl)} onClose={() => setFilterAnchorEl(null)}
        filterFields={filterFields} currentFilters={filters}
        onApply={(f) => { setFilters(f || {}); setFilterAnchorEl(null); }}
        placement="bottom-start"
      />

      {selectedIds.length > 0 && (
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ flexShrink: 0, px: 2, py: 1, borderRadius: 1.5, border: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
          <Typography sx={{ typography: "s2" }}>
            <Box component="span" sx={{ fontWeight: 700 }}>{selectedIds.length}</Box>
            <Box component="span" sx={{ color: "text.secondary" }}>{selectedIds.length === 1 ? " improvement selected" : " improvements selected"}</Box>
          </Typography>
          <Box flex={1} />
          <Button size="small" onClick={() => setSelectedIds([])} sx={{ typography: "s2", fontWeight: 600, color: "text.secondary", minWidth: 0, px: 1 }}>Clear</Button>
          <Button
            size="small" onClick={() => setConfirmDelete(true)}
            startIcon={<Iconify icon="solar:trash-bin-trash-linear" width={13} />}
            sx={{ typography: "s2", fontWeight: 600, color: "#DC2626", px: 1, minWidth: 0, "&:hover": { bgcolor: (t) => alpha("#DC2626", t.palette.mode === "dark" ? 0.12 : 0.06) } }}
          >
            Delete
          </Button>
        </Stack>
      )}

      <Box sx={embedded
        /* On the agent page it runs to the bottom of the screen, like the page's own list. */
        ? { display: "flex", border: "1px solid", borderColor: "divider", borderRadius: 1.5, overflow: "hidden", height: selectedIds.length ? "calc(100vh - 266px)" : "calc(100vh - 202px)", minHeight: HEADER_HEIGHT + 3 * ROW_HEIGHT }
        : { flex: 1, minHeight: 0, display: "flex" }}
      >
        <DataTable
          columns={columns}
          data={filtered}
          rowCount={filtered.length}
          getRowId={(r) => r.id}
          onRowClick={openRow}
          rowHeight={ROW_HEIGHT}
          headerHeight={HEADER_HEIGHT}
          emptyMessage={query || activeFilterCount
            ? "Nothing matches."
            : agent ? `${agent.name} hasn't been improved yet. Start one from Debug failures on a finished run, or Fix on an Error Feed issue.` : "No improvements yet. Start one from Debug failures on a finished run, or Fix on an Error Feed issue."}
        />
      </Box>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ typography: "m2", fontWeight: 700 }}>
          {selectedRows.length === 1 ? `Delete ${selectedRows[0].name}?` : `Delete ${selectedRows.length} improvements?`}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ typography: "s2" }}>
            Their runs go with them. The environments, their own runs and any agent versions or pull requests an improvement shipped stay as they are.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmDelete(false)} sx={{ typography: "s2", fontWeight: 600, color: "text.secondary" }}>Cancel</Button>
          <Button variant="contained" onClick={performDelete} sx={{ typography: "s2", fontWeight: 700, bgcolor: "#DC2626", color: "#fff", "&:hover": { bgcolor: "#B91C1C", color: "#fff" } }}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

ImprovementSourcesList.propTypes = { agent: PropTypes.object };
