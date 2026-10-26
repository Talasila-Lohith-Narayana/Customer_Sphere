import React from "react";
import {
  flexRender,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";

/**
 * Shared headless table renderer. Callers keep ownership of data fetching,
 * pagination, and styling while TanStack owns row and cell modeling.
 */
export default function DataTable({
  columns,
  data = [],
  emptyMessage = "No data available.",
  getRowProps,
}) {
  const table = useTable({
    data,
    columns,
    features: tableFeatures({}),
  });
  const getColumnLabel = (column) => {
    const header = column.columnDef.header;
    return typeof header === "string"
      ? header
      : column.id.replaceAll("_", " ");
  };

  return (
    <table
      className="dataTable"
      tabIndex={0}
      aria-label="Data table. Scroll horizontally to view more columns."
    >
      <thead>
        {table.getHeaderGroups().map((headerGroup) => (
          <tr key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <th key={header.id}>
                {header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext())}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.length > 0 ? (
          table.getRowModel().rows.map((row) => (
            <tr key={row.id} {...(getRowProps ? getRowProps(row.original) : {})}>
              {row.getAllCells().map((cell) => (
                <td key={cell.id} data-label={getColumnLabel(cell.column)}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={table.getAllLeafColumns().length} style={{ textAlign: "center", padding: "30px 0", color: "#64748b" }}>
              {emptyMessage}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
