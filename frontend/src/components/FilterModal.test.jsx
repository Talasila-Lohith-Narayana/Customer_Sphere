import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FilterModal from "./FilterModal";

describe("FilterModal Component", () => {
  const mockValues = {
    state: "SP",
    activity: "active",
    ratings: ["5"],
    churnRisk: ["high"],
    maxRecency: "30",
    minSpend: "500",
    minOrders: "2",
  };

  const mockStates = ["SP", "RJ", "MG"];
  const mockActivityOptions = [
    ["", "All activity"],
    ["active", "Has orders"],
    ["inactive", "No orders"],
  ];

  it("renders filter modal with current filter values", () => {
    render(
      <FilterModal
        values={mockValues}
        states={mockStates}
        activityOptions={mockActivityOptions}
        close={vi.fn()}
        apply={vi.fn()}
      />
    );

    expect(screen.getByText("Filter customers")).toBeInTheDocument();
    expect(screen.getByDisplayValue("SP")).toBeInTheDocument();
    expect(screen.getByDisplayValue("500")).toBeInTheDocument();
  });

  it("submits updated draft filters on Apply", () => {
    const mockApply = vi.fn();

    render(
      <FilterModal
        values={mockValues}
        states={mockStates}
        activityOptions={mockActivityOptions}
        close={vi.fn()}
        apply={mockApply}
      />
    );

    const applyBtn = screen.getByRole("button", { name: "Apply filters" });
    fireEvent.click(applyBtn);

    expect(mockApply).toHaveBeenCalledWith(expect.objectContaining({
      state: "SP",
      churnRisk: ["high"],
      minSpend: "500",
    }));
  });

  it("clears filters when clicking Clear all button", () => {
    render(
      <FilterModal
        values={mockValues}
        states={mockStates}
        activityOptions={mockActivityOptions}
        close={vi.fn()}
        apply={vi.fn()}
      />
    );

    const clearBtn = screen.getByRole("button", { name: "Clear all" });
    fireEvent.click(clearBtn);

    expect(screen.getByPlaceholderText("R$ amount").value).toBe("");
  });

  it("updates customer and model-risk filters", () => {
    const mockApply = vi.fn();

    render(
      <FilterModal
        values={{
          state: "",
          activity: "",
          ratings: [],
          churnRisk: [],
          maxRecency: "",
          minSpend: "",
          minOrders: "",
        }}
        states={mockStates}
        activityOptions={mockActivityOptions}
        close={vi.fn()}
        apply={mockApply}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. SP/i), { target: { value: "rj" } });
    fireEvent.change(screen.getByLabelText(/Activity/i), { target: { value: "inactive" } });
    fireEvent.change(screen.getByPlaceholderText("Days"), { target: { value: "60" } });
    fireEvent.change(screen.getByPlaceholderText("R$ amount"), { target: { value: "250" } });
    fireEvent.change(screen.getByPlaceholderText("Order count"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /Medium \(30 to <70%\)/ }));

    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    expect(mockApply).toHaveBeenCalledWith({
      state: "RJ",
      activity: "inactive",
      ratings: [],
      churnRisk: ["medium"],
      maxRecency: "60",
      minSpend: "250",
      minOrders: "3",
    });
  });

  it("toggles rating pills to select and deselect ratings", () => {
    const mockApply = vi.fn();

    render(
      <FilterModal
        values={mockValues}
        states={mockStates}
        activityOptions={mockActivityOptions}
        close={vi.fn()}
        apply={mockApply}
      />
    );

    // Pill for 4 stars (currently unselected, clicking selects it)
    const fourStarBtn = screen.getByRole("button", { name: /4 stars/i });
    fireEvent.click(fourStarBtn);

    // Pill for 5 stars (currently selected in mockValues, clicking deselects it)
    const fiveStarBtn = screen.getByRole("button", { name: /5 stars/i });
    fireEvent.click(fiveStarBtn);

    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    expect(mockApply).toHaveBeenCalledWith(expect.objectContaining({
      ratings: ["4"],
    }));
  });

  it("triggers close when clicking cancel or close icon button", () => {
    const mockClose = vi.fn();

    const { rerender } = render(
      <FilterModal
        values={mockValues}
        states={mockStates}
        activityOptions={mockActivityOptions}
        close={mockClose}
        apply={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockClose).toHaveBeenCalledTimes(1);

    rerender(
      <FilterModal
        values={mockValues}
        states={mockStates}
        activityOptions={mockActivityOptions}
        close={mockClose}
        apply={vi.fn()}
      />
    );

    fireEvent.click(document.querySelector("button.close"));
    expect(mockClose).toHaveBeenCalledTimes(2);
  });

  it("handles empty values prop with missing ratings gracefully", () => {
    render(
      <FilterModal
        values={{}}
        states={mockStates}
        activityOptions={mockActivityOptions}
        close={vi.fn()}
        apply={vi.fn()}
      />
    );

    expect(screen.getByText("Filter customers")).toBeInTheDocument();
  });
});
