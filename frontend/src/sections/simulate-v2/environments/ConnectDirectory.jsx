import PropTypes from "prop-types";
import { useMemo, useState } from "react";
import { alpha } from "@mui/material/styles";
import { Box, Button, ButtonBase, InputBase, Stack, Tooltip, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { BrandMark, LogoTile, QuietTag, SectionHead } from "./LandingBits";
import { PANEL_SX, focusRing } from "./landingStyles";

/*
  The two ways in shared by the Environments landing and New agent: paste
  anything (we say what it is and open the right setup), and a directory of
  every way to connect, by where the agent lives.
*/

/* ── paste anything ────────────────────────────────────────────────────── */

export function PasteBar({ onPick, detect, examples, title = "Start with anything you have", hint = "Paste a link, an ID or a sentence. We open the right setup.", placeholder }) {
  const [value, setValue] = useState("");
  const found = useMemo(() => detect(value), [detect, value]);
  const canGo = !!found && !found.blocked && !!found.choice;
  const go = () => { if (canGo) onPick(found.choice, found.prefill, { name: found.label, detail: found.detail, logo: found.logo, icon: found.icon }); };

  return (
    <Box sx={{ ...PANEL_SX, p: { xs: 2, md: 2.5 } }}>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "baseline" }} spacing={0.5} sx={{ mb: 1.5 }}>
        <Typography component="h2" sx={{ typography: "m3", fontWeight: 600 }}>{title}</Typography>
        <Typography sx={{ typography: "s2", color: "text.secondary" }}>{hint}</Typography>
      </Stack>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <Box
          sx={{
            flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 1, px: 1.5, height: 44,
            border: "1px solid", borderRadius: 1,
            borderColor: (t) => (found?.warn ? alpha(t.palette.error.main, 0.55) : t.palette.divider),
            bgcolor: (t) => alpha(t.palette.text.primary, t.palette.mode === "dark" ? 0.025 : 0.015),
            transition: "border-color .12s ease",
            "&:focus-within": { borderColor: (t) => (found?.warn ? t.palette.error.main : alpha(t.palette.text.primary, 0.45)) },
          }}
        >
          <Iconify icon="solar:clipboard-text-linear" width={16} sx={{ color: "text.disabled", flexShrink: 0 }} />
          <InputBase
            fullWidth
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") go(); if (e.key === "Escape") setValue(""); }}
            placeholder={placeholder || "Paste a GitHub repo, Vapi or Retell ID, MCP URL or endpoint — or describe the agent"}
            inputProps={{ "aria-label": "Paste a repository, ID, URL or description", spellCheck: false }}
            sx={{
              typography: "s1",
              fontFamily: value && found?.kind !== "describe" ? "ui-monospace, SFMono-Regular, Menlo, monospace" : undefined,
              "& input::placeholder": { color: "text.disabled", opacity: 1 },
            }}
          />
          {value && (
            <Tooltip arrow title="Clear">
              <ButtonBase onClick={() => setValue("")} aria-label="Clear" sx={{ borderRadius: 0.75, p: 0.25, color: "text.disabled", "&:hover": { color: "text.primary" } }}>
                <Iconify icon="eva:close-fill" width={16} />
              </ButtonBase>
            </Tooltip>
          )}
        </Box>
        <Button
          variant="contained" color="primary" disabled={!canGo} onClick={go}
          endIcon={<Iconify icon="solar:arrow-right-linear" width={14} />}
          sx={{ height: 44, px: 2.25, typography: "s1", fontWeight: 700, flexShrink: 0 }}
        >
          Continue
        </Button>
      </Stack>

      {/* What the paste was read as; with `examples`, a Try row until then. */}
      {(found || examples?.length > 0) && (
      <Box sx={{ minHeight: 34, mt: 1.25 }}>
        {found ? <Detection found={found} /> : (
          <Stack direction="row" alignItems="center" spacing={0.75} useFlexGap flexWrap="wrap">
            <Typography sx={{ typography: "s2", color: "text.secondary", mr: 0.25 }}>Try</Typography>
            {examples.map((ex) => (
              <ButtonBase
                key={ex.id}
                onClick={() => setValue(ex.value)}
                sx={{
                  gap: 0.75, px: 1, height: 26, borderRadius: 0.75,
                  border: "1px solid", borderColor: "divider",
                  typography: "s2", fontWeight: 600, color: "text.secondary",
                  transition: "color .12s ease, border-color .12s ease",
                  "&:hover": { color: "text.primary", borderColor: (t) => alpha(t.palette.text.primary, 0.3) },
                  "&.Mui-focusVisible": focusRing,
                }}
              >
                <BrandMark logo={ex.logo} icon={ex.icon} size={12} />
                {ex.label}
              </ButtonBase>
            ))}
          </Stack>
        )}
      </Box>
      )}
    </Box>
  );
}
PasteBar.propTypes = {
  onPick: PropTypes.func.isRequired, detect: PropTypes.func.isRequired,
  /* Sample pastes to try; left out where the connect list below already offers each one. */
  examples: PropTypes.array,
  title: PropTypes.node, hint: PropTypes.node, placeholder: PropTypes.string,
};

