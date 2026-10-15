/* PRD v6: in v0 an eval's variable mapping is shown and removable, not edited. */
export const MAPPING_NOTE = "Mapping is set from the environment; you can remove one, not edit it, in this version.";

/** The mapping with one variable taken out. */
export const mappingWithout = (mapping, variable) =>
  Object.fromEntries(Object.entries(mapping || {}).filter(([v]) => v !== variable));
