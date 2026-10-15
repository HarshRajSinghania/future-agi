import PropTypes from "prop-types";
import { useState } from "react";
import { alpha } from "@mui/material/styles";
import { Box, IconButton, Link, Stack, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { paths } from "src/routes/paths";

/*
  The run pre-check, said at the top of the workspace (AC-16.7, AC-16.8).

  Refused: the next run would cross a usage limit. Persistent, and the one
  place it earns red — the standard limit message (dimension, current use,
  limit) and the way out: fewer repeats or scenarios, or an upgrade.

  Warn: a budget threshold. A quiet neutral line; the run still goes, and
  the notice can be put away for the session.

  `refusal` = metering.limitMessage(...), `notice` = metering.budgetNotice(...).
*/
export default function RunUsageBanner({ refusal, notice }) {
  const [hidden, setHidden] = useState(null);
  if (refusal) {
    return (
      <Stack
        direction="row" alignItems="center" spacing={1.25}
        sx={{
          px: 3, py: 1.25, flexWrap: "wrap", rowGap: 0.5,
          bgcolor: (t) => alpha("#DC2626", t.palette.mode === "dark" ? 0.1 : 0.05),
          borderBottom: "1px solid",
          borderColor: alpha("#DC2626", 0.24),
        }}
      >
        <Iconify icon="solar:forbidden-circle-linear" width={15} sx={{ color: "#DC2626", flexShrink: 0 }} />
        <Typography sx={{ typography: "s2", fontWeight: 700, color: "#DC2626", flexShrink: 0 }}>
          {`Run held — ${refusal.title.charAt(0).toLowerCase()}${refusal.title.slice(1)}`}
        </Typography>
        <Typography sx={{ typography: "s2", color: "text.secondary", flex: 1, minWidth: 240 }}>
          {`${refusal.line} Lower the repeats or the scenarios to run, or upgrade.`}
        </Typography>
        <Link
          href={paths.dashboard.settings.billing}
          underline="hover"
          sx={{ typography: "s2", fontWeight: 700, color: "text.primary", flexShrink: 0 }}
        >
          Upgrade
        </Link>
      </Stack>
    );
  }
  if (notice && hidden !== notice.line) {
    return (
      <Stack
        direction="row" alignItems="center" spacing={1}
        sx={{ px: 3, py: 0.75, bgcolor: "background.neutral", borderBottom: "1px solid", borderColor: "divider" }}
      >
        <Iconify icon="solar:info-circle-linear" width={14} sx={{ color: "text.subtitle", flexShrink: 0 }} />
        <Typography sx={{ typography: "s3", color: "text.secondary", flex: 1, minWidth: 0 }}>
          {notice.line}
        </Typography>
        <Link
          href={paths.dashboard.settings.usageSummary}
          underline="hover"
          sx={{ typography: "s3", fontWeight: 600, color: "text.secondary", flexShrink: 0 }}
        >
          Usage
        </Link>
        <Box>
          <IconButton size="small" onClick={() => setHidden(notice.line)} aria-label="Dismiss">
            <Iconify icon="mingcute:close-line" width={13} sx={{ color: "text.subtitle" }} />
          </IconButton>
        </Box>
      </Stack>
    );
  }
  return null;
}
RunUsageBanner.propTypes = { refusal: PropTypes.object, notice: PropTypes.object };
