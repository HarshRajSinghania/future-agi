"""Everything the Ask page draws for an Instant eval run, aggregated in SQL.

The run's rows and their facets live in ``tracer_instant_eval_row``; each
row's answer to each question is its live ``EvalLogger`` entry (one per row,
question and task). ``summary`` joins the two once and groups the result by
time bucket, user, model, turns and error in one statement, so a run of
100,000 rows costs the same few queries as a run of 100. Python only reshapes
the grouped counts: hours into the viewer's timeline bins, days and weekdays.

``rows_page`` and ``iter_export`` read the rows themselves, filtered the way
the charts select them (an answer, a time range, a group).
"""

from __future__ import annotations

import base64
import json
import re
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.core.cache import cache
from django.db import connection, transaction
from django.utils import timezone

ERROR = "__error__"
SKIPPED = "__skipped__"
PENDING = "__pending__"
FAILED_LABELS = (ERROR, SKIPPED)
UNSURE_BELOW = 0.6
MAX_BINS = 120
TOP_USERS = 50
RATE_WINDOW_S = 120

# Timeline bin sizes, smallest first; the first one that fits MAX_BINS wins.
_MIN = 60_000
_HOUR = 60 * _MIN
_DAY = 24 * _HOUR
BIN_LADDER = (
    _MIN,
    5 * _MIN,
    15 * _MIN,
    30 * _MIN,
    _HOUR,
    3 * _HOUR,
    6 * _HOUR,
    12 * _HOUR,
    _DAY,
    7 * _DAY,
)

# The EvalLogger column that names a row, as text, per row type.
RID = {
    "traces": "l.trace_id::text",
    "sessions": "l.trace_session_id::text",
    "spans": "l.observation_span_id",
}

# One label per entry: the answer, or what kept it from having one.
LABEL = f"""CASE
  WHEN l.status IN ('pending', 'running') THEN '{PENDING}'
  WHEN l.error THEN '{ERROR}'
  WHEN COALESCE(l.skipped_reason, '') <> '' THEN '{SKIPPED}'
  WHEN jsonb_typeof(l.output_str_list) = 'array'
       AND jsonb_array_length(l.output_str_list) > 0 THEN l.output_str_list->>0
  WHEN substring(l.output_str from '"choice"\\s*:\\s*"([^"]*)"') IS NOT NULL
       THEN substring(l.output_str from '"choice"\\s*:\\s*"([^"]*)"')
  WHEN COALESCE(l.output_str, '') <> '' AND left(ltrim(l.output_str), 1) <> '{{'
       THEN l.output_str
  ELSE '{ERROR}' END"""

CONFIDENCE = """CASE WHEN jsonb_typeof(l.output_metadata->'jev'->'confidence') = 'number'
  THEN (l.output_metadata->'jev'->>'confidence')::float END"""

TURN_BUCKET = """CASE WHEN turns IS NULL THEN NULL WHEN turns <= 1 THEN '1'
  WHEN turns <= 3 THEN '2-3' WHEN turns <= 6 THEN '4-6' ELSE '7+' END"""
TURN_KEYS = ("1", "2-3", "4-6", "7+")
# The traced app's own error, not Jev's.
ERROR_GROUP_LABEL = "Trace had an error"
TURN_LABELS = {"1": "1 turn", "2-3": "2–3 turns", "4-6": "4–6 turns", "7+": "7+ turns"}
WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


class BadFilter(ValueError):
    pass


