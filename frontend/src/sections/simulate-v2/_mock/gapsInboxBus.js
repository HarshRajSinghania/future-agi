/**
 * Open the "Needs your input" drawer from anywhere in the workspace.
 *
 * The drawer belongs to the workspace header; the Overview tab's inline
 * blocking list links into it. Module-level, like builderPromptBus, so the
 * two don't need a prop threaded through every panel. An optional gap id
 * scrolls that card into view.
 */
const listeners = new Set();

export const openGapsInbox = (gapId = null) => {
  listeners.forEach((fn) => fn(gapId));
};

export const subscribeGapsInbox = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
