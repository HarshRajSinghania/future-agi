import PropTypes from "prop-types";
import { useEffect, useState } from "react";
import {
  Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Tooltip, Typography,
} from "@mui/material";
import Iconify from "src/components/iconify";

const num = { fontVariantNumeric: "tabular-nums" };

/*
  How much of the set improvements can't break, and why — one quiet line over
  the batches. Most of a large set is protected because it passes today;
  marking is for what must never break.
*/
export function ProtectionLine({ tally }) {
  if (!tally?.total) return null;
  const held = tally.marked + tally.memory + tally.anchor + tally.passing;
  const parts = [
    tally.marked && `${tally.marked} must-pass`,
    tally.memory && `${tally.memory} regression memory`,
    tally.anchor && `${tally.anchor} anchor core`,
    tally.passing && `${tally.passing} pass every repeat${tally.latestName ? ` in ${tally.latestName}` : " today"}`,
  ].filter(Boolean);
  return (
    <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" rowGap={0.25} sx={{ px: 0.25, mb: 1.25 }}>
      <Iconify icon="solar:shield-check-linear" width={15} sx={{ color: "text.subtitle", flexShrink: 0 }} />
      <Typography sx={{ typography: "s2", color: "text.secondary", ...num }}>
        <Box component="span" sx={{ color: "text.primary", fontWeight: 600 }}>{`Improvements can't break ${held} of ${tally.total}`}</Box>
        {parts.length > 0 && ` — ${parts.join(" · ")}`}
      </Typography>
      {tally.open > 0 && (
        <Tooltip arrow title="They failed or passed only some repeats in the latest run, or haven't run yet, so an improvement may change how they do. Mark the ones that must never break as must-pass.">
          <Typography sx={{ typography: "s2", color: "text.subtitle", cursor: "help", borderBottom: "1px dotted", borderColor: "text.disabled", ...num }}>
            {`${tally.open} not protected`}
          </Typography>
        </Tooltip>
      )}
    </Stack>
  );
}
ProtectionLine.propTypes = { tally: PropTypes.object };

/*
  Goals worth making must-pass — rule and pressure goals that are only partly
  must-pass. Checked by default; "Not now" stops asking about the ones listed.
*/
export function MustPassSuggestDialog({ open, goals, onClose, onApply, onDismiss }) {
  const [picked, setPicked] = useState(() => new Set(goals.map((g) => g.key)));
  useEffect(() => { if (open) setPicked(new Set(goals.map((g) => g.key))); }, [open, goals]);
  const toggle = (key) => setPicked((p) => { const n = new Set(p); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const count = picked.size;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ typography: "m2", fontWeight: 600, pb: 0.5 }}>Make these goals must-pass?</DialogTitle>
      <DialogContent>
        <Typography sx={{ typography: "s2", color: "text.secondary", mb: 1.5 }}>
          Each tests a rule or holds up under pressure, and only some of its scenarios are must-pass. A must-pass goal covers every scenario in it, including ones added later. An improvement that breaks any of them is rejected.
        </Typography>
        <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, "& > * + *": { borderTop: "1px solid", borderColor: "divider" } }}>
          {goals.map((g) => (
            <Stack
              key={g.key} direction="row" alignItems="center" spacing={1}
              onClick={() => toggle(g.key)}
              sx={{ px: 1, py: 0.75, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
            >
              <Checkbox size="small" checked={picked.has(g.key)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(g.key)} />
              <Typography sx={{ typography: "s2", fontWeight: 600, flex: 1, minWidth: 0 }}>{g.label}</Typography>
              <Typography sx={{ typography: "s3", color: "text.subtitle", flexShrink: 0, whiteSpace: "nowrap", ...num }}>
                {`${g.marked} of ${g.rows.length} must-pass`}
              </Typography>
            </Stack>
          ))}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={() => onDismiss(goals.map((g) => g.key))} sx={{ typography: "s2", fontWeight: 600, color: "text.secondary", mr: "auto" }}>
          Not now
        </Button>
        <Button onClick={onClose} sx={{ typography: "s2", fontWeight: 600, color: "text.secondary" }}>Cancel</Button>
        <Button
          variant="contained" color="primary" disabled={!count}
          onClick={() => onApply([...picked])}
          sx={{ typography: "s2", fontWeight: 700 }}
        >
          {count ? `Make ${count} goal${count === 1 ? "" : "s"} must-pass` : "Make must-pass"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
MustPassSuggestDialog.propTypes = {
  open: PropTypes.bool, goals: PropTypes.array.isRequired, onClose: PropTypes.func.isRequired,
  onApply: PropTypes.func.isRequired, onDismiss: PropTypes.func.isRequired,
};
