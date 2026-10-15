/*
  A ToggleButtonGroup styled as the product's segmented control — the same
  look as SegmentedTabs (src/components/tabs/tabs.jsx) on Evals' Single /
  Composite: a bordered grey track, the selected option a filled neutral pill.
  No brand colour: choosing an option isn't a highlight.
*/
export const segmentedToggleSx = (theme) => {
  const dark = theme.palette.mode === "dark";
  return {
    p: "2px",
    gap: 0,
    border: "1px solid",
    borderColor: "divider",
    borderRadius: "8px",
    bgcolor: dark ? "rgba(255,255,255,0.04)" : "#f4f4f5",
    "& .MuiToggleButtonGroup-grouped, & .MuiToggleButton-root": {
      m: 0,
      border: "0 !important",
      borderRadius: "6px !important",
      px: 1.5,
      py: 0,
      minHeight: 28,
      gap: 0.5,
      textTransform: "none",
      fontSize: 13,
      fontWeight: 500,
      color: "text.secondary",
      "&:hover": { bgcolor: "transparent", color: "text.primary" },
      "&.Mui-selected, &.Mui-selected:hover": {
        fontWeight: 600,
        color: "text.primary",
        bgcolor: dark ? "rgba(255,255,255,0.12)" : "#fff",
        boxShadow: dark ? "none" : "0 1px 3px rgba(0,0,0,0.08)",
      },
      "&.Mui-disabled": { color: "text.disabled" },
    },
  };
};
