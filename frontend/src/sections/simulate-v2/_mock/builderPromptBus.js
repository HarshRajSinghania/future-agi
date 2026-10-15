/**
 * Tiny pub/sub for builder-prompt suggestions.
 *
 * The Edit-scenario drawer lives several components away from the
 * workspace chat panel, so we skip prop-drilling and let any surface
 * emit here — the workspace subscribes on mount and appends every
 * emit as a user message in the chat.
 */

const listeners = new Set();

export function subscribeBuilderPrompt(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function emitBuilderPrompt(text) {
  const clean = (text || "").trim();
  if (!clean) return;
  listeners.forEach((fn) => {
    try { fn(clean); } catch { /* no-op */ }
  });
}

/*
  Open the builder chat without sending anything — a scenario's "From chat"
  badge leads back to the chat that wrote it. The workspace folds the chat
  to a rail; this unfolds it.
*/
const openListeners = new Set();

export function subscribeOpenBuilderChat(fn) {
  openListeners.add(fn);
  return () => { openListeners.delete(fn); };
}

export function openBuilderChat() {
  openListeners.forEach((fn) => {
    try { fn(); } catch { /* no-op */ }
  });
}
