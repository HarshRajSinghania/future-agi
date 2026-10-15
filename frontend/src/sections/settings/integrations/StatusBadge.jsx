import PropTypes from "prop-types";
import { Box, Stack, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";

/*
  Tinted pills, not filled chips — a solid green/blue/red chip glares on the
  dark theme and its white label fails contrast. Each tone is lighter on dark
  and deeper on light so the label stays readable on both. Same shape as the
  Installed pill on the GitHub / Slack cards.
*/
const TONES = {
  green: { dark: "#4ADE80", light: "#15803D" },
  blue: { dark: "#60A5FA", light: "#1D4ED8" },
  amber: { dark: "#FBBF24", light: "#B45309" },
  red: { dark: "#F87171", light: "#B91C1C" },
};

const STATUS_CONFIG = {
  active: { tone: "green", label: "Active" },
  syncing: { tone: "blue", label: "Syncing" },
  paused: { tone: "amber", label: "Paused" },
  error: { tone: "red", label: "Error" },
  backfilling: { tone: "blue", label: "Backfilling" },
};

export default function StatusBadge({ status }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const config = STATUS_CONFIG[status] || { tone: null, label: status || "Unknown" };
  const color = config.tone ? TONES[config.tone][isDark ? "dark" : "light"] : theme.palette.text.secondary;
  const bg = config.tone ? alpha(color, isDark ? 0.12 : 0.1) : alpha(theme.palette.text.primary, 0.06);

  return (
    <Stack
      direction="row" alignItems="center" spacing={0.5}
      sx={{ px: 0.75, height: 22, borderRadius: 0.75, bgcolor: bg, flexShrink: 0 }}
    >
      <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: config.tone ? color : theme.palette.text.disabled }} />
      <Typography sx={{ typography: "s3", fontWeight: 600, color }}>{config.label}</Typography>
    </Stack>
  );
}

StatusBadge.propTypes = {
  status: PropTypes.string,
};
