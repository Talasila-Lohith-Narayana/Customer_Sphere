import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DashboardKpiCards from "./DashboardKpiCards";

describe("DashboardKpiCards Component", () => {
  const mockKpis = {
    customers: 96096,
    revenue: 16008872,
    orders: 99441,
    avg_order_value: 160.98,
    avg_delivery_days: 12.5,
    repeat_customers: 2997,
  };

  const mockRepeatRate = "3.1";
  const mockNavigate = vi.fn();

  it("renders all 6 executive KPI card titles correctly", () => {
    render(
      <DashboardKpiCards
        kpis={mockKpis}
        repeatRate={mockRepeatRate}
        navigate={mockNavigate}
      />
    );

    expect(screen.getByText("Total Customers")).toBeInTheDocument();
    expect(screen.getByText("Gross Revenue")).toBeInTheDocument();
    expect(screen.getByText("Total Orders")).toBeInTheDocument();
    expect(screen.getByText("Avg Order Value")).toBeInTheDocument();
    expect(screen.getByText("Avg Fulfillment")).toBeInTheDocument();
    expect(screen.getByText("Repeat Rate")).toBeInTheDocument();
    expect(screen.getByTitle(/yearly counts can overlap/i)).toBeInTheDocument();
  });

  it("displays properly formatted and localized metric values", () => {
    render(
      <DashboardKpiCards
        kpis={mockKpis}
        repeatRate={mockRepeatRate}
        navigate={mockNavigate}
      />
    );

    expect(screen.getByText("96,096")).toBeInTheDocument();
    expect(screen.getByText("R$ 16,008,872")).toBeInTheDocument();
    expect(screen.getByText("99,441")).toBeInTheDocument();
    expect(screen.getByText("R$ 160.98")).toBeInTheDocument();
    expect(screen.getByText("12.5 days")).toBeInTheDocument();
    expect(screen.getByText("3.1%")).toBeInTheDocument();
  });

  it("navigates to customer directory when clicking Total Customers card", () => {
    render(
      <DashboardKpiCards
        kpis={mockKpis}
        repeatRate={mockRepeatRate}
        navigate={mockNavigate}
      />
    );

    const customerCard = screen.getByTitle("Click to jump: View Directory");
    fireEvent.click(customerCard);

    expect(mockNavigate).toHaveBeenCalledWith("/customers");
  });

  it("navigates to top spenders when clicking Gross Revenue card", () => {
    render(
      <DashboardKpiCards
        kpis={mockKpis}
        repeatRate={mockRepeatRate}
        navigate={mockNavigate}
      />
    );

    const revenueCard = screen.getByTitle("Click to jump: Top Spenders");
    fireEvent.click(revenueCard);

    expect(mockNavigate).toHaveBeenCalledWith("/customers?sort=spend-desc");
  });

  it("navigates to remaining views when clicking other KPI cards", () => {
    render(
      <DashboardKpiCards
        kpis={mockKpis}
        repeatRate={mockRepeatRate}
        navigate={mockNavigate}
      />
    );

    // Total Orders
    fireEvent.click(screen.getByTitle("Click to jump: Active Buyers"));
    expect(mockNavigate).toHaveBeenCalledWith("/customers?activity=active");

    // Avg Order Value
    fireEvent.click(screen.getByTitle("Click to jump: Premium Catalog"));
    expect(mockNavigate).toHaveBeenCalledWith("/products?sort=price_desc");

    // Repeat Rate
    fireEvent.click(screen.getByTitle("Click to jump: Repeat customers"));
    expect(mockNavigate).toHaveBeenCalledWith("/customers?activity=active&min_orders=2");
  });

  it("handles empty or default kpi props gracefully", () => {
    render(
      <DashboardKpiCards
        repeatRate="0.0"
        navigate={mockNavigate}
      />
    );

    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("0.0%")).toBeInTheDocument();
  });

  it("displays correct repeat_rate delta badge from comparison rather than raw repeat_customers", () => {
    const mockComparison = {
      customers: { current: 74000, previous: 34000, pct_change: 117.6 },
      repeat_customers: { current: 2300, previous: 1000, pct_change: 130.0 },
      repeat_rate: { current: 3.1, previous: 2.9, delta: 0.2, pct_change: 6.9 },
    };

    render(
      <DashboardKpiCards
        kpis={mockKpis}
        repeatRate="3.1"
        navigate={mockNavigate}
        comparison={mockComparison}
      />
    );

    // Repeat rate should display 6.9%, NOT the 130% from raw repeat customer headcount
    expect(screen.getByText(/6\.9%/)).toBeInTheDocument();
    expect(screen.queryByText(/130%/)).not.toBeInTheDocument();
    expect(screen.getByTitle(/\+6\.9% \(\+0\.2 pp\) vs comparison period/)).toBeInTheDocument();
  });

  it("derives repeat rate percentage change when comparison only provides customers and repeat_customers", () => {
    const fallbackComparison = {
      customers: { current: 1000, previous: 1000, pct_change: 0.0 },
      repeat_customers: { current: 31, previous: 29, pct_change: 6.9 },
    };

    render(
      <DashboardKpiCards
        kpis={{ customers: 1000, repeat_customers: 31 }}
        repeatRate="3.1"
        navigate={mockNavigate}
        comparison={fallbackComparison}
      />
    );

    expect(screen.getByText(/6\.9%/)).toBeInTheDocument();
  });
});
