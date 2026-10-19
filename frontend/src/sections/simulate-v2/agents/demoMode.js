/*
  Controls that only exist to stage states the product reaches on its own
  (a revoked key, an outside edit, a push) are hidden unless the page URL
  carries `?demo=1`. Read from the URL, so it survives tab switches on the
  same page and never shows in a shared link without it.
*/
import { useLocation } from "react-router-dom";

const on = (search) => new URLSearchParams(search || "").get("demo") === "1";

/** True when the URL carries ?demo=1. */
export const isDemoMode = () => (typeof window !== "undefined" ? on(window.location.search) : false);

/** The same, re-read on navigation. */
export const useDemoMode = () => on(useLocation().search);
