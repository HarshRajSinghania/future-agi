import PropTypes from "prop-types";
import { useState } from "react";
import {
  Box, Stack, Typography, Button, Dialog, DialogContent, DialogActions, IconButton,
} from "@mui/material";
import Iconify from "src/components/iconify";
import { PAIR_CLASSES, PAIR_ORDER } from "../_mock/pairs";

/*
  Tone is said in words and an icon — never as yellow text. Green ("verdict to
  ±9 points") stays neutral too: precision is a number, not a colour.
*/
const TONE = {
  green: { icon: "solar:check-circle-linear", word: "Decision-grade" },
  amber: { icon: "solar:question-circle-linear", word: "Likely inconclusive" },
  grey: { icon: "solar:info-circle-linear", word: "New baseline" },
};

/**
 * What a run about to start will be able to say against its baseline
 * (PRD v7 §4.10.7): the count per pair class, the predicted interval, and
 * priced ways to sharpen it. Nothing is blocked — the plan runs as is with
 * one click.
 */
export default function ComparabilityPreview({ preview, onChoose, done = {} }) {
  if (!preview) return null;
  const tone = TONE[preview.tone] || TONE.grey;
  const counts = PAIR_ORDER.filter((k) => preview.counts?.[k]);
  const extras = preview.options.filter((o) => !o.primary);
  return (
    <Box>
      <Stack direction="row" alignItems="flex-start" spacing={1.25}>
        <Iconify icon={tone.icon} width={20} sx={{ color: "text.secondary", flexShrink: 0, mt: 0.25 }} />
        <Box minWidth={0}>
          <Typography sx={{ typography: "s1", fontWeight: 700 }}>{preview.headline}</Typography>
          <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.25 }}>
            {preview.baseline
              ? `Against ${preview.baseline.label} — ${preview.baseline.why}.`
              : preview.detail}
          </Typography>
        </Box>
      </Stack>

      {counts.length > 0 && (
        <Box sx={{ mt: 1.5, display: "grid", gridTemplateColumns: `repeat(${Math.min(counts.length, 4)}, minmax(0, 1fr))`, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
          {counts.map((k, i) => (
            <Box key={k} sx={{ px: 1.25, py: 0.875, borderLeft: i % 4 ? "1px solid" : "none", borderTop: i >= 4 ? "1px solid" : "none", borderColor: "divider" }}>
              <Typography sx={{ typography: "m2", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: PAIR_CLASSES[k].inDelta ? "text.primary" : "text.secondary" }}>
                {preview.counts[k]}
              </Typography>
              <Typography noWrap sx={{ typography: "s3", color: "text.subtitle" }}>
                {PAIR_CLASSES[k].label}{PAIR_CLASSES[k].inDelta ? "" : " · outside"}
              </Typography>
            </Box>
          ))}
        </Box>
      )}

      {extras.length > 0 && (
        <>
          <Typography sx={{ mt: 2, mb: 0.75, typography: "s3", fontWeight: 700, color: "text.subtitle", textTransform: "uppercase", letterSpacing: 0.4 }}>
            Sharpen it
          </Typography>
          <Stack divider={<Box sx={{ borderTop: "1px solid", borderColor: "divider" }} />} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
            {extras.map((o) => (
              <Stack key={o.id} direction="row" alignItems="center" spacing={1.25} sx={{ px: 1.25, py: 1 }}>
                <Box flex={1} minWidth={0}>
                  <Typography sx={{ typography: "s2", fontWeight: 600 }}>{o.label}</Typography>
                  <Typography sx={{ typography: "s3", color: "text.subtitle" }}>{done[o.id] || o.line}</Typography>
                </Box>
                {!o.disabled && !done[o.id] && (
                  <Button
                    size="small" variant="outlined" onClick={() => onChoose(o)}
                    sx={{ flexShrink: 0, typography: "s3", fontWeight: 700, color: "text.primary", borderColor: "divider", "&:hover": { borderColor: "text.disabled", bgcolor: "action.hover" } }}
                  >
                    {o.id === "regrade" ? "Re-grade" : "Run this"}
                  </Button>
                )}
              </Stack>
            ))}
          </Stack>
        </>
      )}
    </Box>
  );
}
ComparabilityPreview.propTypes = { preview: PropTypes.object, onChoose: PropTypes.func, done: PropTypes.object };

/**
 * The preview as the one confirming step amber and grey runs take. Green
 * runs never see it — their precision rides on the Run tooltip.
 */
export function ComparabilityPreviewDialog({ open, preview, onClose, onChoose }) {
  const [done, setDone] = useState({});
  const primary = preview?.options?.find((o) => o.primary);
  const choose = (o) => {
    /* A re-grade reads stored traces; it doesn't start a run. */
    if (o.id === "regrade") {
      setDone((d) => ({ ...d, regrade: "Re-graded from stored traces — no calls were made." }));
      return;
    }
    onChoose(o);
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 1.5 } }}>
      <Stack direction="row" alignItems="center" sx={{ px: 2.5, pt: 2, pb: 0.5 }}>
        <Typography sx={{ typography: "m2", fontWeight: 600, flex: 1 }}>Before this run</Typography>
        <IconButton size="small" onClick={onClose} aria-label="Close">
          <Iconify icon="mingcute:close-line" width={16} sx={{ color: "text.subtitle" }} />
        </IconButton>
      </Stack>
      <DialogContent sx={{ px: 2.5, pt: 1, pb: 1 }}>
        <ComparabilityPreview preview={preview} onChoose={choose} done={done} />
      </DialogContent>
      <DialogActions sx={{ px: 2.5, pb: 2, pt: 1, gap: 1 }}>
        <Typography sx={{ typography: "s3", color: "text.subtitle", flex: 1 }}>
          {primary?.line}
        </Typography>
        <Button size="small" onClick={onClose} sx={{ typography: "s2", fontWeight: 600, color: "text.secondary" }}>Cancel</Button>
        <Button
          size="small" variant="contained" color="primary"
          onClick={() => primary && onChoose(primary)}
          startIcon={<Iconify icon="solar:play-bold" width={14} />}
          sx={{ typography: "s2", fontWeight: 700 }}
        >
          {primary?.label || "Run"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
ComparabilityPreviewDialog.propTypes = {
  open: PropTypes.bool, preview: PropTypes.object, onClose: PropTypes.func, onChoose: PropTypes.func,
};
