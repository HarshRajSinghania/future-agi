import { formatDate } from "src/utils/report-utils";
import { OBSERVE_LINK_FILTER_PARAM } from "src/sections/projects/LLMTracing/common";
import { buildAnswerFilter } from "src/sections/projects/LLMTracing/InstantEval/useInstantEval";

export const SCOPE_PARAM = "scope";

export const DATE_PRESETS = [
  { value: "24h", label: "Past 24 hours", hours: 24 },
  { value: "7d", label: "Past 7 days", hours: 24 * 7 },
  { value: "30d", label: "Past 30 days", hours: 24 * 30 },
];

export const dateItem = (start, end) => ({
  column_id: "created_at",
  filter_config: {
    filter_type: "datetime",
    filter_op: "between",
    filter_value: [new Date(start).toISOString(), new Date(end).toISOString()],
  },
});

export const isDateItem = (item) =>
  item?.column_id === "created_at" &&
  item?.filter_config?.filter_op === "between";

export const presetScope = (preset, otherFilters = [], now = new Date()) => {
  const option =
    DATE_PRESETS.find((entry) => entry.value === preset) || DATE_PRESETS[1];
  const start = new Date(now.getTime() - option.hours * 3600 * 1000);
  return {
    filters: [...otherFilters, dateItem(start, now)],
    label: option.label,
    preset: option.value,
  };
};

// The Trace view hands its exact scope over in the URL; without one, Analyse
// looks at the past seven days of the project.
export function readScope(search) {
  try {
    const raw = new URLSearchParams(search).get(SCOPE_PARAM);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.filters))
        return {
          filters: parsed.filters,
          label: parsed.label || "From the Trace view",
          preset: "trace",
        };
    }
  } catch {
    // A hand-edited link falls back to the default scope.
  }
  return presetScope("7d");
}

export const scopeWindow = (filters = []) =>
  filters.find(isDateItem)?.filter_config?.filter_value;

const OP_LABEL = {
  equals: "is",
  not_equals: "is not",
  in: "is one of",
  not_in: "is not one of",
  contains: "contains",
  not_contains: "does not contain",
  greater_than: ">",
  less_than: "<",
  between: "between",
};

export function describeFilter(item) {
  const config = item?.filter_config || {};
  // Answer filters lead with the answer; the question can be long.
  if (config.col_type === "EVAL_METRIC")
    return `${[].concat(config.filter_value ?? []).join(" or ")} · ${item.display_name || "answer"}`;
  const value = Array.isArray(config.filter_value)
    ? config.filter_value.join(", ")
    : `${config.filter_value ?? ""}`;
  const field = item?.display_name || item?.column_id || "filter";
  return `${field} ${OP_LABEL[config.filter_op] || config.filter_op || ""} ${value}`.trim();
}

// Deep link into the Trace view: the window becomes its date filter and every
// other scope filter, plus the answer filter, arrives as visible chips.
export function traceViewLink({
  projectId,
  scopeFilters,
  window,
  item,
  labels,
}) {
  const params = new URLSearchParams({ tab: "traces", selectedTab: "trace" });
  const range = window || scopeWindow(scopeFilters);
  if (range?.length === 2) {
    params.set(
      "primaryTraceDateFilter",
      JSON.stringify({
        dateFilter: [
          formatDate(new Date(range[0])),
          formatDate(new Date(range[1])),
        ],
        dateOption: "Custom",
      }),
    );
  }
  const rows = [
    ...(scopeFilters || []).filter((filter) => !isDateItem(filter)),
    ...(item && labels?.length ? [buildAnswerFilter(item, labels)] : []),
  ];
  if (rows.length) params.set(OBSERVE_LINK_FILTER_PARAM, JSON.stringify(rows));
  return `/dashboard/observe/${projectId}/llm-tracing?${params.toString()}`;
}

export const tracePageLink = (projectId, traceId) =>
  `/dashboard/observe/${projectId}/trace/${traceId}`;
