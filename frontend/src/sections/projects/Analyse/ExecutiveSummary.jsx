import React from "react";
import PropTypes from "prop-types";
import { Box, Button, Paper, Stack, Tooltip, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { CitationChip, CitedText, SectionCard, Swatch } from "./parts";

export function CategoryLink({ category, color, onClick }) {
  if (!category) return null;
  return (
    <Tooltip
      describeChild
      arrow
      title={category.description || ""}
      enterDelay={400}
    >
      <Box
        component="button"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClick(category.id);
        }}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.75,
          maxWidth: 320,
          height: 22,
          px: 0.75,
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 0.75,
          bgcolor: "background.paper",
          color: "text.primary",
          font: "inherit",
          fontSize: 12,
          cursor: "pointer",
          "&:hover": { borderColor: "text.disabled" },
          "&:focus-visible": {
            outline: "2px solid",
            outlineColor: "primary.main",
            outlineOffset: 1,
          },
        }}
      >
        <Swatch color={color} size={8} />
        <Box
          component="span"
          sx={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {category.name}
        </Box>
      </Box>
    </Tooltip>
  );
}

CategoryLink.propTypes = {
  category: PropTypes.object,
  color: PropTypes.string,
  onClick: PropTypes.func.isRequired,
};

export default function ExecutiveSummary({
  summary,
  refIndex,
  categoriesById,
  colorOf,
  onCite,
  onCategory,
}) {
  if (!summary || summary.error) {
    return (
      <SectionCard title="Executive summary">
        <Typography variant="body2" color="text.secondary">
          Summary unavailable for this run. The categories and statistics below
          are complete.
        </Typography>
      </SectionCard>
    );
  }
  const points = summary.key_points || [];
  const dropped = summary.dropped_points || 0;
  return (
    <SectionCard
      title={summary.title || "Executive summary"}
      subtitle={summary.title ? "Executive summary" : undefined}
    >
      {points.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          The summary found nothing it could state with numbers from this run.
          The categories below are complete.
        </Typography>
      ) : (
        <Stack
          component="ol"
          spacing={1.75}
          sx={{ m: 0, pl: 0, listStyle: "none" }}
        >
          {points.map((point, index) => (
            <Stack key={index} component="li" direction="row" spacing={1.5}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  width: 16,
                  flexShrink: 0,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {index + 1}.
              </Typography>
              <Box sx={{ minWidth: 0 }}>
                <CitedText
                  text={point.text}
                  refIndex={refIndex}
                  onCite={onCite}
                  sx={{ lineHeight: 1.65 }}
                />
                {point.category_ids?.length > 0 && (
                  <Stack
                    direction="row"
                    spacing={0.75}
                    useFlexGap
                    flexWrap="wrap"
                    sx={{ mt: 0.75 }}
                  >
                    {point.category_ids.map((id) => (
                      <CategoryLink
                        key={id}
                        category={categoriesById.get(id)}
                        color={colorOf(id)}
                        onClick={onCategory}
                      />
                    ))}
                  </Stack>
                )}
              </Box>
            </Stack>
          ))}
        </Stack>
      )}
      <Stack
        direction="row"
        spacing={0.75}
        alignItems="center"
        sx={{ mt: 2, color: "text.secondary" }}
      >
        <Iconify icon="mdi:check-decagram-outline" width={14} />
        <Typography variant="caption">
          Every number here was checked against this report&apos;s statistics
          {dropped > 0
            ? `; ${dropped} point${dropped === 1 ? "" : "s"} that did not check out ${dropped === 1 ? "was" : "were"} left out.`
            : "."}{" "}
          #n opens the example it cites.
        </Typography>
      </Stack>
    </SectionCard>
  );
}

ExecutiveSummary.propTypes = {
  summary: PropTypes.object,
  refIndex: PropTypes.instanceOf(Map).isRequired,
  categoriesById: PropTypes.instanceOf(Map).isRequired,
  colorOf: PropTypes.func.isRequired,
  onCite: PropTypes.func.isRequired,
  onCategory: PropTypes.func.isRequired,
};

export function Highlights({
  highlights,
  categoriesById,
  colorOf,
  onCite,
  onCategory,
}) {
  if (!highlights?.length) return null;
  return (
    <SectionCard
      title="Highlights"
      subtitle="Examples the summary points to, and why each matters."
    >
      <Box
        sx={{
          display: "grid",
          gap: 1.5,
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
        }}
      >
        {highlights.map((highlight) => {
          const category = categoriesById.get(highlight.category_id) || {
            id: highlight.category_id,
            name: highlight.category_name,
          };
          return (
            <Paper
              key={`${highlight.ref}-${highlight.unit_id}`}
              variant="outlined"
              sx={{
                p: 1.75,
                borderRadius: 1.5,
                display: "flex",
                flexDirection: "column",
                gap: 1,
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <CitationChip n={highlight.ref} onClick={onCite} />
                <CategoryLink
                  category={category}
                  color={colorOf(category.id)}
                  onClick={onCategory}
                />
              </Stack>
              <Typography
                variant="body2"
                sx={{
                  display: "-webkit-box",
                  WebkitLineClamp: 4,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {highlight.summary}
              </Typography>
              {highlight.reason && (
                <Typography variant="body2" color="text.secondary">
                  <Box
                    component="span"
                    sx={{ fontWeight: 600, color: "text.primary" }}
                  >
                    Why it matters:{" "}
                  </Box>
                  {highlight.reason}
                </Typography>
              )}
              <Stack direction="row" spacing={1} sx={{ mt: "auto", pt: 0.5 }}>
                <Button
                  size="small"
                  color="inherit"
                  onClick={() => onCategory(category.id)}
                >
                  View category
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="inherit"
                  onClick={() => onCite(highlight.ref, highlight.unit_id)}
                >
                  Open example
                </Button>
              </Stack>
            </Paper>
          );
        })}
      </Box>
    </SectionCard>
  );
}

Highlights.propTypes = {
  highlights: PropTypes.array,
  categoriesById: PropTypes.instanceOf(Map).isRequired,
  colorOf: PropTypes.func.isRequired,
  onCite: PropTypes.func.isRequired,
  onCategory: PropTypes.func.isRequired,
};
