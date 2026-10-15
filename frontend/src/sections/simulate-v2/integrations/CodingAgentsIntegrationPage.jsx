import PropTypes from "prop-types";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSnackbar } from "notistack";
import { Box, Button, Card, Chip, Menu, MenuItem, Stack, Switch, Tooltip, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { paths } from "src/routes/paths";
import {
  CLOUD_CODING_AGENTS, CODING_AGENTS, IMPROVER_SCOPES, IMPROVER_TOOLS, codingAgentById, codingAgentsAllowed,
  connectedCloudAgents, connectedCodingAgent, disconnectCloudAgent, disconnectCodingAgent, heldBackHiddenFrom, improverTokenLabel,
  myCodingAgents, rotateImproverToken, setCodingAgentsAllowed, useIntegrations,
} from "../_mock/integrations";
import { ago } from "../agents/agentViewUtils";
import BrandMark from "./BrandMark";
import CodingAgentConnectDialog from "./CodingAgentConnectDialog";
import { StatusPill } from "./GithubIntegrationPage";
import { GUARDRAILS, INTEGRITY_NOTE, WAYS, targetLabel } from "./codingAgentSetup";
import { CANDIDATE_ROUTES } from "../_mock/candidateRoute";
import { QuietTag } from "../agents/AgentBits";

const MONO = "ui-monospace, Menlo, monospace";
const CONNECTED = ["Connected", "Not connected"];
/* Lined up under the agent's name: row padding + mark + gap. */
const UNDER_NAME = "calc(24px + 30px + 12px)";

const createdLabel = (iso) => (new Date(iso).toDateString() === new Date().toDateString() ? "created today" : `created ${ago(iso)}`);

/** Settings → Integrations → Coding agents. */
export default function CodingAgentsIntegrationPage() {
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const integrations = useIntegrations();
  const { codingAgents = {}, briefHandoffs = [] } = integrations;
  const allowed = codingAgentsAllowed(integrations);
  const primary = connectedCodingAgent(integrations);
  const mine = myCodingAgents(integrations);
  const clouds = connectedCloudAgents(integrations);
  const nConnected = mine.length;
  const [cloudMenu, setCloudMenu] = useState(null); // { el, id }
  /* Kept apart so the dialog can fade out with its agent still set. */
  const [dialog, setDialog] = useState({ id: null, open: false });
  const [menu, setMenu] = useState(null); // { el, id }

  return (
    <Box>
      <Button
        size="small" variant="outlined"
        startIcon={<Iconify icon="formkit:left" width={16} height={16} />}
        onClick={() => navigate(paths.dashboard.settings.integrations)}
        sx={{ mb: 2 }}
      >
        Back to Integrations
      </Button>

      <Card sx={{ mb: 3, p: 3 }}>
        <Stack direction="row" alignItems="center" spacing={2}>
          <BrandMark brand={primary ? primary.id : "coding-agents"} size={48} />
          <Box flex={1} minWidth={0}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography sx={{ typography: "m2", fontWeight: "fontWeightSemiBold" }}>Coding agents</Typography>
            </Stack>
            <Typography sx={{ typography: "s1", color: "text.secondary" }}>
              {!allowed
                ? "Off for this workspace — Copy for coding agent still copies the brief."
                : primary
                  ? `Yours: ${primary.label} · ${WAYS[primary.via]?.short || primary.via}${clouds.length ? ` · workspace: ${clouds.map((c) => c.label).join(", ")}` : ""}`
                  : "Let Claude Code, Codex or Cursor fix issues — Future AGI checks every change."}
            </Typography>
            <Stack direction="row" spacing={0.75} sx={{ mt: 1 }} flexWrap="wrap" rowGap={0.75}>
              {["Briefs", "Candidates", "Verdicts", "MCP"].map((t) => (
                <Chip key={t} label={t} size="small" variant="outlined" sx={{ height: 22, typography: "s3" }} />
              ))}
            </Stack>
          </Box>
          <StatusPill on={!!primary || clouds.length > 0} labels={CONNECTED} />
        </Stack>
      </Card>

      <Stack spacing={3}>
        {/* The workspace decides whether coding agents are allowed at all. */}
        <Card>
          <Stack direction="row" alignItems="center" spacing={2} sx={{ px: 3, py: 2 }}>
            <Box flex={1} minWidth={0}>
              <Typography sx={{ typography: "s1", fontWeight: 700 }}>Allow coding agents in this workspace</Typography>
              <Typography sx={{ typography: "s2", color: "text.secondary" }}>
                {allowed
                  ? "Anyone can connect their own; admins connect cloud agents. Every change is checked by Future AGI."
                  : "Off — nobody can connect or send to one. Copy for coding agent still copies the brief."}
              </Typography>
            </Box>
            <Tooltip arrow title="Workspace admins only">
              <Switch checked={allowed} onChange={(e) => setCodingAgentsAllowed(e.target.checked)} />
            </Tooltip>
          </Stack>
        </Card>

        {/* Editor agents run on one person's machine — connected per person. */}
        <Card>
          <SectionHead
            title="Your coding agent"
            sub={primary
              ? `Connected for you. Copy for coding agent reads Hand to ${primary.label} for you — teammates connect their own.`
              : "For you only — the one you code with. Copy for coding agent then reads Hand to it for you; teammates connect their own."}
          />
          {CODING_AGENTS.map((a, i) => {
            const c = mine.find((m) => m.id === a.id) ? codingAgents[a.id] : null;
            return (
              <Box key={a.id} sx={{ borderTop: i ? "1px solid" : "none", borderColor: "divider" }}>
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 3, py: 1.25 }}>
                  <BrandMark brand={a.id} size={30} />
                  <Box flex={1} minWidth={0}>
                    <Typography sx={{ typography: "s2", fontWeight: 600 }}>{a.label}</Typography>
                    <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
                      {c
                        ? `Connected for you via ${WAYS[c.via]?.short || c.via} · ${ago(c.connectedAt)}${nConnected > 1 && primary?.id === a.id ? " · used for Hand to" : ""}`
                        : `${a.vendor} · ${a.ways.map((w) => WAYS[w].short).join(" or ")}${a.ways.includes("plugin") ? "" : " + instructions file"}`}
                    </Typography>
                  </Box>
                  {c ? (
                    <Button size="small" aria-label="More actions" onClick={(e) => setMenu({ el: e.currentTarget, id: a.id })} sx={{ minWidth: 0, color: "text.secondary" }}>
                      <Iconify icon="solar:menu-dots-bold" />
                    </Button>
                  ) : (
                    <Button
                      size="small" variant="outlined" disabled={!allowed} onClick={() => setDialog({ id: a.id, open: true })}
                      sx={{ typography: "s3", fontWeight: 700, color: "text.primary", borderColor: "divider", minWidth: 84 }}
                    >
                      Connect
                    </Button>
                  )}
                </Stack>
                {c && (
                  <TokenRow
                    agent={a} conn={c}
                    onRotate={() => {
                      const upgrade = !c.token;
                      rotateImproverToken(a.id);
                      enqueueSnackbar(upgrade
                        ? `${a.label} now uses its own improver token — scoped to the loop, with held-back scenarios hidden.`
                        : `Token rotated — the old one stopped working. ${a.label} asks you to sign in again on its next call.`, { variant: "success" });
                    }}
                  />
                )}
              </Box>
            );
          })}
          <Menu anchorEl={menu?.el} open={!!menu} onClose={() => setMenu(null)}>
            <MenuItem onClick={() => { setDialog({ id: menu.id, open: true }); setMenu(null); }} sx={{ typography: "s2" }}>Setup steps</MenuItem>
            <MenuItem onClick={() => { disconnectCodingAgent(menu.id); setMenu(null); }} sx={{ color: "error.main", typography: "s2" }}>Disconnect</MenuItem>
          </Menu>
        </Card>

        {/* Cloud agents work in their own sandbox and open a PR — one
            account for the workspace, connected by an admin. */}
        <Card>
          <SectionHead
            title="Cloud agents"
            tag="Coming soon"
            sub="Connected once for the workspace, to hand an issue to a cloud agent in one click — it works in its own sandbox against the agent's repository and opens a PR, checked against the same must-pass scenarios."
          />
          {CLOUD_CODING_AGENTS.map((a, i) => {
            const c = clouds.find((x) => x.id === a.id);
            return (
              <Stack key={a.id} direction="row" alignItems="center" spacing={1.5} sx={{ px: 3, py: 1.25, borderTop: i ? "1px solid" : "none", borderColor: "divider" }}>
                <BrandMark brand={a.id} size={30} />
                <Box flex={1} minWidth={0}>
                  <Typography sx={{ typography: "s2", fontWeight: 600 }}>{a.label}</Typography>
                  <Typography sx={{ typography: "s3", color: "text.subtitle" }}>
                    {c ? `Connected for the workspace · by ${c.connectedBy} · ${ago(c.connectedAt)}` : `${a.vendor} · signs in with ${a.vendor} · needs the agent's repository`}
                  </Typography>
                </Box>
                {c ? (
                  <Button size="small" aria-label="More actions" onClick={(e) => setCloudMenu({ el: e.currentTarget, id: a.id })} sx={{ minWidth: 0, color: "text.secondary" }}>
                    <Iconify icon="solar:menu-dots-bold" />
                  </Button>
                ) : (
                  <Button
                    size="small" variant="outlined" disabled
                    sx={{ typography: "s3", fontWeight: 700, color: "text.primary", borderColor: "divider", minWidth: 84 }}
                  >
                    Connect
                  </Button>
                )}
              </Stack>
            );
          })}
          <Menu anchorEl={cloudMenu?.el} open={!!cloudMenu} onClose={() => setCloudMenu(null)}>
            <MenuItem onClick={() => { disconnectCloudAgent(cloudMenu.id); setCloudMenu(null); }} sx={{ color: "error.main", typography: "s2" }}>Disconnect</MenuItem>
          </Menu>
        </Card>

        {/* What a coding agent submits, and how we test it, for every way an
            agent comes in — never on the live agent (candidateRoute). */}
        <Card>
          <SectionHead
            title="How its changes are tested"
            sub="Whatever your agent is built on, the coding agent changes what defines it and submits that as a candidate. Future AGI runs it next to today's version on the same scenarios — never on the live agent — and computes the verdict."
          />
          <Box sx={{ borderTop: "1px solid", borderColor: "divider" }}>
            <Stack direction="row" spacing={2} sx={{ px: 3, py: 0.875, bgcolor: "background.paper" }}>
              {["Your agent", "It submits", "We test it"].map((h, i) => (
                <Typography key={h} sx={{ typography: "s3", fontWeight: 500, color: "text.secondary", ...(i === 0 ? { width: 240, flexShrink: 0 } : { flex: 1, minWidth: 0 }) }}>{h}</Typography>
              ))}
            </Stack>
            {CANDIDATE_ROUTES.map((r) => (
              <Stack key={r.source} direction="row" spacing={2} sx={{ px: 3, py: 1.125, borderTop: "1px solid", borderColor: "divider" }}>
                <Typography sx={{ typography: "s2", fontWeight: 600, width: 240, flexShrink: 0 }}>{r.source}</Typography>
                <Typography sx={{ typography: "s2", color: "text.secondary", flex: 1, minWidth: 0 }}>{r.submits}</Typography>
                <Typography sx={{ typography: "s2", color: "text.secondary", flex: 1, minWidth: 0 }}>{r.tested}</Typography>
              </Stack>
            ))}
          </Box>
        </Card>

        <Card>
          <SectionHead title="What it can do" sub="Three tools over MCP, and nothing else." />
          {IMPROVER_TOOLS.map((t, i) => (
            <Stack key={t.name} direction="row" spacing={2} sx={{ px: 3, py: 1.25, borderTop: i ? "1px solid" : "none", borderColor: "divider" }}>
              <Typography sx={{ typography: "s2", fontFamily: MONO, fontWeight: 600, width: 160, flexShrink: 0 }}>{t.name}</Typography>
              <Typography sx={{ typography: "s2", color: "text.secondary", flex: 1 }}>{t.desc}</Typography>
            </Stack>
          ))}
        </Card>

        <Card>
          <SectionHead
            title="Token scope"
            sub="Each agent connects with its own improver token, not a workspace key. It reaches the loop and nothing else, and can't read held-back scenarios."
          />
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, borderTop: "1px solid", borderColor: "divider" }}>
            {[true, false].map((allowed) => (
              <Box key={String(allowed)} sx={{
                  px: 3, py: 1.5, borderColor: "divider", borderStyle: "solid", borderWidth: 0,
                  ...(!allowed && { borderTopWidth: { xs: "1px", md: 0 }, borderLeftWidth: { xs: 0, md: "1px" } }),
                }}>
                <Typography sx={{ typography: "s3", fontWeight: 700, color: "text.subtitle", mb: 1 }}>{allowed ? "Allowed" : "Denied"}</Typography>
                <Stack spacing={1}>
                  {IMPROVER_SCOPES.filter((sc) => sc.allowed === allowed).map((sc) => (
                    <Stack key={sc.id} direction="row" spacing={1} alignItems="flex-start">
                      <Iconify
                        icon={allowed ? "solar:check-circle-linear" : "solar:forbidden-circle-linear"} width={15}
                        sx={{ mt: 0.25, flexShrink: 0, color: allowed ? "text.secondary" : "text.disabled" }}
                      />
                      <Box flex={1} minWidth={0}>
                        <Stack direction="row" alignItems="baseline" spacing={1}>
                          <Typography sx={{ typography: "s2", fontWeight: 600 }}>{sc.label}</Typography>
                          <Typography noWrap sx={{ typography: "s3", fontFamily: MONO, color: "text.disabled" }}>{sc.id}</Typography>
                        </Stack>
                        <Typography sx={{ typography: "s3", color: "text.secondary" }}>{sc.desc}</Typography>
                      </Box>
                    </Stack>
                  ))}
                </Stack>
              </Box>
            ))}
          </Box>
        </Card>

        <Card>
          <SectionHead title="What it can never do" sub="Enforced by Future AGI, whatever the agent or its prompt asks for." />
          {GUARDRAILS.map((g, i) => (
            <Stack key={g.title} direction="row" spacing={2} sx={{ px: 3, py: 1.25, borderTop: i ? "1px solid" : "none", borderColor: "divider" }}>
              <Typography sx={{ typography: "s2", fontWeight: 600, width: 260, flexShrink: 0 }}>{g.title}</Typography>
              <Typography sx={{ typography: "s2", color: "text.secondary", flex: 1 }}>{g.body}</Typography>
            </Stack>
          ))}
          <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ mx: 3, mb: 2.5, mt: 1, px: 1.5, py: 1.25, borderRadius: 1, bgcolor: "background.neutral" }}>
            <Iconify icon="solar:lock-keyhole-minimalistic-linear" width={15} sx={{ color: "text.subtitle", mt: 0.25, flexShrink: 0 }} />
            <Typography sx={{ typography: "s3", color: "text.secondary" }}>{INTEGRITY_NOTE}</Typography>
          </Stack>
        </Card>

        {nConnected > 0 && (
          <Card>
            <SectionHead title="Recent hand-offs" sub="Briefs you handed over with Hand to. Your agent pulls each one with get_brief." />
            {briefHandoffs.length === 0 ? (
              <Typography sx={{ px: 3, pb: 2.5, typography: "s2", color: "text.subtitle" }}>
                None yet — open an Error Feed issue or a run&apos;s diagnosis and use Hand to.
              </Typography>
            ) : briefHandoffs.slice(0, 8).map((h, i) => (
              <Stack key={h.id} direction="row" alignItems="center" spacing={1.5} sx={{ px: 3, py: 1.25, borderTop: i ? "1px solid" : "none", borderColor: "divider" }}>
                <BrandMark brand={codingAgentById(h.agentId)?.id || "coding-agents"} size={22} tile={false} />
                <Box flex={1} minWidth={0}>
                  <Typography noWrap sx={{ typography: "s2", fontWeight: 600 }}>{h.title}</Typography>
                  <Typography sx={{ typography: "s3", color: "text.subtitle" }}>{`${targetLabel(h.target)} · to ${codingAgentById(h.agentId)?.label || "coding agent"}`}</Typography>
                </Box>
                <Typography sx={{ typography: "s3", color: "text.subtitle", whiteSpace: "nowrap" }}>{ago(h.at)}</Typography>
              </Stack>
            ))}
          </Card>
        )}
      </Stack>

      <CodingAgentConnectDialog
        open={dialog.open} onClose={() => setDialog((d) => ({ ...d, open: false }))}
        agent={dialog.id ? codingAgentById(dialog.id) : null}
      />
    </Box>
  );
}

