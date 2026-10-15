import PropTypes from "prop-types";
import { Box, Tooltip, Typography } from "@mui/material";
import { PREVIEW_LABEL, PREVIEW_NOTE } from "../_mock/featureFlags";

/**
 * "Design partner preview" — on the Improvements nav item and wherever agent
 * improvement starts (the Fix sheet). Neutral, like the other quiet tags; the
 * note on hover says what the preview means. `short` reads "Preview" for the
 * nav, where the full label doesn't fit.
 */
export default function PreviewBadge({ short = false }) {
  return (
    <Tooltip arrow title={`${PREVIEW_LABEL}. ${PREVIEW_NOTE}`}>
      <Box
        component="span"
        sx={{
          display: "inline-flex", alignItems: "center", flexShrink: 0,
          height: 18, px: 0.625, borderRadius: 0.5,
          border: "1px solid", borderColor: "divider", color: "text.secondary",
        }}
      >
        <Typography component="span" noWrap sx={{ typography: "s3", fontWeight: 600, color: "inherit", lineHeight: 1 }}>
          {short ? "Preview" : PREVIEW_LABEL}
        </Typography>
      </Box>
    </Tooltip>
  );
}

PreviewBadge.propTypes = { short: PropTypes.bool };