function Detection({ found }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minWidth: 0 }}>
      {found.warn ? (
        <Box sx={{ width: 24, height: 24, display: "grid", placeItems: "center", flexShrink: 0, color: "error.main" }}>
          <Iconify icon={found.icon} width={18} />
        </Box>
      ) : <LogoTile logo={found.logo} icon={found.icon} size={24} />}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
          <Typography sx={{ typography: "s2", fontWeight: 700, flexShrink: 0 }}>{found.label}</Typography>
          {found.detail && (
            <Typography noWrap sx={{ typography: "s2", color: "text.secondary", fontFamily: found.kind === "describe" ? undefined : "ui-monospace, SFMono-Regular, Menlo, monospace", minWidth: 0 }}>
              {found.detail}
            </Typography>
          )}
          {found.tag && <QuietTag>{found.tag}</QuietTag>}
        </Stack>
        <Typography sx={{ typography: "s2", color: "text.secondary" }}>{found.note}</Typography>
      </Box>
      {!found.blocked && (
        <Typography sx={{ typography: "s3", color: "text.disabled", flexShrink: 0, display: { xs: "none", md: "block" } }}>Press Enter</Typography>
      )}
    </Stack>
  );
}
Detection.propTypes = { found: PropTypes.object.isRequired };

/* ── the directory ─────────────────────────────────────────────────────── */

/**
 * Ways to connect, by where the agent lives: one column per group, each
 * saying how we test it there; quiet rows with brand marks; search across
 * all of them. `topBand` sits above the columns (e.g. agents already
 * connected). `compact` keeps it to two columns — for use inside a drawer.
 */