function SectionHead({ title, sub, tag }) {
  return (
    <Box sx={{ px: 3, pt: 2.5, pb: 1.5 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography sx={{ typography: "s1", fontWeight: 700 }}>{title}</Typography>
        {tag && <QuietTag>{tag}</QuietTag>}
      </Stack>
      <Typography sx={{ typography: "s2", color: "text.secondary" }}>{sub}</Typography>
    </Box>
  );
}
SectionHead.propTypes = { title: PropTypes.string, sub: PropTypes.string, tag: PropTypes.string };

/* The agent's improver token — or, for a connection made before tokens were
   scoped, the workspace key it still uses and the way off it. */
function TokenRow({ agent, conn, onRotate }) {
  const scoped = heldBackHiddenFrom(agent.id);
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ pl: UNDER_NAME, pr: 3, pb: 1.25, mt: -0.5 }}>
      <Iconify icon="solar:key-minimalistic-linear" width={14} sx={{ color: "text.subtitle", flexShrink: 0 }} />
      {conn.token ? (
        <Typography sx={{ typography: "s3", color: "text.subtitle", flex: 1, minWidth: 0 }}>
          <Box component="span" sx={{ fontFamily: MONO, color: "text.secondary" }}>{improverTokenLabel(conn.token)}</Box>
          {` · ${scoped ? "scoped" : "unscoped"} · ${createdLabel(conn.token.createdAt)}`}
        </Typography>
      ) : (
        <Typography sx={{ typography: "s3", color: "text.subtitle", flex: 1, minWidth: 0 }}>
          Workspace key · can read held-back scenarios
        </Typography>
      )}
      <Tooltip arrow placement="top" title={conn.token ? "Issue a new token. The old one stops working at once." : "Issue a scoped improver token in place of the workspace key."}>
        <Button size="small" onClick={onRotate} sx={{ typography: "s3", fontWeight: 700, color: "text.secondary", minWidth: 0, px: 1 }}>
          {conn.token ? "Rotate" : "Switch to a scoped token"}
        </Button>
      </Tooltip>
    </Stack>
  );
}
TokenRow.propTypes = { agent: PropTypes.object, conn: PropTypes.object, onRotate: PropTypes.func };

CodingAgentsIntegrationPage.propTypes = {};
