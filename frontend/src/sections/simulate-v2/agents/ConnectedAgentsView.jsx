import PropTypes from "prop-types";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  IconButton, Stack, Tooltip, Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import Iconify from "src/components/iconify";
import FormSearchField from "src/components/FormSearchField/FormSearchField";
import { DataTable, DataTablePagination } from "src/components/data-table";
import { useSnackbar } from "notistack";
import { paths } from "src/routes/paths";
import { useConnectedAgents } from "../store";
import { neutralCheckboxSx } from "../components/primitives";
import { deleteBlockOf } from "../_mock/rsiModel";
import { agentSourceOf } from "../_mock/agentRegistry";
import { projectsOfAgent } from "../_mock/projectLinks";
import AgentStateTags from "./AgentStateTags";
import BuildEnvironmentDialog from "./BuildEnvironmentDialog";
import { MONO, ago, buildPresetFor } from "./agentViewUtils";
import { MOVED_FROM_SIMULATE, identityOf, languagesLabel } from "./agentProfile";
import useMoveLegacyDefinitions from "./useMoveLegacyDefinitions";

/**
 * Every agent connected in the workspace — from the Agents page or while
 * building an environment. One row per agent, however many environments
 * test it; versions added anywhere show up here.
 */
export default function ConnectedAgentsView({ onConnect }) {
  const navigate = useNavigate();
  const { agents, hydrated, state, removeAgent } = useConnectedAgents();
  const { enqueueSnackbar } = useSnackbar();
  /* Old Simulate agent definitions join this list on their own. */
  useMoveLegacyDefinitions();
  const [query, setQuery] = useState("");
  const [params, setParams] = useSearchParams();
  const justConnected = agents.find((a) => a.id === params.get("connected"));
  const dismiss = () => setParams({ tab: "connected" }, { replace: true });
  /* Arrived from an old Simulate → Agent definitions link. */
  const moved = params.get("moved") === "agent-definitions";
  /* Same three choices as Build environment on the agent's page. */
  const [buildFor, setBuildFor] = useState(null);
  const startBuild = (choice) => navigate(paths.dashboard.simulate.environmentBuild, {
    state: { presetSource: buildPresetFor(buildFor, choice) },
  });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    /* A template's stand-in isn't anyone's agent — it lives in its environment. */
    return agents
      .filter((a) => !a.placeholder)
      .map((a) => ({ ...a, source: agentSourceOf(a), identity: identityOf(a), projects: projectsOfAgent(a, state, agents) }))
      .filter((a) => !q || `${a.name} ${a.source.label} ${a.source.where} ${a.identity.owner} ${a.identity.description}`.toLowerCase().includes(q));
  }, [agents, query, state]);

  /* Paged like the other lists; a search starts back on page one. */
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  useEffect(() => { setPage(0); }, [query]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
  const pageRows = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  /* Select several and delete them. An agent an environment still tests
     can't be deleted — same rule as its own page — so its box is off, with
     the reason on hover. Selection is kept by id across pages. */
  const [selectedIds, setSelectedIds] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deletable = (a) => !deleteBlockOf(a);
  const pageDeletable = pageRows.filter(deletable);
  const pageAllOn = pageDeletable.length > 0 && pageDeletable.every((a) => selectedIds.includes(a.id));
  const pageSomeOn = pageDeletable.some((a) => selectedIds.includes(a.id));
  const toggleRow = (id) => setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const togglePage = () => setSelectedIds((ids) => (pageAllOn
    ? ids.filter((id) => !pageDeletable.some((a) => a.id === id))
    : [...new Set([...ids, ...pageDeletable.map((a) => a.id)])]));
  /* Drop ids that left the list (deleted elsewhere, or now in use). */
  const selectedAgents = agents.filter((a) => selectedIds.includes(a.id) && deletable(a));
  const performDelete = () => {
    selectedAgents.forEach((a) => removeAgent(a.key));
    enqueueSnackbar(
      selectedAgents.length === 1
        ? `${selectedAgents[0].name} deleted. Its runs stay with the environments that ran them.`
        : `${selectedAgents.length} agents deleted. Their runs stay with the environments that ran them.`,
      { variant: "success" },
    );
    setSelectedIds([]);
    setConfirmDelete(false);
  };

  /* Rebuilt each render — the select column reads the current selection. */
  const columns = [
    {
      id: "select", header: "", size: 48, enableSorting: false,
      renderHeader: () => (
        <Checkbox
          size="small"
          checked={pageAllOn}
          indeterminate={!pageAllOn && pageSomeOn}
          disabled={!pageDeletable.length}
          onChange={togglePage}
          inputProps={{ "aria-label": "Select every agent on this page that can be deleted" }}
          sx={{ p: 0, ...neutralCheckboxSx, "&.Mui-disabled": { opacity: 0.3 } }}
        />
      ),
      cell: ({ row }) => {
        const a = row.original;
        const blocked = deleteBlockOf(a);
        const box = (
          <Checkbox
            size="small"
            checked={selectedIds.includes(a.id)}
            disabled={!!blocked}
            onChange={() => toggleRow(a.id)}
            onClick={(e) => e.stopPropagation()}
            inputProps={{ "aria-label": `Select ${a.name}` }}
            sx={{ p: 0, ...neutralCheckboxSx, "&.Mui-disabled": { opacity: 0.3 } }}
          />
        );
        return (
          <Box onClick={(e) => e.stopPropagation()} sx={{ display: "flex", alignItems: "center", height: "100%" }}>
            {blocked ? <Tooltip arrow placement="right" title={blocked}><span>{box}</span></Tooltip> : box}
          </Box>
        );
      },
    },
    {
      id: "name", accessorKey: "name", header: "Agent name", meta: { flex: 2 }, minSize: 280, enableSorting: false,
      cell: ({ row }) => {
        const a = row.original;
        return (
          <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minWidth: 0, height: "100%" }}>
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minWidth: 0 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 500, minWidth: 0 }}>{a.name}</Typography>
                <AgentStateTags agent={a} />
              </Stack>
              {a.identity.description && (
                <Typography noWrap title={a.identity.description} sx={{ typography: "s3", color: "text.subtitle", minWidth: 0 }}>{a.identity.description}</Typography>
              )}
            </Box>
          </Stack>
        );
      },
    },
    {
      id: "owner", accessorKey: "owner", header: "Owner", size: 170, enableSorting: false,
      cell: ({ row }) => {
        const id = row.original.identity;
        return (
          <Typography variant="body2" noWrap sx={{ fontSize: 13 }}>
            {id.owner}
            <Box component="span" sx={{ color: "text.secondary" }}>{` · ${languagesLabel(id.languages, 2)}`}</Box>
          </Typography>
        );
      },
    },
    {
      id: "source", accessorKey: "source", header: "Source", size: 170, enableSorting: false,
      cell: ({ row }) => <Typography variant="body2" noWrap sx={{ fontSize: 13 }}>{row.original.source.label}</Typography>,
    },
    {
      id: "latest", accessorKey: "latest", header: "Versions", size: 140, enableSorting: false,
      cell: ({ row }) => (
        <Typography variant="body2" noWrap sx={{ fontSize: 13 }}>
          <Box component="span" sx={{ fontFamily: MONO, fontWeight: 600 }}>{row.original.latest}</Box>
          <Box component="span" sx={{ color: "text.secondary" }}>
            {`${row.original.latestIsDraft ? ` draft · ${row.original.production} in production` : ""} · ${row.original.versions.length} total`}
          </Box>
        </Typography>
      ),
    },
    {
      /* Where its production traces land — what lets its Error Feed issues
         be fixed. None means an issue can't be fixed against it. */
      id: "production", accessorKey: "projects", header: "Production", size: 170, enableSorting: false,
      cell: ({ row }) => {
        const p = row.original.projects || [];
        return (
          <Tooltip arrow title={p.length ? `Error Feed issues from ${p.map((x) => x.name).join(", ")} can be fixed with this agent.` : "No Observe project — its Error Feed issues can't be fixed. Set one on its Connections tab."}>
            <Typography variant="body2" noWrap sx={{ fontSize: 13, color: p.length ? "text.primary" : "text.disabled" }}>
              {p.length ? p.map((x) => x.name).join(", ") : "Not linked"}
            </Typography>
          </Tooltip>
        );
      },
    },
    {
      id: "usedIn", accessorKey: "usedIn", header: "Used in", meta: { flex: 1 }, minSize: 200, enableSorting: false,
      cell: ({ row }) => {
        const u = row.original.usedIn;
        const { production } = row.original;
        const behind = u.filter((x) => x.behind);
        /* An environment still testing an older version than the latest —
           said as the version it tests, not a bare "N behind". Muted like
           the "· N total" beside it; the tooltip says what to do. */
        const lag = behind.length === 0 ? null
          : u.length === 1 ? `tests ${behind[0].running}`
            : `${behind.length} on older version${behind.length === 1 ? "" : "s"}`;
        const why = behind.length === 0 ? "" : (
          <Stack spacing={0.25} sx={{ py: 0.25 }}>
            {behind.map((x) => (
              <Typography key={x.envId} sx={{ typography: "s3", color: "inherit" }}>{`${x.envName} tests ${x.running}`}</Typography>
            ))}
            <Typography sx={{ typography: "s3", color: "inherit", opacity: 0.75 }}>
              {`${production} is in production. Switch ${behind.length === 1 ? "it" : "them"} from the agent's Environments tab.`}
            </Typography>
          </Stack>
        );
        return (
          <Typography variant="body2" noWrap sx={{ fontSize: 13, color: u.length ? "text.primary" : "text.disabled" }}>
            {u.length === 0 ? "No environments yet" : u.length === 1 ? u[0].envName : `${u.length} environments`}
            {lag && (
              <Tooltip arrow title={why}>
                <Box component="span" sx={{ color: "text.secondary", cursor: "help" }}>{` · ${lag}`}</Box>
              </Tooltip>
            )}
          </Typography>
        );
      },
    },
    {
      id: "updatedAt", accessorKey: "updatedAt", header: "Last updated", size: 170, enableSorting: false,
      cell: ({ row }) => (
        <Typography variant="body2" noWrap sx={{ fontSize: 13 }}>
          {row.original.lastSyncedAt ? `Synced ${ago(row.original.lastSyncedAt)}` : ago(row.original.updatedAt)}
        </Typography>
      ),
    },
    {
      id: "connectedAt", accessorKey: "connectedAt", header: "Connected", size: 140, enableSorting: false,
      cell: ({ row }) => <Typography variant="body2" noWrap sx={{ fontSize: 13 }}>{ago(row.original.connectedAt)}</Typography>,
    },
  ];

  if (hydrated && agents.length === 0) {
    return (
      <Box sx={{ p: 5, textAlign: "center", border: "1px dashed", borderColor: "divider", borderRadius: 1.5 }}>
        <Iconify icon="solar:link-circle-linear" width={28} sx={{ color: "text.subtitle" }} />
        <Typography sx={{ typography: "s1", fontWeight: 600, mt: 1 }}>No connected agents yet</Typography>
        <Typography sx={{ typography: "s2", color: "text.subtitle", mt: 0.5, mb: 2, maxWidth: 460, mx: "auto" }}>
          Connect your agent — a hosted platform, an endpoint, a repository or an upload — and we make the copy simulations run against.
        </Typography>
        <Button variant="contained" color="primary" size="small" onClick={onConnect} sx={{ typography: "s2", fontWeight: 700 }}>
          Connect an agent
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, flex: 1, minHeight: 0 }}>
      {justConnected && (
        <Stack
          direction="row" alignItems="center" spacing={1.25}
          sx={{
            px: 1.75, py: 1.25, borderRadius: 1.25, border: "1px solid",
            borderColor: alpha("#16A34A", 0.4),
            bgcolor: (t) => alpha("#16A34A", t.palette.mode === "dark" ? 0.1 : 0.06),
          }}
        >
          <Iconify icon="solar:check-circle-bold" width={18} sx={{ color: "#16A34A", flexShrink: 0 }} />
          <Box flex={1} minWidth={0}>
            <Typography sx={{ typography: "s2", fontWeight: 700 }}>
              {params.get("existing") ? `${justConnected.name} was already connected` : `${justConnected.name} is connected`}
            </Typography>
            <Typography sx={{ typography: "s3", color: "text.secondary" }}>
              {justConnected.usedIn.length
                ? `Used in ${justConnected.usedIn.length} environment${justConnected.usedIn.length === 1 ? "" : "s"}. Build another to test it under different conditions.`
                : "Next, build an environment for it — the simulated tools and data, scenarios and evaluations it will be tested against."}
            </Typography>
          </Box>
          <Button size="small" onClick={() => navigate(`${paths.dashboard.agents}/connected/${justConnected.id}`)} sx={{ typography: "s2", fontWeight: 700, color: "text.primary" }}>
            View agent
          </Button>
          <Button size="small" variant="contained" color="primary" onClick={() => setBuildFor(justConnected)} sx={{ typography: "s2", fontWeight: 700 }}>
            Build environment
          </Button>
          <IconButton size="small" onClick={dismiss} aria-label="Dismiss"><Iconify icon="eva:close-fill" width={16} /></IconButton>
        </Stack>
      )}
      {moved && (
        <Stack
          direction="row" alignItems="center" spacing={1.25}
          sx={{ px: 1.75, py: 1, borderRadius: 1.25, border: "1px solid", borderColor: "divider", bgcolor: "background.neutral" }}
        >
          <Iconify icon="solar:info-circle-linear" width={16} sx={{ color: "text.secondary", flexShrink: 0 }} />
          <Typography sx={{ typography: "s2", color: "text.secondary", flex: 1, minWidth: 0 }}>{MOVED_FROM_SIMULATE}</Typography>
          <IconButton size="small" onClick={dismiss} aria-label="Dismiss"><Iconify icon="eva:close-fill" width={16} /></IconButton>
        </Stack>
      )}
      <FormSearchField
        searchQuery={query}
        onChange={(e) => setQuery(e.target.value)}
        size="small"
        placeholder="Search"
        sx={{ width: 250, "& .MuiOutlinedInput-root": { height: "30px" } }}
      />
      {selectedIds.length > 0 && selectedAgents.length > 0 && (
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ flexShrink: 0, px: 2, py: 1, borderRadius: 1.5, border: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
          <Typography sx={{ typography: "s2" }}>
            <Box component="span" sx={{ fontWeight: 700 }}>{selectedAgents.length}</Box>
            <Box component="span" sx={{ color: "text.secondary" }}>{selectedAgents.length === 1 ? " agent selected" : " agents selected"}</Box>
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
      <DataTable
        columns={columns}
        data={pageRows}
        rowCount={rows.length}
        getRowId={(r) => r.id}
        rowHeight={rows.some((r) => r.identity.description) ? 52 : 44}
        onRowClick={(r) => navigate(`${paths.dashboard.agents}/connected/${r.id}`)}
        emptyMessage="No agents match your search"
      />
      {rows.length > 0 && (
        <DataTablePagination
          page={currentPage}
          pageSize={pageSize}
          total={rows.length}
          onPageChange={setPage}
          onPageSizeChange={(n) => { setPageSize(n); setPage(0); }}
        />
      )}
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ typography: "m2", fontWeight: 700 }}>
          {selectedAgents.length === 1 ? `Delete ${selectedAgents[0].name}?` : `Delete ${selectedAgents.length} agents?`}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ typography: "s2" }}>
            {`${selectedAgents.length === 1 ? "It leaves" : "They leave"} Connected agents with ${selectedAgents.length === 1 ? "its" : "their"} versions. Runs stay with the environments that ran them, and proofs on shipped changes are kept. Connect ${selectedAgents.length === 1 ? "it" : "any of them"} again any time.`}
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmDelete(false)} sx={{ typography: "s2", fontWeight: 600, color: "text.secondary" }}>Cancel</Button>
          <Button variant="contained" onClick={performDelete} sx={{ typography: "s2", fontWeight: 700, bgcolor: "#DC2626", color: "#fff", "&:hover": { bgcolor: "#B91C1C", color: "#fff" } }}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
      {buildFor && (
        <BuildEnvironmentDialog
          open
          onClose={() => setBuildFor(null)}
          agent={buildFor}
          defaultVersion={buildFor.production || buildFor.latest}
          onBuild={startBuild}
        />
      )}
    </Box>
  );
}

ConnectedAgentsView.propTypes = { onConnect: PropTypes.func };
