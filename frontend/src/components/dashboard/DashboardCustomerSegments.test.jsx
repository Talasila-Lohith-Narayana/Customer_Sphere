import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import DashboardCustomerSegments from "./DashboardCustomerSegments";

describe("DashboardCustomerSegments Component", () => {
  const mockSegments = [
    { segment: "High Risk", count: 1200 },
    { segment: "Medium Risk", count: 4500 },
    { segment: "Low Risk", count: 800 },
  ];

  it("renders model-predicted churn bands and subtitle", () => {
    render(
      <DashboardCustomerSegments
        segments={mockSegments}
        navigate={vi.fn()}
      />
    );

    expect(screen.getByText("Predicted churn risk")).toBeInTheDocument();
    expect(
      screen.getByText(/Model probability bands/i)
    ).toBeInTheDocument();
  });

  it("renders properly with default empty segments array", () => {
    render(<DashboardCustomerSegments />);
    expect(screen.getByText("Predicted churn risk")).toBeInTheDocument();
  });
});
