import { endpoints, readQuery } from "src/utils/axios";

// What Instant eval and Analyse run over: the rows a Traces, Sessions or
// Users view is showing. Each unit is read through the same list endpoint and
// filters as its grid, newest first, so "these traces" means exactly the rows
// on screen.

export const UNITS = {
  traces: {
    key: "traces",
    noun: "trace",
    plural: "traces",
    title: "Traces",
    tab: "llm-tracing",
  },
  sessions: {
    key: "sessions",
    noun: "session",
    plural: "sessions",
    title: "Sessions",
    tab: "sessions",
  },
  users: {
    key: "users",
    noun: "user",
    plural: "users",
    title: "Users",
    tab: "users",
  },
};

export const unitWord = (unit, count) => {
  const meta = UNITS[unit] || UNITS.traces;
  return count === 1 ? meta.noun : meta.plural;
};

const PAGE_SIZE = 500;
export const MAX_POPULATION = 2000;

const SOURCES = {
  traces: {
    endpoint: () => endpoints.project.getTracesForObserveProject(),
    params: ({ projectId, filters, page, pageSize }) => ({
      project_id: projectId,
      page_number: page,
      page_size: pageSize,
      filters: JSON.stringify(filters || []),
    }),
    item: (row) => ({
      id: row.trace_id,
      time: row.start_time || row.created_at || "",
      user_id: row.user_id || "",
    }),
    total: (result) => ({
      total: result?.metadata?.total_rows,
      lowerBound: !!result?.metadata?.total_rows_is_lower_bound,
    }),
  },
  sessions: {
    endpoint: () => endpoints.project.projectSessionList(),
    params: ({ projectId, filters, page, pageSize }) => ({
      project_id: projectId,
      page_number: page,
      page_size: pageSize,
      filters: JSON.stringify(filters || []),
    }),
    item: (row) => ({
      id: row.session_id,
      time: row.start_time || row.created_at || "",
      user_id: row.user_id || "",
    }),
    total: (result) => ({
      total: result?.metadata?.total_rows,
      lowerBound: !!result?.metadata?.total_rows_is_lower_bound,
    }),
  },
  users: {
    endpoint: () => endpoints.project.getUsersList(),
    params: ({ projectId, filters, page, pageSize }) => ({
      project_id: projectId,
      current_page_index: page,
      page_size: pageSize,
      filters: JSON.stringify(filters || []),
      sort_params: "[]",
    }),
    item: (row) => ({
      id: row.end_user_id,
      time: row.last_active || row.activated_at || "",
      user_id: row.user_id || "",
    }),
    total: (result) => ({ total: result?.total_count, lowerBound: false }),
  },
};

/**
 * Collect up to `limit` rows of a view: [{id, time, user_id}] plus the view's
 * total. `filters` are the backend filters the view's grid sends.
 */
export async function collectPopulation({
  unit,
  projectId,
  filters = [],
  limit = MAX_POPULATION,
  signal,
}) {
  const source = SOURCES[unit];
  if (!source) throw new Error(`Unknown unit ${unit}`);
  const items = [];
  const seen = new Set();
  let total;
  let lowerBound = false;
  for (let page = 0; items.length < limit; page += 1) {
    const pageSize = Math.min(PAGE_SIZE, limit - items.length);
    // eslint-disable-next-line no-await-in-loop
    const response = await readQuery(source.endpoint(), {
      params: source.params({ projectId, filters, page, pageSize }),
      signal,
    });
    const result = response?.data?.result || {};
    if (page === 0) ({ total, lowerBound } = source.total(result));
    const rows = result.table || [];
    rows.forEach((row) => {
      const item = source.item(row);
      if (item.id && !seen.has(item.id)) {
        seen.add(item.id);
        items.push(item);
      }
    });
    if (rows.length < pageSize) break;
  }
  const count = Number.isFinite(total) ? Math.max(total, items.length) : items.length;
  return {
    items,
    total: count,
    totalIsLowerBound: lowerBound,
    truncated: count > items.length,
  };
}
