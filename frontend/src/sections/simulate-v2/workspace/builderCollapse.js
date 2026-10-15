/* Whether the builder pane is folded to its rail — remembered per browser,
   shared by the environment page and the build screen. A viewer
   convenience, not shared state. */
const BUILDER_COLLAPSED_KEY = "fagi.simulate.builderCollapsed";

export const readBuilderCollapsed = () => {
  try { return window.localStorage.getItem(BUILDER_COLLAPSED_KEY) === "1"; } catch { return false; }
};

export const writeBuilderCollapsed = (v) => {
  try { window.localStorage.setItem(BUILDER_COLLAPSED_KEY, v ? "1" : "0"); } catch { /* storage unavailable */ }
};
