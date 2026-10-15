import PropTypes from "prop-types";
import { Link as RouterLink } from "react-router-dom";
import { Box, Stack, Tooltip, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { sourceLinkOf } from "../../_mock/scenarioProvenance";
import { openBuilderChat } from "../../_mock/builderPromptBus";
import { personalDataLine, personalDataDetail, REPRO_LABEL } from "../../_mock/scenarioSources";

/**
 * Where a scenario came from — a chip in the scenario's drawer (`labelled`);
 * the table rows leave it out, the batch header already says who added them.
 *
 * A source with somewhere to go back to — the Error Feed issue it was built
 * from, the run whose failure it reproduces, the chat that wrote it — is a
 * small chip with that id ("ISS-4501", "Run 3", "Chat") that goes there.
 * Everything else (added by hand, derived, generated, a dataset) isn't shown
 * on the row at all — it would be on every row — and reads as a labelled
 * chip in the scenario's drawer instead (`labelled`).
 */
export default function SourceBadge({ scenario, env, envState, labelled = false }) {
  /* The environment lets an improvement-made scenario link to its improvement. */
  const link = sourceLinkOf(scenario, { env, envState });
  const linked = !!(link.to || link.chat);

  const title = (
    <Stack spacing={0.375} sx={{ py: 0.25, maxWidth: 320 }}>
      <Typography sx={{ typography: "s3", fontWeight: 700, color: "inherit" }}>{link.title}</Typography>
      {link.detail && <Typography sx={{ typography: "s3", color: "inherit" }}>{link.detail}</Typography>}
      {/* Built from production: the problem, not the person. */}
      {personalDataLine(scenario) && (
        <Typography sx={{ typography: "s3", color: "inherit" }}>
          {`${personalDataLine(scenario)}. ${personalDataDetail(scenario) || ""}`}
        </Typography>
      )}
      {scenario.reproduce?.state && (
        <Typography sx={{ typography: "s3", color: "inherit" }}>
          {`${REPRO_LABEL[scenario.reproduce.state]}${scenario.reproduce.of ? ` · failed ${scenario.reproduce.fails} of ${scenario.reproduce.of}` : ""}${scenario.target ? " · a target" : ""}`}
        </Typography>
      )}
      {/* Built from production: the conversation itself isn't copied here. */}
      {link.observe && (
        <Typography sx={{ typography: "s3", color: "inherit" }}>
          {`${link.observe.line} `}
          <Box
            component={RouterLink} to={link.observe.to} onClick={(e) => e.stopPropagation()}
            sx={{ color: "inherit", fontWeight: 700, textDecoration: "underline" }}
          >
            Open the trace
          </Box>
        </Typography>
      )}
      {linked && (
        <Typography sx={{ typography: "s3", color: "inherit", opacity: 0.7 }}>
          {link.chat
            ? "Click to open the chat."
            : link.source.id === "error-feed" ? "Click to open the issue."
              : link.source.id === "improvement" ? "Click to open the improvement." : "Click to open the run."}
        </Typography>
      )}
    </Stack>
  );

  /* In the drawer: the source named in words, with its id when it has one. */
  const refShown = link.ref && !link.label.toLowerCase().includes(link.ref.toLowerCase()) ? link.ref : null;
  const chipText = labelled ? `${link.label}${refShown ? ` · ${refShown}` : ""}` : link.ref;

  if (!linked) {
    /* A source with a name of its own but nowhere to go (a replayed
       production conversation, an improvement) keeps the chip, unlinked. */
    if (link.ref || labelled) {
      return (
        <Tooltip arrow title={title}>
          <Box
            component="span"
            sx={{
              display: "inline-flex", alignItems: "center", gap: 0.375, flexShrink: 0,
              height: labelled ? 20 : 16, px: labelled ? 0.75 : 0.5, borderRadius: 0.5,
              border: "1px solid", borderColor: "divider", color: "text.secondary",
            }}
          >
            <Iconify icon={link.source.icon} width={labelled ? 12 : 10} />
            <Typography component="span" noWrap sx={{ typography: "s3", fontWeight: labelled ? 600 : 700, color: "inherit", lineHeight: 1 }}>
              {chipText}
            </Typography>
          </Box>
        </Tooltip>
      );
    }
    return null;
  }

  /* Rows open on click — the badge's own click must not. */
  const stop = (e) => e.stopPropagation();
  const routeProps = link.to
    ? { component: RouterLink, to: link.to, onClick: stop }
    : { component: "button", type: "button", onClick: (e) => { stop(e); openBuilderChat(); } };

  return (
    <Tooltip arrow title={title}>
      <Box
        {...routeProps}
        aria-label={link.title}
        sx={{
          display: "inline-flex", alignItems: "center", gap: 0.375, flexShrink: 0,
          height: labelled ? 20 : 16, px: labelled ? 0.75 : 0.5, m: 0, borderRadius: 0.5,
          border: "1px solid", borderColor: "divider", bgcolor: "transparent",
          color: "text.secondary", textDecoration: "none", cursor: "pointer", font: "inherit",
          transition: "border-color .12s ease, color .12s ease",
          "&:hover": { borderColor: "text.disabled", color: "text.primary" },
          "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 1 },
        }}
      >
        <Iconify icon={link.source.icon} width={labelled ? 12 : 10} />
        <Typography component="span" noWrap sx={{ typography: "s3", fontWeight: labelled ? 600 : 700, color: "inherit", lineHeight: 1 }}>
          {chipText}
        </Typography>
      </Box>
    </Tooltip>
  );
}
SourceBadge.propTypes = {
  labelled: PropTypes.bool, scenario: PropTypes.object.isRequired, env: PropTypes.object, envState: PropTypes.object };
