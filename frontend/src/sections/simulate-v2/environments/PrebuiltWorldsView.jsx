import PropTypes from "prop-types";
import { useMemo, useState } from "react";
import { alpha } from "@mui/material/styles";
import { Box, ButtonBase, IconButton, InputBase, MenuItem, Select, Stack, Tooltip, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { WORLD_TYPES, domainLabelOf, filterWorlds, prebuiltWorlds } from "./landingData";
import { WorldCard } from "./LandingBits";
import { AGENT_TYPES } from "./connectOptions";
import ChipCard from "./ChipCard";
import WorldDrawer from "./WorldDrawer";

/*
  Every prebuilt world, filterable. A world is the world only — open one to
  see what's in it and build it, then connect your agent.
*/
export default function PrebuiltWorldsView({ onBack }) {
  const worlds = useMemo(() => prebuiltWorlds(), []);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [domain, setDomain] = useState("all");
  const [open, setOpen] = useState(null);
  const shown = useMemo(() => filterWorlds(worlds, { query, type, domain }), [worlds, query, type, domain]);
  const domains = useMemo(() => [...new Set(worlds.map((w) => w.domain))].sort((a, b) => domainLabelOf(a).localeCompare(domainLabelOf(b))), [worlds]);
  const countOf = (id) => (id === "all" ? worlds.length : worlds.filter((w) => w.type === id).length);
  const types = [{ id: "all", label: "All types" }, ...WORLD_TYPES.map((t) => ({ ...t, icon: AGENT_TYPES.find((a) => a.id === t.id)?.icon }))].filter((t) => countOf(t.id) > 0);

  return (
    <Box sx={{ pb: 4 }}>
      {/* Back sits beside the title, as on the other Environments sub-pages. */}
      <Stack direction="row" alignItems="flex-start" spacing={1.5} sx={{ mb: 2 }}>
        <Tooltip arrow title="Back to build environment">
          <IconButton size="small" onClick={onBack} aria-label="Back to build environment" sx={{ mt: 0.25 }}>
            <Iconify icon="solar:alt-arrow-left-linear" width={18} />
          </IconButton>
        </Tooltip>
        <Box minWidth={0}>
          <Typography component="h2" sx={{ typography: "m2", fontWeight: 600 }}>
            Prebuilt worlds
            <Box component="span" sx={{ color: "text.secondary", fontWeight: 500, ml: 0.75 }}>{worlds.length}</Box>
          </Typography>
          <Typography sx={{ typography: "s2", color: "text.subtitle" }}>
            Tables, tools, rules and starter scenarios, ready to run. A placeholder agent stands in until you connect yours.
          </Typography>
        </Box>
      </Stack>

      <Stack direction={{ xs: "column", md: "row" }} spacing={1.25} alignItems={{ md: "center" }} sx={{ mb: 2 }}>
        <Box
          sx={{
            display: "flex", alignItems: "center", gap: 0.75, px: 1.25, height: 34, width: { xs: "100%", md: 260 },
            border: "1px solid", borderColor: "divider", borderRadius: 1,
            "&:focus-within": { borderColor: (t) => alpha(t.palette.text.primary, 0.4) },
          }}
        >
          <Iconify icon="solar:magnifer-linear" width={14} sx={{ color: "text.disabled" }} />
          <InputBase
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search worlds"
            inputProps={{ "aria-label": "Search worlds" }}
            sx={{ typography: "s2", flex: 1, "& input::placeholder": { color: "text.disabled", opacity: 1 } }}
          />
        </Box>

        {/* The same type chips as the landing's connect filter; Coming-soon worlds stay browsable. */}
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
          {types.map((t) => (
            <ChipCard
              key={t.id}
              icon={t.icon}
              on={type === t.id}
              onClick={() => setType(t.id)}
              label={(
                <>
                  {t.label}
                  <Box component="span" sx={{ ml: 0.625, color: "text.disabled", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{countOf(t.id)}</Box>
                </>
              )}
            />
          ))}
        </Box>

        <Select
          size="small"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          inputProps={{ "aria-label": "Domain" }}
          sx={{ minWidth: 150, height: 34, flexShrink: 0, "& .MuiSelect-select": { typography: "s2", fontWeight: 600, py: 0.75 } }}
        >
          <MenuItem value="all" sx={{ typography: "s2" }}>All domains</MenuItem>
          {domains.map((d) => <MenuItem key={d} value={d} sx={{ typography: "s2" }}>{domainLabelOf(d)}</MenuItem>)}
        </Select>

        <Box flex={1} />
        <Typography sx={{ typography: "s2", color: "text.secondary", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
          {`${shown.length} of ${worlds.length} worlds`}
        </Typography>
      </Stack>

      {WORLD_TYPES.find((t) => t.id === type)?.soon && (
        <Typography sx={{ typography: "s2", color: "text.secondary", mb: 1.5 }}>
          {`${WORLD_TYPES.find((t) => t.id === type).label} agents can't be connected yet — you can still build and explore these worlds.`}
        </Typography>
      )}

      {shown.length ? (
        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "repeat(3, 1fr)" } }}>
          {shown.map((w) => <WorldCard key={w.id} world={w} onOpen={setOpen} selected={open?.id === w.id} />)}
        </Box>
      ) : (
        <Stack alignItems="center" spacing={0.75} sx={{ py: 8, border: "1px dashed", borderColor: "divider", borderRadius: 1.5 }}>
          <Typography sx={{ typography: "s1", fontWeight: 600 }}>No world matches</Typography>
          <ButtonBase onClick={() => { setQuery(""); setType("all"); setDomain("all"); }} sx={{ typography: "s2", fontWeight: 600, color: "text.secondary", "&:hover": { color: "text.primary" } }}>
            Clear filters
          </ButtonBase>
        </Stack>
      )}

      <WorldDrawer world={open} onClose={() => setOpen(null)} />
    </Box>
  );
}
PrebuiltWorldsView.propTypes = { onBack: PropTypes.func.isRequired };
