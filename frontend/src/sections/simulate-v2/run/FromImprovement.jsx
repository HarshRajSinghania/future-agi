import PropTypes from "prop-types";
import { useNavigate } from "react-router-dom";
import { Box } from "@mui/material";
import { clickable, focusRing } from "../components/clickable";

/**
 * "From Improvement 2" — inline, inside whatever line names the run. The
 * name opens the improvement on the run it started from. It stops the click
 * so a row that opens its own run on click doesn't open that instead.
 */
export default function FromImprovement({ improvement }) {
  const navigate = useNavigate();
  if (!improvement) return null;
  const { name, href } = improvement;
  return (
    <>
      From{" "}
      <Box
        component="span"
        {...clickable(href ? (e) => { e.stopPropagation(); navigate(href); } : null, { role: "link" })}
        sx={{
          color: "text.primary", fontWeight: 600,
          ...(href && { cursor: "pointer", "&:hover": { textDecoration: "underline" } }),
          ...focusRing,
        }}
      >
        {name}
      </Box>
    </>
  );
}

FromImprovement.propTypes = {
  improvement: PropTypes.shape({ name: PropTypes.string, href: PropTypes.string }),
};
