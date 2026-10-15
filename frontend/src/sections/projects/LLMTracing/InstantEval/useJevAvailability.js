import { CAPABILITY, useFeatureAllowed } from "src/hooks/useCapabilities";

// Single place that decides whether Jev can answer questions in this
// workspace, so the access model can change without touching the screens.
export function useJevAvailability() {
  const { allowed, isLoading } = useFeatureAllowed(CAPABILITY.JEV_MODELS);
  return {
    available: allowed,
    isLoading,
    reason: allowed
      ? null
      : "Jev isn't available in this workspace yet. Ask your Future AGI admin to set it up.",
  };
}
