/*
  What each tool argument is and allows — one spec for both places that show
  it: the handler code on World → Tools (`envInternals.toolImplFor`) and the
  argument list and limits on the Contract tab (`rlContract.toolArgsOf`).
  By tool and argument where it differs, else by argument name.
*/
const ARG_SPEC = {
  order_id: { type: "str", format: "A-#####" },
  amount: { type: "float", min: 0, max: "order total", unit: "£" },
  amount_cents: { type: "int", min: 0, max: "order total", unit: "pence" },
  caller_confirmed: { type: "bool", values: ["true"], note: "must be true" },
  reason: { type: "enum", values: ["damaged", "late", "not_as_described", "changed_mind"] },
  priority: { type: "enum", values: ["normal", "urgent"] },
  factors: { type: "enum", values: ["dob", "card_last4", "otp", "postcode"], note: "one or more" },
  kind: { type: "enum", values: ["meal", "hotel"] },
  phone: { type: "str", format: "E.164 number" },
  postcode: { type: "str", format: "postcode" },
  code: { type: "str", format: "6 digits" },
  email: { type: "str", format: "email address" },
  since: { type: "date" },
  when: { type: "date" },
  new_address: { type: "object" },
  action: { type: "object" },
};
const TOOL_ARG_SPEC = {
  "escalate_to_human.reason": { type: "enum", values: ["refund_over_limit", "dispute", "vulnerable_caller", "caller_request"] },
  "raise_dispute.reason": { type: "enum", values: ["unrecognised", "duplicate", "not_received"] },
  "apply_goodwill_credit.amount": { type: "float", min: 0, max: 25, unit: "£", note: "per call — the rules cap goodwill credit" },
  "issue_voucher.amount_cents": { type: "int", min: 0, max: 15000, unit: "pence" },
};

/** The spec for one argument of one tool — `{}` when nothing is known beyond its name. */
export const argSpecOf = (tool, name) => ({ ...ARG_SPEC[name], ...TOOL_ARG_SPEC[`${tool}.${name}`] });

/* The Python type a handler declares for an argument of that spec. */
const PY_OF = { str: "str", int: "int", float: "float", bool: "bool", enum: "str", date: "str", object: "dict" };
export const pyTypeOf = (tool, name) => PY_OF[argSpecOf(tool, name).type] || "str";
