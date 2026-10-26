import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import DataTable from "./DataTable";

describe("DataTable", () => {
  it("provides a keyboard-focusable table and labels cells for compact layouts", () => {
    render(
      <DataTable
        columns={[
          { header: "Customer name", accessorKey: "name" },
          { header: "Orders", accessorKey: "orders" },
        ]}
        data={[{ name: "Ava", orders: 3 }]}
      />
    );

    const table = screen.getByRole("table", {
      name: "Data table. Scroll horizontally to view more columns.",
    });
    expect(table).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("cell", { name: "Ava" })).toHaveAttribute("data-label", "Customer name");
    expect(screen.getByRole("cell", { name: "3" })).toHaveAttribute("data-label", "Orders");
  });
});
