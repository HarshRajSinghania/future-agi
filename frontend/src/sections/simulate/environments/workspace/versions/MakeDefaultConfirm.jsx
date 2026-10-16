import PropTypes from "prop-types";
import { useRef } from "react";
import { Button, Typography } from "@mui/material";
import { ConfirmDialog } from "src/components/custom-dialog";
import { MOVABLE_PIECES } from "src/api/simulate-environments/versions";
import { VERSIONS_COPY } from "../workspace.constants";

const COPY = VERSIONS_COPY.makeDefault;

// Asks before a version becomes the default. Stays open while the move is
// pending, so the user sees it land or fail.
export default function MakeDefaultConfirm({
  piece,
  version,
  pending = false,
  onConfirm,
  onClose,
}) {
  // Keep naming the version while the dialog fades out.
  const shown = useRef(version);
  if (version) shown.current = version;
  const label = shown.current?.label || VERSIONS_COPY.unlabelled;
  return (
    <ConfirmDialog
      open={Boolean(version)}
      onClose={pending ? undefined : onClose}
      closeDisabled={pending}
      title={COPY.title(label, COPY.pieces[piece])}
      content={
        <Typography component="span" sx={{ typography: "s2" }}>
          {COPY.body}
        </Typography>
      }
      action={
        <Button
          size="small"
          variant="contained"
          onClick={onConfirm}
          disabled={pending}
          sx={{ px: 3 }}
        >
          {pending ? COPY.pending : COPY.confirm}
        </Button>
      }
    />
  );
}

MakeDefaultConfirm.propTypes = {
  piece: PropTypes.oneOf(MOVABLE_PIECES).isRequired,
  // The version to make the default; none keeps the dialog closed.
  version: PropTypes.object,
  pending: PropTypes.bool,
  onConfirm: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
