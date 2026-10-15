import { useState } from "react";
import { currentAgentVersion } from "../_mock/versions";
import { toolFit } from "../_mock/toolFit";
import RunFitDialog from "./RunFitDialog";

/**
 * Wrap any "start a run" action with the tool-fit check.
 *
 *   const { check, dialog } = useRunFitCheck(env, envState, patch);
 *   <Button onClick={() => check(() => startRun())}>Run</Button>
 *   {dialog}
 *
 * If the agent version fits the pinned environment version the run starts at
 * once; otherwise the dialog asks first, on the screen the user is already on.
 * `locked` (a template preview) leaves out the fixes that change the world.
 */
export default function useRunFitCheck(env, envState, patch, { locked = false } = {}) {
  const [pending, setPending] = useState(null);

  const check = (run, { agent } = {}) => {
    const label = agent || currentAgentVersion(envState)?.label;
    if (!env || toolFit(env, envState, { agent: label }).fits) {
      run();
      return;
    }
    setPending({ run, agent: label });
  };

  const dialog = (
    <RunFitDialog
      open={!!pending}
      onClose={() => setPending(null)}
      env={env}
      envState={envState}
      patch={patch}
      agent={pending?.agent}
      locked={locked}
      onRun={() => pending?.run()}
    />
  );

  return { check, dialog };
}
