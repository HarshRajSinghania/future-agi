import PropTypes from "prop-types";
import { Box } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";

/*
  The persona drawers' type scale, one step down from the page defaults.

  The persona forms were built for a full page — 18px title, 16px sections,
  15px sub-headings, 14px body and inputs. Opened as a side drawer over the
  environment screens (14px rows, 12px chips) they read a size too large next
  to the page they sit on. Rather than restyle a dozen shared form components,
  the drawer remaps the variants they already use, so the same form keeps its
  page sizing wherever else it's mounted.
*/
const STEP_DOWN = {
  m2: { fontSize: "1rem", lineHeight: "24px" }, //          18 → 16  drawer title
  m3: { fontSize: "0.875rem", lineHeight: "22px" }, //      16 → 14  section titles
  s1_2: { fontSize: "0.8125rem", lineHeight: "20px" }, //   15 → 13  sub-headings
  s1: { fontSize: "0.75rem", lineHeight: "18px" }, //       14 → 12  body, chips, hints
  body1: { fontSize: "0.8125rem", lineHeight: "20px" }, //  16 → 13  default text
};

const compact = (outer) => ({
  ...outer,
  typography: Object.fromEntries(
    Object.entries(outer.typography).map(([k, v]) => [k, STEP_DOWN[k] ? { ...v, ...STEP_DOWN[k] } : v]),
  ),
});

export default function PersonaDrawerScale({ children }) {
  return (
    <ThemeProvider theme={compact}>
      <Box
        sx={{
          height: "100%",
          /* Inputs, links and the radio chips set their size outside the
             variants, so they're matched here. */
          "& .MuiInputBase-input": { fontSize: 13 },
          /* The outline's notch is sized from the input's font; keep it as
             wide as the floating label (12px) so the border doesn't cut it. */
          "& .MuiOutlinedInput-notchedOutline legend": { fontSize: 12 },
          "& .MuiLink-root": { fontSize: 13 },
          "& .MuiFormControlLabel-label, & .MuiFormControlLabel-label *": { fontSize: "12px !important" },
        }}
      >
        {children}
      </Box>
    </ThemeProvider>
  );
}

PersonaDrawerScale.propTypes = { children: PropTypes.node };
