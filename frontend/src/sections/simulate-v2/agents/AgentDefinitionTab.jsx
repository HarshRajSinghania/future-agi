import PropTypes from "prop-types";
import { Box, Stack, Typography } from "@mui/material";
import AgentFilesTab from "./AgentFilesTab";
import AgentMembersCard from "./AgentMembersCard";
import { definitionSummaryOf, memberAreasOf } from "./agentDefinitionSummary";
import { MONO } from "./agentViewUtils";
import { ActionText } from "./AgentBits";
import { clickable, focusRing } from "../components/clickable";

/**
 * Definition — what we read about this version first (entry point, prompts,
 * tools, model, how it runs), then the files it was read from. Clicking a
 * part opens its file in the viewer below.
 */
export default function AgentDefinitionTab({
  agent, definition, source, files, prevFiles, label, prevLabel, latest, focusPath, diffOn, onOpenFile, onTab, protectedMembers,
}) {
  const rows = definitionSummaryOf({ agent, definition, files, source });
  /* Each member's own configuration, area by area. */
  const memberAreas = agent ? memberAreasOf({ agent, definition, source }) : [];
  return (
    <Stack spacing={2}>
      <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1.5, bgcolor: "background.paper", overflow: "hidden" }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1.25, borderBottom: "1px solid", borderColor: "divider" }}>
          <Typography sx={{ typography: "s2", fontWeight: 700, flex: 1 }}>
            {"What we read "}
            <Box component="span" sx={{ fontFamily: MONO, fontWeight: 600, color: "text.subtitle" }}>
              {`· ${label}${label === latest ? " (latest)" : ""}`}
            </Box>
          </Typography>
          <Typography noWrap sx={{ typography: "s3", color: "text.subtitle" }}>
            {source.kind === "endpoint" ? "Nothing to read — only what it does" : `Read from ${source.label}`}
          </Typography>
        </Stack>
        {rows.map((r) => (
          <Stack
            key={r.id}
            direction="row"
            alignItems="flex-start"
            spacing={2}
            sx={{
              px: 2, py: 1,
              borderTop: "1px solid", borderColor: "divider",
              "&:first-of-type": { borderTop: "none" },
            }}
          >
            <Typography sx={{ typography: "s2", color: "text.subtitle", width: 150, flexShrink: 0, lineHeight: "24px" }}>
              {r.label}
            </Typography>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {r.items ? (
                r.items.length ? (
                  <Stack direction="row" flexWrap="wrap" useFlexGap gap={0.75}>
                    {r.items.map((it) => (
                      <Box
                        key={it.path}
                        {...clickable(() => onOpenFile(it.path))}
                        sx={{
                          px: 1, height: 24, display: "inline-flex", alignItems: "center", borderRadius: 0.75, cursor: "pointer",
                          border: "1px solid", borderColor: "divider", bgcolor: "background.neutral",
                          "&:hover": { borderColor: "text.disabled" },
                          ...focusRing,
                        }}
                      >
                        <Typography sx={{ typography: "s3", fontWeight: 500, fontFamily: it.mono ? MONO : undefined, fontSize: it.mono ? 11.5 : undefined }}>
                          {it.label}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                ) : (
                  <Typography sx={{ typography: "s2", color: "text.subtitle", lineHeight: "24px" }}>{r.empty}</Typography>
                )
              ) : (
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ minHeight: 24 }}>
                  <Typography
                    noWrap
                    {...clickable(r.path ? () => onOpenFile(r.path) : undefined)}
                    sx={{
                      typography: "s2", minWidth: 0,
                      fontFamily: r.mono ? MONO : undefined,
                      color: r.hidden ? "text.subtitle" : "text.primary",
                      cursor: r.path ? "pointer" : "default",
                      "&:hover": r.path ? { textDecoration: "underline" } : {},
                      ...focusRing,
                    }}
                  >
                    {r.value}
                  </Typography>
                  {r.setUp && (
                    <ActionText onClick={() => onTab("connections")}>Set up</ActionText>
                  )}
                </Stack>
              )}
              {r.note && <Typography sx={{ typography: "s3", color: "text.subtitle", mt: 0.25 }}>{r.note}</Typography>}
            </Box>
          </Stack>
        ))}
      </Box>

      {definition?.members?.length > 0 && (
        <AgentMembersCard members={definition.members} areas={memberAreas} protectedIds={protectedMembers || []} onConstraints={() => onTab("constraints")} />
      )}

      <AgentFilesTab
        files={files}
        prevFiles={prevFiles}
        label={label}
        prevLabel={prevLabel}
        sourceKind={source.kind}
        focusPath={focusPath}
        diffOn={diffOn}
      />
    </Stack>
  );
}

AgentDefinitionTab.propTypes = {
  agent: PropTypes.object,
  definition: PropTypes.object,
  source: PropTypes.object,
  files: PropTypes.array,
  prevFiles: PropTypes.array,
  label: PropTypes.string,
  prevLabel: PropTypes.string,
  latest: PropTypes.string,
  focusPath: PropTypes.string,
  diffOn: PropTypes.bool,
  onOpenFile: PropTypes.func,
  onTab: PropTypes.func,
  protectedMembers: PropTypes.array,
};
