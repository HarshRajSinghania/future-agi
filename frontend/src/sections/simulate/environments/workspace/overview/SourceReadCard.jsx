import PropTypes from "prop-types";
import { Box, Stack, Typography } from "@mui/material";
import OriginChip from "../../components/OriginChip";
import { SOURCE_READ_COPY } from "./overview.constants";

const MONO = "ui-monospace, Menlo, monospace";

function Group({ title, hint, items }) {
  if (!items.length) return null;
  return (
    <Box sx={{ borderTop: "1px solid", borderColor: "divider" }}>
      <Stack direction="row" alignItems="baseline" spacing={1} sx={{ px: 2.5, pt: 2, pb: 1 }}>
        <Typography sx={{ typography: "s2", fontWeight: "fontWeightBold" }}>{title}</Typography>
        <Typography sx={{ typography: "s3", color: "text.subtitle", flex: 1 }}>{hint}</Typography>
        <Typography sx={{ typography: "s3", color: "text.subtitle", fontWeight: "fontWeightBold" }}>
          {SOURCE_READ_COPY.count(items.length)}
        </Typography>
      </Stack>
      {items.map((item, index) => (
        <Box
          key={`${item.text}-${index}`}
          sx={{
            px: 2.5,
            py: 1.25,
            bgcolor: index % 2 ? "background.neutral" : "transparent",
          }}
        >
          {/* Rules are full sentences: wrap them instead of cutting them off, and
              break a long unbroken token (a URL, a tool id) rather than overflow. */}
          <Stack direction="row" spacing={1.25} alignItems="flex-start">
          <Typography
            sx={{
              typography: "s2",
              fontFamily: MONO,
              fontWeight: "fontWeightSemiBold",
              whiteSpace: "normal",
              overflowWrap: "anywhere",
                flex: 1,
            }}
          >
              {item.text}
          </Typography>
            {item.origin && (
              <OriginChip
                origin={item.origin.kind}
                file={item.origin.path || item.origin.field}
                line={item.origin.line}
              />
            )}
          </Stack>
        </Box>
      ))}
    </Box>
  );
}
Group.propTypes = {
  title: PropTypes.string,
  hint: PropTypes.string,
  items: PropTypes.arrayOf(PropTypes.object),
};

export default function SourceReadCard({ tools = [], rules = [], ruleDetails = [] }) {
  const toolRows = tools
    .filter((tool) => tool?.name)
    .map((tool) => ({ text: tool.name, origin: tool.origin }));
  const ruleRows = rules
    .map((rule) => (typeof rule === "string" ? rule : rule?.text || rule?.name))
    .filter(Boolean)
    .map((text) => ({
      text,
      origin: (ruleDetails || []).find((detail) => detail.text === text)?.origin,
    }));
  if (!toolRows.length && !ruleRows.length) return null;
  return (
    <Box sx={{ mb: 3, border: "1px solid", borderColor: "divider", borderRadius: 1.5, overflow: "hidden" }}>
      <Box sx={{ px: 2.5, py: 1.5, bgcolor: "background.neutral" }}>
        <Typography sx={{ typography: "s3", color: "text.subtitle", fontWeight: "fontWeightBold", textTransform: "uppercase", letterSpacing: 0.6 }}>
          {SOURCE_READ_COPY.title}
        </Typography>
      </Box>
      <Group title={SOURCE_READ_COPY.tools} hint={SOURCE_READ_COPY.toolsHint} items={toolRows} />
      <Group title={SOURCE_READ_COPY.rules} hint={SOURCE_READ_COPY.rulesHint} items={ruleRows} />
    </Box>
  );
}

SourceReadCard.propTypes = {
  tools: PropTypes.array,
  rules: PropTypes.array,
  ruleDetails: PropTypes.array,
};
