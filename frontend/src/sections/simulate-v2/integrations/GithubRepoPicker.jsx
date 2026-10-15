import PropTypes from "prop-types";
import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import Iconify from "src/components/iconify";
import { githubAccountsLabel, installedRepos, useIntegrations } from "../_mock/integrations";
import BrandMark from "./BrandMark";
import GithubInstallDialog from "./GithubInstallDialog";
import { HintLine } from "../agents/connect/replicationBits";
import { clickable, focusRing } from "../components/clickable";

const MONO = "ui-monospace, Menlo, monospace";

/**
 * Pick the agent, not the URL: choose a repository from the GitHub install,
 * we scan it, and the person says which agent they mean — a repository can
 * hold several. Falls back to typing a URL for code that isn't on GitHub.
 */
export default function GithubRepoPicker({ repo, agentId, onPick, onManual, showAgents = true }) {
  const integrations = useIntegrations();
  const repos = installedRepos(integrations);
  const [installOpen, setInstallOpen] = useState(false);
  const [scanning, setScanning] = useState(false);

  const current = repos.find((r) => r.name === repo) || null;

  useEffect(() => {
    if (!repo || !showAgents) return undefined;
    setScanning(true);
    const t = setTimeout(() => setScanning(false), 800);
    return () => clearTimeout(t);
  }, [repo, showAgents]);

  /* One dialog in the same spot in both branches, so installing (which
     flips the branch) doesn't remount it mid-flow. */
  const dialog = (
    <GithubInstallDialog
      open={installOpen}
      onClose={() => setInstallOpen(false)}
    />
  );

  if (!integrations.github) {
    return (
      <>
        <Box>
          <Stack
            direction="row"
            alignItems="center"
            spacing={1.5}
            sx={{
              p: 1.75,
              borderRadius: 1.25,
              border: "1px dashed",
              borderColor: "divider",
            }}
          >
            <BrandMark brand="github" size={34} />
            <Box flex={1} minWidth={0}>
              <Typography sx={{ typography: "s2", fontWeight: 700 }}>
                Install the GitHub App to pick the agent
              </Typography>
              <Typography component="div" sx={{ typography: "s3", color: integrations.githubRequests?.length ? "text.secondary" : "text.subtitle" }}>
                {integrations.githubRequests?.length ? (
                  <HintLine hint="Or install it on another account.">
                    {`Waiting for an owner of ${integrations.githubRequests[0].account} to approve`}
                  </HintLine>
                ) : (
                  <HintLine hint="We scan the repositories you choose and find the agents in them. We ask for write access at your first draft pull request.">
                    Read only — we find the agents in your repos.
                  </HintLine>
                )}
              </Typography>
            </Box>
            <Button
              size="small"
              variant="contained"
              color="primary"
              onClick={() => setInstallOpen(true)}
              startIcon={<Iconify icon="mdi:github" width={15} />}
              sx={{ typography: "s2", fontWeight: 700, flexShrink: 0 }}
            >
              Install GitHub App
            </Button>
          </Stack>
          <ManualLink
            onManual={onManual}
            label="Not on GitHub? Enter a repository URL instead"
          />
        </Box>
        {dialog}
      </>
    );
  }

  return (
    <>
      <Stack spacing={1.25}>
        <Box>
          <Stack
            direction="row"
            alignItems="center"
            spacing={0.75}
            sx={{ mb: 0.5 }}
          >
            <Typography sx={{ typography: "s3", fontWeight: 600 }}>
              Repository
            </Typography>
            <Typography
              sx={{ typography: "s3", color: "text.subtitle" }}
            >{`· from GitHub (${githubAccountsLabel(integrations)})`}</Typography>
            <Box flex={1} />
            <Typography
              {...clickable(() => setInstallOpen(true))}
              sx={{
                ...focusRing,
                typography: "s3",
                color: "text.subtitle",
                cursor: "pointer",
                "&:hover": {
                  color: "text.primary",
                  textDecoration: "underline",
                },
              }}
            >
              Missing a repository? Change access on GitHub
            </Typography>
          </Stack>
          <Select
            size="small"
            fullWidth
            displayEmpty
            value={repo || ""}
            onChange={(e) => onPick({ repo: e.target.value, agent: null })}
            renderValue={(v) =>
              v ? (
                <Box component="span" sx={{ fontFamily: MONO }}>
                  {v}
                </Box>
              ) : (
                <Box component="span" sx={{ color: "text.disabled" }}>
                  Choose a repository
                </Box>
              )
            }
            sx={{ typography: "s2" }}
          >
            {repos.map((r) => (
              <MenuItem
                key={r.name}
                value={r.name}
                sx={{ typography: "s2", gap: 1 }}
              >
                <Box component="span" sx={{ fontFamily: MONO, flex: 1 }}>
                  {r.name}
                </Box>
                <Box component="span" sx={{ color: "text.subtitle" }}>
                  {r.language}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </Box>

        {/* Without the agent list, the caller asks for the branch and the
            folder next and reads only that. */}
        {current && showAgents &&
          (scanning ? (
            <Stack
              direction="row"
              alignItems="center"
              spacing={1}
              sx={{
                px: 1.5,
                py: 1.25,
                borderRadius: 1,
                bgcolor: "background.neutral",
              }}
            >
              <CircularProgress
                size={13}
                thickness={5}
                sx={{ color: "text.subtitle" }}
              />
              <Typography
                sx={{ typography: "s2", color: "text.secondary" }}
              >{`Scanning ${current.name} for agents…`}</Typography>
            </Stack>
          ) : current.agents.length === 0 ? (
            <Box
              sx={{
                px: 1.5,
                py: 1.25,
                borderRadius: 1,
                bgcolor: "background.neutral",
              }}
            >
              <Typography sx={{ typography: "s2", color: "text.secondary" }}>
                We didn&apos;t find an agent in this repository.
              </Typography>
              <ManualLink
                onManual={() => onManual?.({ repo: current.name })}
                label="Point us at the entry file instead"
              />
            </Box>
          ) : (
            <Box>
              <Typography sx={{ typography: "s3", fontWeight: 600, mb: 0.5 }}>
                {current.agents.length === 1
                  ? "We found 1 agent"
                  : `We found ${current.agents.length} agents — which one do you mean?`}
              </Typography>
              <Stack spacing={0.75}>
                {current.agents.map((a) => {
                  const on = a.id === agentId;
                  return (
                    <Stack
                      key={a.id}
                      direction="row"
                      alignItems="center"
                      spacing={1.25}
                      {...clickable(() => onPick({ repo: current.name, agent: a }), { role: "radio", checked: on })}
                      sx={{
                        ...focusRing,
                        px: 1.5,
                        py: 1.125,
                        borderRadius: 1,
                        cursor: "pointer",
                        border: "1px solid",
                        borderColor: on ? "text.primary" : "divider",
                        bgcolor: (t) =>
                          on
                            ? alpha(
                                t.palette.text.primary,
                                t.palette.mode === "dark" ? 0.06 : 0.03,
                              )
                            : "transparent",
                      }}
                    >
                      {/* The row is the target; the checkbox says which one is chosen. */}
                      <Checkbox
                        size="small"
                        checked={on}
                        tabIndex={-1}
                        inputProps={{ "aria-label": `Choose ${a.name}` }}
                        sx={{ p: 0, flexShrink: 0 }}
                      />
                      <Box flex={1} minWidth={0}>
                        <Typography
                          noWrap
                          sx={{ typography: "s2", fontWeight: 600 }}
                        >
                          {a.name}
                        </Typography>
                        <Typography
                          noWrap
                          sx={{ typography: "s3", color: "text.subtitle" }}
                        >
                          {`${a.framework} · `}
                          <Box component="span" sx={{ fontFamily: MONO }}>
                            {a.entry}
                          </Box>
                          {` · ${a.tools} tools · ${a.prompts.length} prompt file${a.prompts.length === 1 ? "" : "s"}`}
                        </Typography>
                      </Box>
                    </Stack>
                  );
                })}
              </Stack>
            </Box>
          ))}
        <ManualLink
          onManual={onManual}
          label="Enter a repository URL instead"
        />
      </Stack>
      {dialog}
    </>
  );
}

GithubRepoPicker.propTypes = {
  repo: PropTypes.string,
  agentId: PropTypes.string,
  onPick: PropTypes.func.isRequired,
  onManual: PropTypes.func,
  showAgents: PropTypes.bool,
};

function ManualLink({ onManual, label }) {
  if (!onManual) return null;
  return (
    <Typography
      {...clickable(() => onManual())}
      sx={{
        ...focusRing,
        typography: "s3",
        color: "text.subtitle",
        cursor: "pointer",
        mt: 0.75,
        width: "fit-content",
        "&:hover": { color: "text.primary", textDecoration: "underline" },
      }}
    >
      {label}
    </Typography>
  );
}
ManualLink.propTypes = { onManual: PropTypes.func, label: PropTypes.string };
