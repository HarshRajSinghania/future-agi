// A generic cast per vertical for the prebuilt templates, in the shape a built
// environment's cast takes. Only channels the template's surface can deliver
// are kept, so a surface the harness does not reach gets no cast.
const SURFACES_BY_CHANNEL = {
  audio_mix: ["voice"],
  transfer_leg: ["voice"],
  ivr: ["voice"],
  tool_response: ["voice", "chat", "browser"],
  thread_message: ["chat"],
  inbound_message: ["voice", "chat"],
};

const CASTS_BY_DOMAIN = {
  ecommerce: [
    { id: "phone_menu", name: "Phone menu", role: "An automated menu that answers and routes the call first", channel: "ivr" },
    { id: "household_member", name: "Household member", role: "Someone beside the caller who chimes in with order details", channel: "audio_mix" },
    { id: "supervisor", name: "Supervisor", role: "Answers when the agent transfers the call", channel: "transfer_leg" },
    { id: "carrier_service", name: "Carrier tracking service", role: "Tracking lookups that time out or come back late", channel: "tool_response" },
  ],
  fintech: [
    { id: "joint_holder", name: "Joint account holder", role: "A second account holder who joins the conversation", channel: "thread_message" },
    { id: "payments_service", name: "Payments service", role: "Payment calls that fail or are rate limited", channel: "tool_response" },
    { id: "fraud_alert", name: "Fraud alert", role: "An alert raised on the account during the conversation", channel: "inbound_message" },
  ],
  travel: [
    { id: "travel_companion", name: "Travel companion", role: "A fellow traveller who joins the conversation", channel: "thread_message" },
    { id: "inventory_service", name: "Booking inventory service", role: "Availability calls that fail or return stale fares", channel: "tool_response" },
    { id: "schedule_change", name: "Schedule change", role: "A change to a booked trip that arrives mid-conversation", channel: "inbound_message" },
  ],
  software: [
    { id: "backend_service", name: "Backend service", role: "Requests behind the app that fail or respond slowly", channel: "tool_response" },
  ],
};

export const castForTemplate = ({ domain, surface }) => {
  const subActors = (CASTS_BY_DOMAIN[domain] || []).filter((one) =>
    SURFACES_BY_CHANNEL[one.channel].includes(surface),
  );
  return subActors.length ? { subActors } : undefined;
};