export function Directory({ groups: all, pickedId, onPick, topBand, compact = false, title, subtitle, actions, sectionRef, emptyHint, footer, perGroup }) {
  const [query, setQuery] = useState("");
  const total = all.reduce((n, g) => n + g.items.length, 0);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.map((g) => ({ ...g, items: g.items.filter((it) => `${it.name} ${it.need} ${g.title}`.toLowerCase().includes(q)) }));
  }, [all, query]);
  const matches = groups.reduce((n, g) => n + g.items.length, 0);
  const cols = compact ? 2 : Math.min(4, all.length);

  return (
    <Box ref={sectionRef} sx={{ scrollMarginTop: 16 }}>
      <SectionHead
        title={title}
        subtitle={subtitle}
        action={(
          <>
            <Box
              sx={{
                display: "flex", alignItems: "center", gap: 0.75, px: 1.25, height: 32, width: { xs: "100%", sm: 240 },
                border: "1px solid", borderColor: "divider", borderRadius: 1,
                "&:focus-within": { borderColor: (t) => alpha(t.palette.text.primary, 0.4) },
              }}
            >
              <Iconify icon="solar:magnifer-linear" width={14} sx={{ color: "text.disabled" }} />
              <InputBase
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${total} ways to connect`}
                inputProps={{ "aria-label": "Search ways to connect" }}
                sx={{ typography: "s2", flex: 1, "& input::placeholder": { color: "text.disabled", opacity: 1 } }}
              />
            </Box>
            {actions}
          </>
        )}
      />

      <Box sx={{ ...PANEL_SX, overflow: "hidden" }}>
        {topBand}
        {matches === 0 ? (
          <Stack alignItems="center" spacing={0.5} sx={{ py: 5, px: 2, textAlign: "center" }}>
            <Typography sx={{ typography: "s1", fontWeight: 600 }}>{`Nothing matches “${query.trim()}”`}</Typography>
            {emptyHint && <Typography sx={{ typography: "s2", color: "text.secondary" }}>{emptyHint}</Typography>}
          </Stack>
        ) : (
          <Box
            sx={(t) => {
              /* One column, then two, then all side by side — rules drawn
                 between them in the theme's divider colour. */
              const rule = `1px solid ${t.palette.divider}`;
              return {
                display: "grid",
                gridTemplateColumns: "1fr",
                "& > .dir-col:not(:first-of-type)": { borderTop: rule },
                [t.breakpoints.up(compact ? "sm" : "md")]: {
                  gridTemplateColumns: "1fr 1fr",
                  "& > .dir-col:nth-of-type(2)": { borderTop: "none" },
                  "& > .dir-col:nth-of-type(even)": { borderLeft: rule },
                },
                ...(cols > 2 && {
                  [t.breakpoints.up("lg")]: {
                    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                    "& > .dir-col:not(:first-of-type)": { borderTop: "none", borderLeft: rule },
                  },
                }),
              };
            }}
          >
            {groups.map((g) => (
              <DirectoryColumn
                key={g.id}
                group={g}
                total={all.find((x) => x.id === g.id)?.items.length || 0}
                pickedId={pickedId}
                onPick={onPick}
                compact={compact}
                dimmed={!!query && !g.items.length}
                /* A search shows every match; otherwise a long group folds. */
                limit={query ? undefined : perGroup}
              />
            ))}
          </Box>
        )}
        {footer && (
          <Box sx={{ px: 2.5, py: 1.25, borderTop: "1px solid", borderColor: "divider" }}>{footer}</Box>
        )}
      </Box>
    </Box>
  );
}
Directory.propTypes = {
  groups: PropTypes.array.isRequired, pickedId: PropTypes.string, onPick: PropTypes.func.isRequired,
  topBand: PropTypes.node, compact: PropTypes.bool, title: PropTypes.node, subtitle: PropTypes.node,
  actions: PropTypes.node, sectionRef: PropTypes.object, emptyHint: PropTypes.node,
  /* Under the columns, inside the panel. */
  footer: PropTypes.node,
  /* Rows a group shows before "N more" — so the panel doesn't grow with the catalogue. */
  perGroup: PropTypes.number,
};

function DirectoryColumn({ group, total, pickedId, onPick, dimmed, compact, limit }) {
  const [expanded, setExpanded] = useState(false);
  /* Ready ways first; Coming soon ones last. */
  const ordered = [...group.items.filter((it) => !it.soon && !it.later), ...group.items.filter((it) => it.soon || it.later)];
  const shown = limit && !expanded ? ordered.slice(0, limit) : ordered;
  const hidden = ordered.length - shown.length;
  return (
    <Box className="dir-col" sx={{ p: 2, pt: 2.25, minWidth: 0, opacity: dimmed ? 0.45 : 1 }}>
      <Stack direction="row" alignItems="baseline" spacing={0.75}>
        <Typography component="h3" sx={{ typography: "s1", fontWeight: 700 }}>{group.title}</Typography>
        <Typography sx={{ typography: "s2", color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>{total}</Typography>
      </Stack>
      <Typography
        sx={{
          typography: compact ? "s2" : "s3", color: "text.secondary", mt: 0.25, mb: compact ? 1.5 : 1,
          /* Two lines at most, and every column's list starts on the same line. */
          ...(!compact && { minHeight: { lg: 36 }, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }),
        }}
      >
        {group.reach}
      </Typography>
      <Stack spacing={0.25}>
        {shown.map((it) => (
          <DirectoryRow key={it.id} item={it} selected={pickedId === it.id} onPick={onPick} />
        ))}
        {hidden > 0 && (
          <ButtonBase
            onClick={() => setExpanded(true)}
            sx={{ justifyContent: "flex-start", px: 1, mx: -1, py: 0.75, borderRadius: 1, typography: "s2", fontWeight: 600, color: "text.secondary", "&:hover": { color: "text.primary" }, "&.Mui-focusVisible": focusRing }}
          >
            {`${hidden} more`}
          </ButtonBase>
        )}
        {!group.items.length && (
          <Typography sx={{ typography: "s2", color: "text.disabled", py: 1 }}>No match here</Typography>
        )}
      </Stack>
    </Box>
  );
}
DirectoryColumn.propTypes = { group: PropTypes.object.isRequired, total: PropTypes.number, compact: PropTypes.bool, pickedId: PropTypes.string, onPick: PropTypes.func.isRequired, dimmed: PropTypes.bool, limit: PropTypes.number };

function DirectoryRow({ item, selected, onPick }) {
  const inert = !!(item.soon || item.later);
  /* Coming soon reads in the row's second line, not as a badge. */
  const tag = inert ? null : item.tag;
  return (
    <ButtonBase
      disabled={inert}
      onClick={() => onPick(item)}
      aria-pressed={selected}
      sx={{
        width: "100%", justifyContent: "flex-start", textAlign: "left",
        gap: 1.25, px: 1, py: 0.75, mx: -1, borderRadius: 1,
        bgcolor: (t) => (selected ? alpha(t.palette.text.primary, t.palette.mode === "dark" ? 0.08 : 0.05) : "transparent"),
        transition: "background-color .12s ease",
        "&:hover": { bgcolor: (t) => alpha(t.palette.text.primary, selected ? 0.09 : 0.045) },
        "&:hover .dir-go": { opacity: 1, transform: "translateX(0)" },
        "&.Mui-focusVisible": focusRing,
        "&.Mui-disabled": { opacity: 0.55 },
      }}
    >
      <LogoTile logo={item.logo} icon={item.icon} muted={inert} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography noWrap sx={{ typography: "s2_1", fontWeight: 600, color: inert ? "text.secondary" : "text.primary" }}>{item.name}</Typography>
        <Typography noWrap sx={{ typography: "s3", color: "text.secondary" }}>{inert ? "Coming soon" : item.need}</Typography>
      </Box>
      {tag && <QuietTag>{tag}</QuietTag>}
      {!inert && (
        <Iconify
          className="dir-go"
          icon={selected ? "solar:check-circle-linear" : "solar:alt-arrow-right-linear"}
          width={14}
          sx={{
            color: "text.secondary", flexShrink: 0,
            opacity: selected ? 1 : 0, transform: selected ? "none" : "translateX(-3px)",
            transition: "opacity .15s cubic-bezier(.16,1,.3,1), transform .15s cubic-bezier(.16,1,.3,1)",
          }}
        />
      )}
    </ButtonBase>
  );
}
DirectoryRow.propTypes = { item: PropTypes.object.isRequired, selected: PropTypes.bool, onPick: PropTypes.func.isRequired };
