import PropTypes from "prop-types";
import { useState } from "react";
import { Box, InputAdornment, TextField, Typography } from "@mui/material";
import { DEMO_ANY_KEY, RAW_KEY_MESSAGE, isSecretRef, keyRefOf, looksLikeRawKey, storeOfRef, validateSecretRef } from "../../_mock/secretRefs";

const MONO = "ui-monospace, Menlo, monospace";
const HELPER = "A secret-manager path — the key never leaves it.";

/**
 * A credential field in a connect form (AC-6.12): it takes a reference into
 * the team's secret manager, never the value. A pasted key is refused where
 * it lands — the field keeps what it had and says why — so it never reaches
 * the form's state, let alone the record. The same rule as SecretRefEditor,
 * shaped as a form field rather than an inline save.
 */
export default function SecretRefField({ label, required, value, onChange, placeholder, helper, fullWidth, dense }) {
  const [refused, setRefused] = useState(false);
  const [touched, setTouched] = useState(false);
  const text = value || "";
  const store = isSecretRef(text) ? storeOfRef(text.trim()) : null;
  /* A half-typed path isn't wrong yet — only say so once the field is left. */
  /* Demo: a typed key is taken, and recorded as the field's own slot. */
  const demoRef = DEMO_ANY_KEY && text.trim() && !store ? keyRefOf(text, placeholder) : "";
  const formatError = touched && text.trim() && !store && !demoRef ? validateSecretRef(text).error : null;

  const take = (next) => {
    /* Something that starts like a scheme is a reference being edited, not
       a pasted key — it gets the format check on blur instead. */
    if (!DEMO_ANY_KEY && looksLikeRawKey(next) && !/^[a-z][a-z-]*:/i.test(next.trim())) {
      setRefused(true);
      return;
    }
    setRefused(false);
    onChange(next);
  };

  return (
    <Box sx={{ flex: fullWidth ? 1 : undefined, minWidth: 0 }}>
      {label && (
        <Typography sx={{ typography: "s3", fontWeight: 600, mb: 0.5 }}>
          {label}
          {required && <Box component="span" sx={{ color: "error.main", ml: 0.5 }}>*</Box>}
        </Typography>
      )}
      <TextField
        fullWidth
        size="small"
        value={text}
        placeholder={placeholder || "vault://acme/sim/api_key"}
        onChange={(e) => take(e.target.value)}
        onBlur={() => setTouched(true)}
        error={refused}
        inputProps={{ spellCheck: false, autoComplete: "off", "aria-label": typeof label === "string" ? `${label} reference` : "Secret reference" }}
        InputProps={store ? {
          endAdornment: (
            <InputAdornment position="end">
              <Typography noWrap sx={{ typography: "s3", color: "text.subtitle" }}>{store.label}</Typography>
            </InputAdornment>
          ),
        } : undefined}
        sx={{ "& .MuiInputBase-input": { typography: "s2", fontFamily: MONO } }}
      />
      {refused ? (
        <Typography role="alert" sx={{ typography: "s3", color: "error.main", mt: 0.5 }}>{RAW_KEY_MESSAGE}</Typography>
      ) : dense && !formatError ? null : (
        <Typography sx={{ typography: "s3", color: formatError ? "text.secondary" : "text.subtitle", mt: 0.5 }}>
          {demoRef ? `Saved as ${demoRef} — the key you typed isn't kept.` : formatError || helper || HELPER}
        </Typography>
      )}
    </Box>
  );
}

SecretRefField.propTypes = {
  label: PropTypes.node,
  required: PropTypes.bool,
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  placeholder: PropTypes.string,
  helper: PropTypes.node,
  fullWidth: PropTypes.bool,
  /* In a list of several: no helper line unless something's wrong. */
  dense: PropTypes.bool,
};
