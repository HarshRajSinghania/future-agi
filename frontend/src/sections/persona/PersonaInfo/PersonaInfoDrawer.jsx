import { Box, IconButton } from "@mui/material";
import PropTypes from "prop-types";
import SideDrawer from "src/sections/simulate-v2/components/SideDrawer";
import PersonaDrawerScale from "../PersonaDrawerScale";
import React from "react";
import PersonaInfo from "./PersonaInfo";
import Iconify from "src/components/iconify";

const PersonaInfoDrawer = ({
  open,
  onClose,
  editPersona,
  setSelectedTab,
  persona,
}) => {
  const handleOnSuccess = () => {
    if (!editPersona) {
      setSelectedTab("custom");
    }
    onClose();
  };
  return (
    <SideDrawer open={open} onClose={onClose} width={700}>
      <PersonaDrawerScale>
        <Box sx={{ width: "100%", height: "100%", position: "relative" }}>
          <IconButton
            onClick={onClose}
            sx={{
              position: "absolute",
              top: "12px",
              right: "12px",
              color: "text.primary",
            }}
          >
            <Iconify icon="akar-icons:cross" />
          </IconButton>
          <PersonaInfo
            editPersona={editPersona}
            onSuccess={handleOnSuccess}
            onCancel={onClose}
            persona={persona}
          />
        </Box>
      </PersonaDrawerScale>
    </SideDrawer>
  );
};

PersonaInfoDrawer.propTypes = {
  open: PropTypes.bool,
  onClose: PropTypes.func,
  editPersona: PropTypes.object,
  setSelectedTab: PropTypes.func,
  persona: PropTypes.object,
};

export default PersonaInfoDrawer;
