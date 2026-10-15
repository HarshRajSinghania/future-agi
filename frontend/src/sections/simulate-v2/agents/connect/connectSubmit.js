import { createContext, useContext } from "react";

/*
  What a connect flow's final button says. "Connect agent" on its own; when
  the agent is being connected for a new environment, the environment starts
  building as soon as it's connected, so the button says that.
*/
export const CONNECT_LABEL = "Connect agent";
export const ConnectSubmitContext = createContext(CONNECT_LABEL);
export const useConnectSubmitLabel = () => useContext(ConnectSubmitContext) || CONNECT_LABEL;
