import PropTypes from "prop-types";
import { Box } from "@mui/material";
import { DataTable } from "src/components/data-table";

/* DataTable leaves an empty-state overlay at least this tall. */
const EMPTY_HEIGHT = 200;

/**
 * The product's DataTable, sized to its rows — for a short table inside a
 * page that scrolls, where there's no fixed-height pane for the grid to fill.
 * Same columns API as DataTable; sorting is off unless a column asks for it.
 */
export default function FitDataTable({ columns, data, rowHeight = 44, headerHeight = 40, ...rest }) {
  const rows = data || [];
  const height = headerHeight + (rows.length ? rows.length * rowHeight : EMPTY_HEIGHT) + 2;
  return (
    <Box sx={{ height }}>
      <DataTable
        columns={columns.map((c) => ({ enableSorting: false, ...c }))}
        data={rows}
        rowCount={rows.length}
        rowHeight={rowHeight}
        headerHeight={headerHeight}
        {...rest}
      />
    </Box>
  );
}
FitDataTable.propTypes = {
  columns: PropTypes.array.isRequired, data: PropTypes.array, rowHeight: PropTypes.number, headerHeight: PropTypes.number,
};