def zone(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        raise BadFilter(f"Unknown time zone: {name}") from None


@dataclass
class RunView:
    """The run being read: its task, unit, questions and window."""

    task_id: str
    row_type: str
    unit: str
    config_ids: list[str]
    tz: ZoneInfo
    date_from: datetime | None = None
    date_to: datetime | None = None
    cancelled: bool = False
    labels: dict[str, list[str]] = field(default_factory=dict)
    # The rows a run stores once they are all in, and the version that
    # changes when it reads more: lets the rows' span and users be kept.
    rows_expected: int | None = None
    rows_version: int = 0
    # Whether answers are still landing.
    live: bool = False

    @property
    def by_user(self) -> bool:
        return self.unit == "users"


def _rows(sql: str, params: dict) -> list[tuple]:
    with connection.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def _count(by_user: bool, cond: str = "", *, user_col: str = "end_user_id") -> str:
    """A count of rows, or of distinct users for a user question."""
    filt = f" FILTER (WHERE {cond})" if cond else ""
    return f"count(DISTINCT {user_col}){filt}" if by_user else f"count(*){filt}"


# ─── Time ────────────────────────────────────────────────────────────────────
def pick_bin(span_ms: float) -> int:
    # Bins start on local boundaries, so the first one may begin before the
    # window does: leave room for it.
    for size in BIN_LADDER:
        if span_ms / size <= MAX_BINS - 1:
            return size
    return BIN_LADDER[-1]


def _hour_label(hour: int) -> str:
    return f"{hour % 12 or 12} {'AM' if hour < 12 else 'PM'}"


def _hour_range(start: int, end: int) -> str:
    """ "6–9 AM", "9 AM–12 PM"."""
    a, b = start % 24, end % 24
    if b in (0, 12):
        return f"{_hour_label(a)}–{_hour_label(b)}"
    return f"{a % 12 or 12}–{_hour_label(b)}"


def _day_label(ts: datetime) -> str:
    return f"{ts:%b} {ts.day}"


def _local_ms(local: datetime, tz: ZoneInfo) -> int:
    return int(local.replace(tzinfo=tz).timestamp() * 1000)


def _bin_start(local: datetime, bin_ms: int, origin: datetime) -> datetime:
    """The start of the bin a naive local time falls in, on local boundaries."""
    if bin_ms >= 7 * _DAY:
        days = (local.date() - origin.date()).days
        return origin + timedelta(days=days - days % 7)
    if bin_ms >= _DAY:
        return local.replace(hour=0, minute=0, second=0, microsecond=0)
    if bin_ms >= _HOUR:
        k = bin_ms // _HOUR
        return local.replace(
            hour=local.hour - local.hour % k, minute=0, second=0, microsecond=0
        )
    k = bin_ms // _MIN
    return local.replace(
        minute=local.minute - local.minute % k, second=0, microsecond=0
    )


def _step(local: datetime, bin_ms: int) -> datetime:
    """The next bin start, stepping local wall-clock time."""
    if bin_ms >= _DAY:
        return local + timedelta(days=bin_ms // _DAY)
    return local + timedelta(milliseconds=bin_ms)


def _bucket_sql(bin_ms: int) -> tuple[str, str]:
    """The SQL time bucket every grouping starts from: one local hour, or the
    bin itself when bins are shorter than an hour."""
    if bin_ms >= _HOUR:
        return "date_trunc('hour', r.time AT TIME ZONE %(tz)s)", ""
    return (
        "date_bin(%(grain)s::interval, r.time AT TIME ZONE %(tz)s, TIMESTAMP '2000-01-03')",
        f"{bin_ms // _MIN} minutes",
    )


# ─── Summary ─────────────────────────────────────────────────────────────────
def _window(view: RunView) -> tuple[datetime | None, datetime | None, int, int, list]:
    """The rows' first and last time, how many rows and users there are, and
    the busiest users. Kept once every row is stored: rows are written once,
    at the run's first step, and again only when it reads more."""
    key = (
        f"ie-window:{view.task_id}:{view.rows_version}:{view.rows_expected}"
        if view.rows_expected
        else None
    )
    if key and (kept := cache.get(key)) is not None:
        return kept
    found = _read_window(view)
    if key and found[2] >= view.rows_expected:
        cache.set(key, found, 3600)
    return found


def _read_window(
    view: RunView,
) -> tuple[datetime | None, datetime | None, int, int, list]:
    row = _rows(
        "SELECT min(time), max(time), count(*), count(DISTINCT end_user_id) "
        "FROM tracer_instant_eval_row WHERE task_id = %(task)s",
        {"task": view.task_id},
    )[0]
    tmin, tmax, total_rows, users = row
    top = _rows(
        "SELECT end_user_id::text, max(user_label), count(*) AS n "
        "FROM tracer_instant_eval_row WHERE task_id = %(task)s AND end_user_id IS NOT NULL "
        "GROUP BY end_user_id ORDER BY n DESC, end_user_id LIMIT %(top)s",
        {"task": view.task_id, "top": TOP_USERS},
    )
    return tmin, tmax, int(total_rows or 0), int(users or 0), top


def _span(view: RunView, tmin, tmax) -> tuple[datetime, datetime]:
    now = timezone.now()
    start = view.date_from or tmin or now
    end = view.date_to or tmax or now
    if view.date_to is not None:
        # A view's window runs to the end of today; stop at the latest row.
        end = min(view.date_to, max(now, tmax or now))
    if tmin is not None:
        start = min(start, tmin)
    if tmax is not None:
        end = max(end, tmax + timedelta(milliseconds=1))
    if end <= start:
        end = start + timedelta(minutes=1)
    return start, end


_DIMS = ("b", "ukey", "model", "tk", "error")
_DIM_NAMES = ("time", "user", "model", "turns", "error")


def _statement(view: RunView, bucket: str) -> str:
    """One pass over the run's rows, each row carrying its answer to every
    question (l0, l1, …) from the narrow answer table, grouped by every
    dimension the charts need.

    A grouping set of dimensions alone gives the rows' progress there. A set
    of dimensions with every answer column gives the answers' counts, and the
    questions' cross counts from the set of answers alone; a user question
    instead counts distinct users per question, one answer at a time."""
    k = len(view.config_ids)
    labels = [f"l{i}" for i in range(k)]
    pending_any = " OR ".join(f"{label} = '{PENDING}'" for label in labels)
    failed_any = " OR ".join(f"{label} IN ('{ERROR}', '{SKIPPED}')" for label in labels)
    dim_sets = [*(f"{d}" for d in _DIMS), "model, b"]
    if view.by_user:
        label_sets = [f"({d}, {label})" for d in dim_sets for label in labels] + [
            f"({label})" for label in labels
        ]
        label_sets += [
            f"({a}, {b})" for i, a in enumerate(labels) for b in labels[i + 1 :]
        ]
        sets = ", ".join([f"({d})" for d in dim_sets] + ["()"] + label_sets)
    else:
        # Every row has exactly one combination of answers, so the counts of
        # an hour, a model, a model's day, the whole run and the questions
        # against each other all add up from (hour, model, answers); users,
        # turns and errors need sets of their own.
        joined = ", ".join(labels)
        sets = ", ".join(
            f"({d}, {joined})" for d in ("b, model", "ukey", "tk", "error")
        )
    unsure = ", ".join(_count(view.by_user, f"u{i}") for i in range(k))
    grouping = ", ".join([*_DIMS, *labels])
    joins = "\n  ".join(
        f"LEFT JOIN tracer_instant_eval_answer a{i} ON a{i}.task_id = %(task)s "
        f"AND a{i}.config_id = %(cfg{i})s::uuid AND a{i}.row_id = r.id"
        for i in range(k)
    )
    row_labels = ",\n         ".join(
        f"COALESCE(a{i}.label, '{PENDING}') AS l{i}, "
        f"COALESCE(a{i}.confidence < {UNSURE_BELOW} "
        f"AND a{i}.label NOT IN ('{ERROR}', '{SKIPPED}'), false) AS u{i}"
        for i in range(k)
    )
    return f"""
WITH w AS (
  SELECT {bucket} AS b,
         CASE WHEN r.end_user_id IS NULL THEN '__none__'
              WHEN r.end_user_id::text = ANY(%(top_users)s) THEN r.end_user_id::text
              ELSE '__other__' END AS ukey,
         r.model, {TURN_BUCKET.replace("turns", "r.turns")} AS tk, r.error, r.end_user_id,
         {row_labels}
  FROM tracer_instant_eval_row r
  {joins}
  WHERE r.task_id = %(task)s
),
ws AS (
  SELECT w.*, CASE WHEN {pending_any} THEN 'p' WHEN {failed_any} THEN 'f' ELSE 'a' END AS st
  FROM w
)
SELECT GROUPING({grouping}), {grouping},
       {_count(view.by_user)}, {_count(view.by_user, "st = 'p'")}, {_count(view.by_user, "st = 'f'")},
       {_count(view.by_user, "error")}, {unsure}
FROM ws GROUP BY GROUPING SETS ({sets})
"""


# How fast answers land: answers in the last two minutes and in all, and when
# the first and the last of them landed.
_PACE = f"""
SELECT count(*) FILTER (WHERE answered_at > now() - interval '{RATE_WINDOW_S} seconds'),
       count(*),
       (extract(epoch FROM max(answered_at)) * 1000)::bigint,
       (extract(epoch FROM min(answered_at)) * 1000)::bigint,
       count(*) FILTER (WHERE label NOT IN ('{ERROR}', '{SKIPPED}')),
       -- Minutes in which answers landed: how long the run actually ran,
       -- however long it sat paused or stopped in between.
       count(DISTINCT date_trunc('minute', answered_at))
FROM tracer_instant_eval_answer
WHERE task_id = %(task)s AND config_id = ANY(%(cfg_uuids)s::uuid[])
"""


# Users per answer: the 50 who get that answer most beyond the run's own
# share of it, by z-score, among users with 3 rows or more.
USERS_BY_ANSWER = 50
USERS_BY_ANSWER_MIN_ROWS = 3

_LEANING = f"""
WITH ru AS (
  SELECT id, end_user_id FROM tracer_instant_eval_row
  WHERE task_id = %(task)s AND end_user_id IS NOT NULL
),
un AS (
  SELECT end_user_id, count(*) AS n FROM ru
  GROUP BY end_user_id HAVING count(*) >= %(min_rows)s
),
ak AS (
  SELECT a.config_id, ru.end_user_id, a.label, count(*) AS k
  FROM tracer_instant_eval_answer a JOIN ru ON ru.id = a.row_id
  WHERE a.task_id = %(task)s AND a.config_id = ANY(%(cfg_uuids)s::uuid[])
  GROUP BY 1, 2, 3
),
p0 AS (
  -- The run's share of each answer among its answered rows.
  SELECT config_id, label,
         count(*)::float8 / sum(count(*)) OVER (PARTITION BY config_id) AS p0
  FROM tracer_instant_eval_answer
  WHERE task_id = %(task)s AND config_id = ANY(%(cfg_uuids)s::uuid[])
    AND label NOT IN ('{ERROR}', '{SKIPPED}')
  GROUP BY config_id, label
),
scored AS (
  SELECT ak.config_id, ak.label, ak.end_user_id, ak.k, un.n,
         sum(ak.k) FILTER (WHERE ak.label NOT IN ('{ERROR}', '{SKIPPED}'))
           OVER (PARTITION BY ak.config_id, ak.end_user_id) AS answered
  FROM ak JOIN un USING (end_user_id)
),
ranked AS (
  SELECT s.config_id, s.label, s.end_user_id, row_number() OVER (
           PARTITION BY s.config_id, s.label
           ORDER BY (s.k - s.answered * p0.p0)
                    / NULLIF(sqrt(s.answered * p0.p0 * (1 - p0.p0)), 0)
                    DESC NULLS LAST,
                    s.n DESC, s.end_user_id::text
         ) AS rn
  FROM scored s JOIN p0 USING (config_id, label)
  WHERE s.label NOT IN ('{ERROR}', '{SKIPPED}') AND s.answered > 0
)
SELECT config_id::text, label, end_user_id::text, rn FROM ranked
WHERE rn <= %(top)s ORDER BY config_id, label, rn
"""


def kept_users_by_answer(view: RunView) -> dict:
    """``users_by_answer``, which doesn't depend on the time zone: counted
    once per answers version for a finished run, every half minute for a
    live one."""
    key = (
        f"ie-users-by-answer:v2:{view.task_id}:{view.rows_version}:"
        f"{','.join(view.config_ids)}"
    )
    kept = cache.get(key)
    if kept is None:
        kept = users_by_answer(view)
        cache.set(key, kept, 30 if view.live else None)
    return kept


def users_by_answer(view: RunView) -> dict:
    """{config: {label: [user entries]}}: per answer, the users who get it
    most beyond the run's share of it, ranked by z = (k - a*p0) /
    sqrt(a*p0*(1-p0)) over their answered rows a (ties to more rows, then
    the key), each counted like the entries of ``groups.user``. A z-score,
    unlike a share, puts a user at 60 of 67 above one at 15 of 15."""
    if not view.config_ids:
        return {}
    picked = _rows(
        _LEANING,
        {
            "task": view.task_id,
            "cfg_uuids": view.config_ids,
            "min_rows": USERS_BY_ANSWER_MIN_ROWS,
            "top": USERS_BY_ANSWER,
        },
    )
    shown = {cfg: set(view.labels.get(cfg) or []) for cfg in view.config_ids}
    picked = [
        (cfg, label, user)
        for cfg, label, user, _ in picked
        if not shown.get(cfg) or label in shown[cfg]
    ]
    users = sorted({user for _, _, user in picked})
    if not users:
        return {}
    k = len(view.config_ids)
    labels = ", ".join(f"l{i}" for i in range(k))
    joins = "\n".join(
        f"LEFT JOIN tracer_instant_eval_answer a{i} ON a{i}.task_id = %(task)s "
        f"AND a{i}.config_id = %(cfg{i})s::uuid AND a{i}.row_id = r.id"
        for i in range(k)
    )
    columns = ", ".join(f"COALESCE(a{i}.label, '{PENDING}') AS l{i}" for i in range(k))
    recs = _rows(
        f"SELECT r.end_user_id::text, max(r.user_label), {columns}, count(*), "
        "count(*) FILTER (WHERE r.error) "
        f"FROM tracer_instant_eval_row r {joins} "
        "WHERE r.task_id = %(task)s AND r.end_user_id = ANY(%(users)s::uuid[]) "
        f"GROUP BY r.end_user_id, {labels}",
        {
            "task": view.task_id,
            "users": users,
            **{f"cfg{i}": cfg for i, cfg in enumerate(view.config_ids)},
        },
    )
    entries: dict[str, dict] = {}
    for rec in recs:
        user, name, answers = rec[0], rec[1], rec[2 : 2 + k]
        n, errors = int(rec[2 + k]), int(rec[3 + k])
        entry = entries.setdefault(user, _entry(user, name or user))
        entry["n"] += n
        entry["errors"] += errors
        if PENDING in answers:
            entry["pending"] += n
        elif any(label in FAILED_LABELS for label in answers):
            entry["failed"] += n
        for i, label in enumerate(answers):
            if label != PENDING:
                _sparse_add(
                    entry["counts"],
                    view.config_ids[i],
                    ERROR if label in FAILED_LABELS else label,
                    n,
                )
    out: dict[str, dict[str, list]] = {}
    for cfg, label, user in picked:
        if user in entries:
            out.setdefault(cfg, {}).setdefault(label, []).append(entries[user])
    return out


def _sparse_add(target: dict, cfg: str, label: str, n: int) -> None:
    if n:
        bucket = target.setdefault(cfg, {})
        bucket[label] = bucket.get(label, 0) + n


def _entry(key: str, label: str) -> dict:
    return {
        "key": key,
        "label": label,
        "n": 0,
        "errors": 0,
        "failed": 0,
        "pending": 0,
        "counts": {},
    }


def summary(view: RunView) -> dict:
    """The counts every chart needs, for one run."""
    tmin, tmax, total_rows, n_users, top = _window(view)
    start, end = _span(view, tmin, tmax)
    bin_ms = pick_bin((end - start).total_seconds() * 1000)
    bucket, grain = _bucket_sql(bin_ms)
    params = {
        "task": view.task_id,
        "task_s": view.task_id,
        "cfgs": view.config_ids,
        **{f"cfg{i}": cfg for i, cfg in enumerate(view.config_ids)},
        "tz": view.tz.key,
        "grain": grain,
        "top_users": [t[0] for t in top],
    }
    with transaction.atomic(), connection.cursor() as cur:
        # A guard, not the fix: the statistics of a run that just started lag
        # (ANALYZE after its bulk writes is the fix), and with a fresh task id
        # estimated at one row the planner joins row by row. This statement
        # reads every row of the run, so hash joins are always right for it.
        cur.execute("SET LOCAL enable_nestloop = off")
        cur.execute(_statement(view, bucket), params)
        result = cur.fetchall()
    pace = _rows(_PACE, {**params, "cfg_uuids": view.config_ids})[0]

    tz = view.tz
    local_start = start.astimezone(tz).replace(tzinfo=None)
    origin = local_start.replace(hour=0, minute=0, second=0, microsecond=0)
    totals = {"n": 0, "pending": 0, "failed": 0}
    counts: dict[str, dict[str, int]] = {
        cfg: dict.fromkeys(view.labels.get(cfg, []), 0) | {ERROR: 0}
        for cfg in view.config_ids
    }
    unsure: dict[str, dict[str, int]] = {
        cfg: dict.fromkeys(view.labels.get(cfg, []), 0) for cfg in view.config_ids
    }
    cross: dict = {}
    # Per local time bucket: row stats and label counts.
    time_rows: dict[datetime, dict] = {}
    time_labels: list[tuple[datetime, str, str, int]] = []
    groups: dict[str, dict[str, dict]] = defaultdict(dict)
    user_names = {t[0]: t[1] or t[0] for t in top}

    k = len(view.config_ids)
    cfgs = view.config_ids
    nd = len(_DIMS)

    def group_key(dim: str, values) -> tuple[str, str] | None:
        _b, ukey, model, tk, err = values
        if dim == "user":
            if ukey == "__other__":
                return ukey, f"{max(0, n_users - len(top)):,} other users"
            if ukey == "__none__":
                return ukey, "No user"
            return ukey, user_names.get(ukey, ukey)
        if dim == "model":
            return (model or "__none__", model or "Unknown model")
        if dim == "turns":
            return (tk, TURN_LABELS[tk]) if tk else None
        if dim == "error":
            return ("error", ERROR_GROUP_LABEL) if err else ("ok", "No trace error")
        if dim == "model_day" and _b is not None:
            return (
                f"{model or '__none__'}|{_b:%Y-%m-%d}",
                f"{model or 'Unknown model'} · {_day_label(_b)}",
            )
        return None

    def add_labels(dim, values, answer_of, n):
        """Count n rows under each question's answer, for one dimension value."""
        for i, label in answer_of:
            if label == PENDING:
                continue
            cfg = cfgs[i]
            if dim == "all":
                counts.setdefault(cfg, {})
                counts[cfg][label] = counts[cfg].get(label, 0) + n
            elif dim == "time":
                time_labels.append((values[0], cfg, label, n))
            elif key := group_key(dim, values):
                shown = ERROR if label in FAILED_LABELS else label
                _sparse_add(
                    groups[dim].setdefault(key[0], _entry(*key))["counts"],
                    cfg,
                    shown,
                    n,
                )

    meta = (int(pace[0] or 0), int(pace[1] or 0), pace[2], pace[3])
    billed = int(pace[4] or 0)
    active_minutes = int(pace[5] or 0)
    # Per distinct combination of answers (a few dozen at most): the rows'
    # state and each question's answer as shown, worked out once.
    profiles: dict[tuple, tuple[str | None, tuple]] = {}

    def profile(answers: tuple) -> tuple[str | None, tuple]:
        found = profiles.get(answers)
        if found is None:
            if PENDING in answers:
                state = "pending"
            elif any(label in FAILED_LABELS for label in answers):
                state = "failed"
            else:
                state = None
            shown = tuple(
                (cfgs[i], ERROR if label in FAILED_LABELS else label)
                for i, label in enumerate(answers)
                if label != PENDING
            )
            found = profiles[answers] = (state, shown)
        return found

    def add_rows(target: dict, answers: tuple, n: int, errors: int) -> None:
        """n rows with these answers into one group entry or bin."""
        state, shown = profile(answers)
        target["n"] += n
        target["errors"] += errors
        if state:
            target[state] += n
        by_cfg = target["counts"]
        for cfg, label in shown:
            by_label = by_cfg.get(cfg)
            if by_label is None:
                by_label = by_cfg[cfg] = {}
            by_label[label] = by_label.get(label, 0) + n

    entries: dict[tuple, dict | None] = {}

    def entry_of(dim: str, values) -> dict | None:
        """A group's entry, looked up once per dimension value."""
        b, ukey, model, tk, err = values
        ident = (
            dim,
            {"user": ukey, "model": model, "turns": tk, "error": err}.get(dim)
            if dim != "model_day"
            else (model, b.date() if b else None),
        )
        if ident in entries:
            return entries[ident]
        key = group_key(dim, values)
        found = entries[ident] = (
            groups[dim].setdefault(key[0], _entry(*key)) if key else None
        )
        return found

    def decode_rows() -> None:
        """Rows of a run whose unit is the row itself: every count adds up
        from the four grouping sets."""
        nonlocal totals
        combos: dict[tuple, int] = defaultdict(int)
        for rec in result:
            mask = rec[0]
            values = rec[1 : 1 + nd]
            answers = rec[1 + nd : 1 + nd + k]
            n = int(rec[1 + nd + k] or 0)
            errors = int(rec[4 + nd + k] or 0)
            missing = mask >> k
            present = [i for i in range(nd) if not missing & (1 << (nd - 1 - i))]
            if present == [0, 2]:
                # (hour, model, answers): the run, its hours, its models.
                combos[answers] += n
                b = values[0]
                bucket = time_rows.get(b)
                if bucket is None:
                    bucket = time_rows[b] = {
                        "n": 0,
                        "pending": 0,
                        "failed": 0,
                        "errors": 0,
                        "counts": {},
                    }
                add_rows(bucket, answers, n, errors)
                for dim in ("model", "model_day"):
                    if (entry := entry_of(dim, values)) is not None:
                        add_rows(entry, answers, n, errors)
                for i in range(k):
                    unsure_n = int(rec[5 + nd + k + i] or 0)
                    label = answers[i]
                    if unsure_n and label not in FAILED_LABELS and label != PENDING:
                        by_label = unsure.setdefault(cfgs[i], {})
                        by_label[label] = by_label.get(label, 0) + unsure_n
            elif len(present) == 1:
                if (entry := entry_of(_DIM_NAMES[present[0]], values)) is not None:
                    add_rows(entry, answers, n, errors)
        stats = {"n": 0, "pending": 0, "failed": 0, "errors": 0, "counts": {}}
        for answers, n in combos.items():
            add_rows(stats, answers, n, 0)
            for i, label in enumerate(answers):
                if label != PENDING:
                    by_label = counts.setdefault(cfgs[i], {})
                    by_label[label] = by_label.get(label, 0) + n
            # The questions' answers against each other, answered rows only.
            for a in range(k):
                for c in range(k):
                    la, lc = answers[a], answers[c]
                    if (
                        a == c
                        or la in (PENDING, ERROR, SKIPPED)
                        or lc
                        in (
                            PENDING,
                            ERROR,
                            SKIPPED,
                        )
                    ):
                        continue
                    by = (
                        cross.setdefault(cfgs[a], {})
                        .setdefault(cfgs[c], {})
                        .setdefault(la, {})
                    )
                    by[lc] = by.get(lc, 0) + n
        totals = {
            "n": stats["n"],
            "pending": stats["pending"],
            "failed": stats["failed"],
        }

    if not view.by_user:
        decode_rows()
        result = []
    for rec in result:
        mask = rec[0]
        values = rec[1 : 1 + nd]
        answers = rec[1 + nd : 1 + nd + k]
        n, pending, failed, errors = (int(v or 0) for v in rec[1 + nd + k : 5 + nd + k])
        unsure_n = [int(v or 0) for v in rec[5 + nd + k : 5 + nd + 2 * k]]
        dim_bits, label_bits = mask >> k, mask & ((1 << k) - 1)
        missing = [i for i in range(nd) if dim_bits & (1 << (nd - 1 - i))]
        present = [i for i in range(k) if not label_bits & (1 << (k - 1 - i))]
        dims_present = [i for i in range(nd) if i not in missing]
        if len(dims_present) == 2:
            dim = "model_day"
        else:
            dim = _DIM_NAMES[dims_present[0]] if dims_present else "all"
        if not present:
            # One dimension alone: the rows' progress there.
            if dim == "all":
                totals = {"n": n, "pending": pending, "failed": failed}
            elif dim == "time":
                time_rows[values[0]] = {
                    "n": n,
                    "pending": pending,
                    "failed": failed,
                    "errors": errors,
                }
            elif key := group_key(dim, values):
                # A model's day gathers that day's hours.
                entry = groups[dim].setdefault(key[0], _entry(*key))
                entry["n"] += n
                entry["errors"] += errors
                entry["failed"] += failed
                entry["pending"] += pending
            continue
        if not view.by_user and len(present) == k or view.by_user and len(present) == 1:
            add_labels(dim, values, [(i, answers[i]) for i in present], n)
            if dim == "all":
                for i in present:
                    label = answers[i]
                    if unsure_n[i] and label not in FAILED_LABELS and label != PENDING:
                        unsure.setdefault(cfgs[i], {})
                        unsure[cfgs[i]][label] = (
                            unsure[cfgs[i]].get(label, 0) + unsure_n[i]
                        )
        if (
            dim == "all"
            and len(present) >= 2
            and (not view.by_user or len(present) == 2)
        ):
            # The questions' answers against each other, answered rows only.
            for a in present:
                for b in present:
                    la, lb = answers[a], answers[b]
                    if (
                        a == b
                        or la in (PENDING, ERROR, SKIPPED)
                        or lb in (PENDING, ERROR, SKIPPED)
                    ):
                        continue
                    by = (
                        cross.setdefault(cfgs[a], {})
                        .setdefault(cfgs[b], {})
                        .setdefault(la, {})
                    )
                    by[lb] = by.get(lb, 0) + n

    # Time: buckets into timeline bins, local hours, days, 3-hour blocks, weekdays.
    bins: dict[datetime, dict] = {}
    cursor = _bin_start(local_start, bin_ms, origin)
    local_end = end.astimezone(tz).replace(tzinfo=None)
    while cursor < local_end and len(bins) < MAX_BINS:
        bins[cursor] = {
            "t": _local_ms(cursor, tz),
            "n": 0,
            "pending": 0,
            "errors": 0,
            "failed": 0,
            "counts": {},
        }
        cursor = _step(cursor, bin_ms)

    time_entries: dict[datetime, list[dict]] = {}

    def entries_at(local: datetime) -> list[dict]:
        """The day-hour, day, 3-hour block and weekday a local hour falls in."""
        found = time_entries.get(local)
        if found is not None:
            return found
        hour = local.replace(minute=0, second=0, microsecond=0)
        h3 = hour.hour - hour.hour % 3
        keys = (
            (
                "day_hour",
                f"{local:%Y-%m-%d|%H}",
                f"{_day_label(local)}, {_hour_label(hour.hour)}",
            ),
            (
                "day",
                f"{local:%Y-%m-%d}",
                f"{WEEKDAYS[local.weekday()]} {_day_label(local)}",
            ),
            (
                "hour3",
                f"{local:%Y-%m-%d}|{h3:02d}",
                f"{_day_label(local)}, {_hour_range(h3, h3 + 3)}",
            ),
            ("weekday", str(local.isoweekday()), WEEKDAYS[local.weekday()]),
        )
        found = time_entries[local] = [
            groups[dim].setdefault(key, _entry(key, label)) for dim, key, label in keys
        ]
        return found

    def bin_at(local: datetime) -> dict | None:
        b = _bin_start(local, bin_ms, origin)
        if b not in bins:
            bins[b] = {
                "t": _local_ms(b, tz),
                "n": 0,
                "pending": 0,
                "errors": 0,
                "failed": 0,
                "counts": {},
            }
        return bins[b]

    def merge_counts(target: dict, by_cfg: dict) -> None:
        for cfg, by_label in by_cfg.items():
            into = target.setdefault(cfg, {})
            for label, n in by_label.items():
                into[label] = into.get(label, 0) + n

    for local, stats in time_rows.items():
        targets = [bin_at(local), *entries_at(local)]
        for target in targets:
            for key in ("n", "errors", "failed", "pending"):
                target[key] += stats[key]
            if stats.get("counts"):
                merge_counts(target["counts"], stats["counts"])
    for local, cfg, label, n in time_labels:
        label = ERROR if label in FAILED_LABELS else label
        b = _bin_start(local, bin_ms, origin)
        targets = [bins[b]] if b in bins else []
        for target in [*targets, *entries_at(local)]:
            _sparse_add(target["counts"], cfg, label, n)

    def ordered(dim: str) -> list[dict]:
        entries = list(groups.get(dim, {}).values())
        if dim in ("day_hour", "day", "hour3", "weekday", "model_day"):
            return sorted(entries, key=lambda e: e["key"])
        if dim == "turns":
            return sorted(entries, key=lambda e: TURN_KEYS.index(e["key"]))
        if dim == "user":
            tail = [e for e in entries if e["key"] in ("__other__", "__none__")]
            head = [e for e in entries if e["key"] not in ("__other__", "__none__")]
            return sorted(head, key=lambda e: (-e["n"], e["label"])) + sorted(
                tail, key=lambda e: e["key"]
            )
        return sorted(entries, key=lambda e: (-e["n"], e["key"]))

    recent, settled_entries, last_ms, first_ms = meta
    pending = totals["pending"]
    failed = totals["failed"]
    total = totals["n"]
    for cfg in counts:
        counts[cfg].setdefault(ERROR, 0)
    return {
        "total": total,
        "answered": max(0, total - pending - failed),
        "failed": failed,
        "pending": 0 if view.cancelled else pending,
        "not_read": pending if view.cancelled else 0,
        "rows_stored": total_rows,
        "counts": counts,
        "unsure": unsure,
        "timeline": {
            "bin_ms": bin_ms,
            "tz": tz.key,
            "from": int(start.timestamp() * 1000),
            "to": int(end.timestamp() * 1000),
            "bins": sorted(bins.values(), key=lambda b: b["t"]),
        },
        "groups": {
            **{
                dim: ordered(dim)
                for dim in (
                    "day_hour",
                    "day",
                    "hour3",
                    "weekday",
                    "user",
                    "model",
                    "model_day",
                    "turns",
                    "error",
                )
            },
            # Each answer's users who most consistently get it (a cohort can
            # hide among users too small for the busiest fifty).
            "user_by_answer": {} if view.by_user else kept_users_by_answer(view),
        },
        "cross": cross if len(view.config_ids) > 1 else {},
        "_progress": {
            "recent_entries": recent,
            "settled_entries": settled_entries,
            "last_ms": last_ms,
            "first_ms": first_ms,
            # Answers Jev gave (a failed one isn't billed).
            "answers_given": billed,
            "active_minutes": active_minutes,
        },
    }


# ─── Rows ────────────────────────────────────────────────────────────────────
@dataclass
class RowFilter:
    """What the charts select. Every part narrows the rows (AND), except
    ``groups``, of which a row may match any."""

    answers: list[tuple[str | None, str]] = field(default_factory=list)
    unsure_config: str | None = None
    unsure: bool = False
    time_from: datetime | None = None
    time_to: datetime | None = None
    groups: list[str] = field(default_factory=list)
    user: str | None = None
    model: str | None = None
    error: bool | None = None
    q: str | None = None


def parse_time(value) -> datetime | None:
    if value in (None, ""):
        return None
    text = str(value).strip()
    if re.fullmatch(r"-?\d+(\.\d+)?", text):
        return datetime.fromtimestamp(float(text) / 1000, tz=UTC)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        raise BadFilter(f"Unreadable time: {text}") from None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except ValueError:
        return False


class _Params:
    """Named query parameters, each name used once."""

    def __init__(self, params: dict):
        self.params = params
        self.n = 0

    def __call__(self, value) -> str:
        self.n += 1
        name = f"p{self.n}"
        self.params[name] = value
        return f"%({name})s"


def _answer_exists(
    view: RunView, p: _Params, *, cfg: str | None, cond: str, negate=False
) -> str:
    """A row-level condition on a row's recorded answers (one per question)."""
    cfg_sql = (
        f"a.config_id = {p(cfg)}::uuid"
        if cfg
        else "a.config_id = ANY(%(cfg_uuids)s::uuid[])"
    )
    return (
        f"{'NOT ' if negate else ''}EXISTS (SELECT 1 FROM tracer_instant_eval_answer a "
        f"WHERE a.task_id = %(task)s AND a.row_id = r.id AND {cfg_sql} AND {cond})"
    )


def _conditions(view: RunView, f: RowFilter, params: dict) -> list[str]:
    p = _Params(params)
    params.setdefault("cfg_uuids", view.config_ids)
    conds: list[str] = []
    for cfg, answer in f.answers:
        if answer == PENDING:
            if cfg:
                # Not answered yet: nothing recorded for that question.
                conds.append(_answer_exists(view, p, cfg=cfg, cond="true", negate=True))
            else:
                conds.append(
                    "(SELECT count(*) FROM tracer_instant_eval_answer a "
                    "WHERE a.task_id = %(task)s AND a.row_id = r.id "
                    f"AND a.config_id = ANY(%(cfg_uuids)s::uuid[])) < {len(view.config_ids)}"
                )
        elif answer == ERROR:
            conds.append(
                _answer_exists(
                    view, p, cfg=cfg, cond=f"a.label IN ('{ERROR}', '{SKIPPED}')"
                )
            )
        else:
            conds.append(
                _answer_exists(view, p, cfg=cfg, cond=f"a.label = {p(answer)}")
            )
    if f.unsure:
        conds.append(
            _answer_exists(
                view,
                p,
                cfg=f.unsure_config,
                cond=f"a.label NOT IN ('{ERROR}', '{SKIPPED}') "
                f"AND a.confidence < {UNSURE_BELOW}",
            )
        )
    if f.time_from:
        conds.append(f"r.time >= {p(f.time_from)}")
    if f.time_to:
        conds.append(f"r.time < {p(f.time_to)}")
    if f.user:
        conds.append(
            f"r.end_user_id = {p(f.user)}::uuid"
            if _is_uuid(f.user)
            else f"r.user_label = {p(f.user)}"
        )
    if f.model is not None:
        conds.append(f"r.model = {p('' if f.model == '__none__' else f.model)}")
    if f.error is not None:
        conds.append("r.error" if f.error else "NOT r.error")
    if f.q:
        like = p(f"%{f.q}%")
        conds.append(
            f"(r.excerpt ILIKE {like} OR r.user_label ILIKE {like} OR r.row_id = {p(f.q)})"
        )
    if f.groups:
        conds.append(
            "(" + " OR ".join(_group_condition(view, g, p) for g in f.groups) + ")"
        )
    return conds


def _local_range(start: datetime, hours: int, p: _Params) -> str:
    return (
        f"(r.time AT TIME ZONE %(tz)s) >= {p(start)} "
        f"AND (r.time AT TIME ZONE %(tz)s) < {p(start + timedelta(hours=hours))}"
    )


def _top_users(task_id: str) -> list[str]:
    return [
        t[0]
        for t in _rows(
            "SELECT end_user_id::text, count(*) AS n FROM tracer_instant_eval_row "
            "WHERE task_id = %(task)s AND end_user_id IS NOT NULL "
            "GROUP BY end_user_id ORDER BY n DESC, end_user_id LIMIT %(top)s",
            {"task": task_id, "top": TOP_USERS},
        )
    ]


def _group_condition(view: RunView, group: str, p: _Params) -> str:
    dim, _, key = group.partition(":")
    try:
        if dim in ("day_hour", "hour3"):
            day, _, hour = key.partition("|")
            start = datetime.strptime(f"{day} {int(hour):02d}", "%Y-%m-%d %H")
            return _local_range(start, 1 if dim == "day_hour" else 3, p)
        if dim == "day":
            return _local_range(datetime.strptime(key, "%Y-%m-%d"), 24, p)
        if dim == "weekday":
            return f"extract(isodow FROM r.time AT TIME ZONE %(tz)s) = {p(int(key))}"
    except ValueError:
        raise BadFilter(f"Unreadable group: {group}") from None
    if dim == "user":
        if key == "__none__":
            return "r.end_user_id IS NULL"
        if key == "__other__":
            return (
                "(r.end_user_id IS NOT NULL AND NOT "
                f"(r.end_user_id::text = ANY({p(_top_users(view.task_id))})))"
            )
        if _is_uuid(key):
            return f"r.end_user_id = {p(key)}::uuid"
        return f"r.user_label = {p(key)}"
    if dim == "model":
        return f"r.model = {p('' if key == '__none__' else key)}"
    if dim == "model_day":
        model, _, day = key.rpartition("|")
        try:
            start = datetime.strptime(day, "%Y-%m-%d")
        except ValueError:
            raise BadFilter(f"Unreadable group: {group}") from None
        return (
            f"(r.model = {p('' if model == '__none__' else model)} "
            f"AND {_local_range(start, 24, p)})"
        )
    if dim == "turns":
        if key == "__none__":
            return "r.turns IS NULL"
        if key not in TURN_KEYS:
            raise BadFilter(f"Unreadable group: {group}")
        return f"({TURN_BUCKET.replace('turns', 'r.turns')}) = {p(key)}"
    if dim == "error" and key in ("error", "ok"):
        return "r.error" if key == "error" else "NOT r.error"
    raise BadFilter(f"Unreadable group: {group}")


def _cursor_encode(data: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")


def _cursor_decode(token: str | None) -> dict:
    if not token:
        return {}
    try:
        return json.loads(base64.urlsafe_b64decode(token + "=" * (-len(token) % 4)))
    except (ValueError, TypeError):
        raise BadFilter("Unreadable cursor") from None


_ROW_COLUMNS = (
    "r.id, r.row_id, r.time, r.end_user_id, r.user_label, r.model, r.turns, "
    "r.duration_ms, r.error, r.excerpt, r.trace_id"
)


def _row_dict(rec) -> dict:
    (
        _,
        row_id,
        time,
        end_user_id,
        user_label,
        model,
        turns,
        duration_ms,
        error,
        excerpt,
        trace_id,
    ) = rec[:11]
    return {
        "id": row_id,
        "time": time.isoformat() if time else None,
        "user_id": user_label or "",
        "end_user_id": str(end_user_id) if end_user_id else None,
        "excerpt": excerpt or "",
        "label": excerpt or row_id,
        "trace_id": trace_id,
        "facets": {
            "model": model or None,
            "turns": turns,
            "duration_ms": duration_ms,
            "error": bool(error),
        },
        "answers": {},
    }


def recorded_answers(view: RunView, row_pks: list[int]) -> dict[int, dict]:
    """Each row's recorded answer and confidence per question, without the
    explanations: what the charts' squares need, from the narrow table."""
    if not row_pks:
        return {}
    recs = _rows(
        "SELECT row_id, config_id::text, label, confidence FROM tracer_instant_eval_answer "
        "WHERE task_id = %(task)s AND row_id = ANY(%(pks)s) "
        "AND config_id = ANY(%(cfgs)s::uuid[])",
        {"task": view.task_id, "pks": row_pks, "cfgs": view.config_ids},
    )
    out: dict[int, dict] = defaultdict(dict)
    for pk, cfg, label, confidence in recs:
        out[pk][cfg] = {
            "answer": label,
            "explanation": "",
            "confidence": confidence,
            "status": "errored" if label in FAILED_LABELS else "completed",
        }
    return out


def answers_for(
    view: RunView, row_ids: list[str], *, explain: bool = True
) -> dict[str, dict]:
    """Each row's answer, explanation and confidence per question."""
    if not row_ids:
        return {}
    if view.row_type == "spans":
        match, ids = "l.observation_span_id = ANY(%(ids)s)", list(row_ids)
    else:
        column = "l.trace_id" if view.row_type == "traces" else "l.trace_session_id"
        ids = [str(uuid.UUID(r)) for r in row_ids if _is_uuid(r)]
        match = f"{column} = ANY(%(ids)s::uuid[])"
    recs = _rows(
        f"SELECT {RID[view.row_type]}, l.custom_eval_config_id::text, {LABEL}, "
        f"{'left(COALESCE(l.eval_explanation, %(blank)s), 2000)' if explain else '%(blank)s'}, "
        f"{CONFIDENCE}, l.status "
        "FROM tracer_eval_logger l "
        "WHERE l.eval_task_id = %(task_s)s AND l.deleted = false "
        f"AND l.custom_eval_config_id::text = ANY(%(cfgs)s) AND {match}",
        {"task_s": view.task_id, "cfgs": view.config_ids, "ids": ids, "blank": ""},
    )
    out: dict[str, dict] = defaultdict(dict)
    for rid, cfg, label, explanation, confidence, status in recs:
        pending = label == PENDING
        out[rid][cfg] = {
            "answer": None if pending else label,
            "explanation": explanation or "",
            "confidence": confidence,
            "status": "pending" if (pending and view.cancelled) else str(status or ""),
        }
    return out


def rows_page(
    view: RunView,
    f: RowFilter,
    *,
    cursor: str | None,
    page_size: int,
    sort: str,
    sort_config: str | None = None,
    compact: bool = False,
) -> dict:
    params: dict = {
        "task": view.task_id,
        "task_s": view.task_id,
        "cfgs": view.config_ids,
        "tz": view.tz.key,
    }
    conds = _conditions(view, f, params)
    where = " AND ".join(["r.task_id = %(task)s", *conds])
    state = _cursor_decode(cursor)
    if view.by_user:
        return _user_rows_page(view, where, params, state, page_size)
    joins = ""
    if sort == "confidence":
        params["s_cfg"] = sort_config or (view.config_ids[0] if view.config_ids else "")
        joins = (
            "LEFT JOIN tracer_instant_eval_answer c ON c.task_id = %(task)s "
            "AND c.config_id = %(s_cfg)s::uuid AND c.row_id = r.id"
        )
        order = "COALESCE(c.confidence, 2) ASC, r.id ASC"
        offset = int(state.get("o", 0))
        keyset = ""
    else:
        # The (task, time, id) index serves both directions; rows always have
        # a time (their first span's).
        desc = sort != "time"
        order = "r.time DESC, r.id DESC" if desc else "r.time ASC, r.id ASC"
        offset = 0
        keyset = ""
        if state.get("t") is not None:
            params["c_t"] = parse_time(state["t"])
            params["c_id"] = int(state["i"])
            keyset = f" AND (r.time, r.id) {'<' if desc else '>'} (%(c_t)s, %(c_id)s)"
    params["lim"] = page_size + 1
    params["off"] = offset
    recs = _rows(
        f"SELECT {_ROW_COLUMNS} FROM tracer_instant_eval_row r {joins} "
        f"WHERE {where}{keyset} ORDER BY {order} LIMIT %(lim)s OFFSET %(off)s",
        params,
    )
    more = len(recs) > page_size
    recs = recs[:page_size]
    rows = [_row_dict(rec) for rec in recs]
    if compact:
        recorded = recorded_answers(view, [rec[0] for rec in recs])
        for rec, row in zip(recs, rows, strict=True):
            row["answers"] = recorded.get(rec[0], {})
    else:
        answers = answers_for(view, [r["id"] for r in rows])
        for row in rows:
            row["answers"] = answers.get(row["id"], {})
    next_cursor = None
    if more and recs:
        last = recs[-1]
        next_cursor = _cursor_encode(
            {"o": offset + page_size}
            if sort == "confidence"
            else {
                "t": (last[2] or datetime(1970, 1, 1, tzinfo=UTC)).isoformat(),
                "i": last[0],
            }
        )
    total = _rows(
        f"SELECT count(*) FROM tracer_instant_eval_row r WHERE {where}", params
    )[0][0]
    return {"rows": rows, "next_cursor": next_cursor, "total": int(total)}


def _user_rows_page(
    view: RunView, where: str, params: dict, state: dict, page_size: int
) -> dict:
    """A user question lists users: their sessions' answers rolled up."""
    offset = int(state.get("o", 0))
    params.update(lim=page_size + 1, off=offset)
    recs = _rows(
        "SELECT r.end_user_id::text, max(r.user_label), max(r.time), count(*), "
        "(array_agg(r.excerpt ORDER BY r.time DESC))[1], "
        "(array_agg(r.model ORDER BY r.time DESC))[1], sum(r.turns), sum(r.duration_ms), bool_or(r.error), "
        "array_agg(r.row_id) "
        f"FROM tracer_instant_eval_row r WHERE {where} AND r.end_user_id IS NOT NULL "
        "GROUP BY r.end_user_id ORDER BY max(r.time) DESC, r.end_user_id LIMIT %(lim)s OFFSET %(off)s",
        params,
    )
    more = len(recs) > page_size
    recs = recs[:page_size]
    session_ids = [sid for rec in recs for sid in rec[9]]
    answers = answers_for(view, session_ids)
    rows = []
    for (
        uid,
        label,
        time,
        sessions,
        excerpt,
        model,
        turns,
        duration,
        error,
        sids,
    ) in recs:
        rolled = {}
        for cfg in view.config_ids:
            tally: dict[str, int] = {}
            in_flight = False
            for sid in sids:
                ans = answers.get(sid, {}).get(cfg)
                if not ans or ans["answer"] is None:
                    in_flight = True
                    continue
                tally[ans["answer"]] = tally.get(ans["answer"], 0) + 1
            real = sorted(
                ((n, k) for k, n in tally.items() if not k.startswith("__")),
                key=lambda x: (-x[0], x[1]),
            )
            rolled[cfg] = {
                "answer": real[0][1] if real else next(iter(tally), None),
                "explanation": "",
                "confidence": None,
                "counts": tally,
                "status": "running"
                if in_flight and not view.cancelled
                else "completed",
            }
        rows.append(
            {
                "id": uid,
                "time": time.isoformat() if time else None,
                "user_id": label or "",
                "end_user_id": uid,
                "excerpt": excerpt or "",
                "label": label or uid,
                "trace_id": None,
                "sessions": int(sessions),
                "facets": {
                    "model": model or None,
                    "turns": int(turns) if turns is not None else None,
                    "duration_ms": int(duration) if duration is not None else None,
                    "error": bool(error),
                },
                "answers": rolled,
            }
        )
    total = _rows(
        f"SELECT count(DISTINCT r.end_user_id) FROM tracer_instant_eval_row r WHERE {where}",
        params,
    )[0][0]
    return {
        "rows": rows,
        "next_cursor": _cursor_encode({"o": offset + page_size}) if more else None,
        "total": int(total),
    }


# ─── Export ──────────────────────────────────────────────────────────────────
EXPORT_PAGE = 5000


def iter_export(view: RunView, f: RowFilter, questions: list[dict]):
    """CSV lines for every row the filter selects, read page by page."""
    import csv
    import io

    names = {q["config_id"]: q["question"] for q in questions}
    header = [
        "id",
        "time",
        "user_id",
        "end_user_id",
        "excerpt",
        "model",
        "turns",
        "duration_ms",
        "error",
    ]
    for cfg in view.config_ids:
        q = names.get(cfg, cfg)
        header += [f"{q} · answer", f"{q} · confidence", f"{q} · explanation"]

    def line(values) -> str:
        buf = io.StringIO()
        csv.writer(buf).writerow(values)
        return buf.getvalue()

    yield line(header)
    params: dict = {
        "task": view.task_id,
        "task_s": view.task_id,
        "cfgs": view.config_ids,
        "tz": view.tz.key,
    }
    conds = _conditions(view, f, params)
    where = " AND ".join(["r.task_id = %(task)s", *conds])
    last_id = 0
    while True:
        params.update(after=last_id, lim=EXPORT_PAGE)
        recs = _rows(
            f"SELECT {_ROW_COLUMNS} FROM tracer_instant_eval_row r "
            f"WHERE {where} AND r.id > %(after)s ORDER BY r.id LIMIT %(lim)s",
            params,
        )
        if not recs:
            return
        last_id = recs[-1][0]
        answers = answers_for(view, [rec[1] for rec in recs])
        for rec in recs:
            row = _row_dict(rec)
            facets = row["facets"]
            values = [
                row["id"],
                row["time"] or "",
                row["user_id"],
                row["end_user_id"] or "",
                row["excerpt"],
                facets["model"] or "",
                "" if facets["turns"] is None else facets["turns"],
                "" if facets["duration_ms"] is None else facets["duration_ms"],
                "true" if facets["error"] else "false",
            ]
            for cfg in view.config_ids:
                ans = answers.get(row["id"], {}).get(cfg) or {}
                answer = ans.get("answer")
                values += [
                    "" if answer is None else answer,
                    ""
                    if ans.get("confidence") is None
                    else round(ans["confidence"], 3),
                    ans.get("explanation", ""),
                ]
            yield line(values)
        if len(recs) < EXPORT_PAGE:
            return
