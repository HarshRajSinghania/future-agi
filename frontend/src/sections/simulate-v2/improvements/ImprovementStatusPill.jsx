import PropTypes from "prop-types";
import { alpha } from "@mui/material/styles";
import { Chip, Tooltip, Typography } from "@mui/material";

/* One colour per ending that earns one — in progress, ready to review, or
   broken. The endings that just stopped (no safe change, budget, not
   reproduced) stay neutral: nothing to celebrate, nothing on fire. */
const STATUS_TONE = {
  running: { color: "#2563EB", animated: true },
  ready: { color: "#16A34A" },
  failed: { color: "#DC2626" },
};

/**
 * An improvement run's status as an outlined pill — the same shape as the
 * prod Scenarios chip. Shared by both Improvements levels.
 */
export default function StatusPill({ ending, headline }) {
  if (!ending) {
    return <Typography sx={{ typography: "s3", color: "text.disabled" }}>—</Typography>;
  }
  const tone = STATUS_TONE[ending.key];
  /* Outlined pill matching the prod Scenarios chip — visible colored
     border, near-transparent fill, colored text. Neutral endings keep the
     same shape in the divider colour. */
  return (
    <Tooltip arrow title={headline || ""} disableHoverListener={!headline}>
      <Chip
        variant="outlined"
        label={ending.label}
        size="small"
        sx={{
          typography: "s3",
          fontWeight: "fontWeightMedium",
          borderColor: tone ? tone.color : "divider",
          color: tone ? tone.color : "text.secondary",
          backgroundColor: (t) => (tone ? alpha(tone.color, t.palette.mode === "dark" ? 0.04 : 0.02) : "transparent"),
          animation: tone?.animated ? "improvement-status-pulse 1.6s ease-in-out infinite" : "none",
          "@keyframes improvement-status-pulse": {
            "0%,100%": { opacity: 0.75 },
            "50%":     { opacity: 1 },
          },
        }}
      />
    </Tooltip>
  );
}
StatusPill.propTypes = { ending: PropTypes.object, headline: PropTypes.string };
