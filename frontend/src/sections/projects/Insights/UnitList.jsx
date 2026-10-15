import React from "react";
import PropTypes from "prop-types";
import { Box, IconButton, Skeleton, Stack, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { formatCount, formatWhen } from "./insightsFormat";
import { AttributePills, ErrorState, FacetChips } from "./parts";

export function UnitRow({ unit, onOpen }) {
  const open = () => onOpen(unit);
  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
      sx={{
        px: 1.5,
        py: 1.25,
        borderRadius: 1,
        cursor: "pointer",
        border: "1px solid",
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        gap: 0.75,
        "&:hover": { bgcolor: "action.hover" },
        "&:focus-visible": {
          outline: "2px solid",
          outlineColor: "primary.main",
          outlineOffset: 1,
        },
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="caption" color="text.secondary" noWrap>
          {[formatWhen(unit.time), unit.user_id].filter(Boolean).join(" · ")}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Iconify
          icon="mdi:chevron-right"
          width={16}
          sx={{ color: "text.disabled" }}
        />
      </Stack>
      {unit.label && (
        <Typography variant="subtitle2" noWrap title={unit.label}>
          {unit.label}
        </Typography>
      )}
      {unit.summary && (
        <Typography
          variant="body2"
          sx={{
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {unit.summary}
        </Typography>
      )}
      {unit.lens_answer && unit.lens_answer !== unit.summary && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          <Box component="span" sx={{ fontWeight: 600 }}>
            Answer:{" "}
          </Box>
          {unit.lens_answer}
        </Typography>
      )}
      <FacetChips facets={unit.facets} dense />
      <AttributePills attributes={unit.facets?.attributes} />
    </Box>
  );
}

UnitRow.propTypes = {
  unit: PropTypes.object.isRequired,
  onOpen: PropTypes.func.isRequired,
};

/** A page of analysed units with a pager: "1–50 of 128 ‹ ›". */
export default function UnitList({
  query,
  offset,
  pageSize,
  onOffset,
  onOpen,
  emptyText,
}) {
  const total = query.data?.total || 0;
  const units = query.data?.units || [];
  if (query.isLoading)
    return (
      <Stack spacing={1}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} variant="rounded" height={112} />
        ))}
      </Stack>
    );
  if (query.isError)
    return (
      <ErrorState
        message="The examples could not be loaded."
        onRetry={() => query.refetch()}
      />
    );
  if (!units.length)
    return (
      <Typography variant="body2" color="text.secondary">
        {emptyText}
      </Typography>
    );
  const last = Math.min(total, offset + units.length);
  return (
    <Stack spacing={1}>
      <Stack spacing={1} sx={{ opacity: query.isPlaceholderData ? 0.6 : 1 }}>
        {units.map((unit) => (
          <UnitRow key={unit.unit_id} unit={unit} onOpen={onOpen} />
        ))}
      </Stack>
      {total > pageSize && (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="flex-end"
          spacing={0.5}
        >
          <Typography variant="caption" color="text.secondary">
            {formatCount(offset + 1)}–{formatCount(last)} of{" "}
            {formatCount(total)}
          </Typography>
          <IconButton
            size="small"
            aria-label="Previous examples"
            disabled={offset === 0}
            onClick={() => onOffset(Math.max(0, offset - pageSize))}
          >
            <Iconify icon="mdi:chevron-left" width={18} />
          </IconButton>
          <IconButton
            size="small"
            aria-label="Next examples"
            disabled={last >= total}
            onClick={() => onOffset(offset + pageSize)}
          >
            <Iconify icon="mdi:chevron-right" width={18} />
          </IconButton>
        </Stack>
      )}
    </Stack>
  );
}

UnitList.propTypes = {
  query: PropTypes.object.isRequired,
  offset: PropTypes.number.isRequired,
  pageSize: PropTypes.number.isRequired,
  onOffset: PropTypes.func.isRequired,
  onOpen: PropTypes.func.isRequired,
  emptyText: PropTypes.string,
};
