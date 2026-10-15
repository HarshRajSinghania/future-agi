/* Shared looks for the Environments landing, the prebuilt-worlds page and the
   New environment journey. Kept in a .js so the .jsx files export components only. */
import { alpha } from "@mui/material/styles";

export const PANEL_SX = {
  border: "1px solid", borderColor: "divider", borderRadius: 1.5, bgcolor: "background.paper",
};
export const OUTLINE_BTN = { typography: "s2", fontWeight: 700, color: "text.primary", borderColor: "divider", whiteSpace: "nowrap" };
export const focusRing = (t) => ({ outline: `2px solid ${alpha(t.palette.text.primary, 0.5)}`, outlineOffset: 2 });

