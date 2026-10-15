import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Box, Button, Stack, Typography } from "@mui/material";
import Iconify from "src/components/iconify";
import { paths } from "src/routes/paths";
import { datasetSourceOf } from "./improvementSources";

/**
 * An improvement run against a dataset — level 2 for a dataset row. There's
 * no dataset improvement flow yet, so it says so.
 */
export default function ImprovementDatasetView() {
  const { datasetId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.back;
  const d = datasetSourceOf(datasetId);
  return (
    <Box sx={{ height: "100%", overflow: "auto", p: 2 }}>
      <Button
        size="small" onClick={() => navigate(from?.to || paths.dashboard.simulate.improvements)}
        startIcon={<Iconify icon="solar:arrow-left-linear" width={14} />}
        sx={{ typography: "s2", fontWeight: 600, color: "text.secondary", ml: -0.75, mb: 0.75, minWidth: 0 }}
      >
        {`Back to ${from?.label || "Improvements"}`}
      </Button>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.25 }}>
        <Typography sx={{ typography: "m3", fontWeight: 700 }}>{d ? `Improve on ${d.name}` : "Dataset"}</Typography>
        <Typography sx={{ typography: "s3", fontWeight: 600, color: "text.subtitle", px: 0.75, border: "1px solid", borderColor: "divider", borderRadius: 0.75 }}>Coming soon</Typography>
      </Stack>
      {d && <Typography sx={{ typography: "s3", color: "text.subtitle", mb: 2 }}>{`Dataset · ${d.rowCount.toLocaleString()} rows run as scenarios`}</Typography>}
      <Typography sx={{ typography: "s2", color: "text.secondary" }}>
        Improving an agent against a dataset — each row run as a scenario, with the same runs and held-back proof — is coming soon. Its runs will be listed here.
      </Typography>
    </Box>
  );
}
