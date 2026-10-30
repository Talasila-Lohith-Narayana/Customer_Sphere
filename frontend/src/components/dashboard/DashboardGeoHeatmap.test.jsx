import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DashboardGeoHeatmap from "./DashboardGeoHeatmap";
import * as ApiModule from "../../services/api";

const mockGeoDistribution = [
  {
    state: "SP",
    name: "São Paulo",
    region: "Southeast",
    capital: "São Paulo",
    customers: 40000,
    orders: 41000,
    revenue: 5900000,
    aov: 143.9,
    pct_revenue: 37.5,
    pct_customers: 42.4,
    pct_orders: 41.5,
  },
  {
    state: "RJ",
    name: "Rio de Janeiro",
    region: "Southeast",
    capital: "Rio de Janeiro",
    customers: 12000,
    orders: 12500,
    revenue: 2100000,
    aov: 168.0,
    pct_revenue: 13.5,
    pct_customers: 12.8,
    pct_orders: 12.6,
  },
  {
    state: "MG",
    name: "Minas Gerais",
    region: "Southeast",
    capital: "Belo Horizonte",
    customers: 11000,
    orders: 11500,
    revenue: 1850000,
    aov: 160.8,
    pct_revenue: 11.8,
    pct_customers: 11.6,
    pct_orders: 11.6,
  },
];

const mockTopCities = [
  { city: "sao paulo", state: "SP", customers: 14984, orders: 15540, revenue: 2203373.09 },
  { city: "rio de janeiro", state: "RJ", customers: 6620, orders: 6882, revenue: 1161927.36 },
];

describe("DashboardGeoHeatmap Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(ApiModule.dashboardService, "stateDetail").mockResolvedValue({
      state: "SP",
      name: "São Paulo",
      region: "Southeast",
      capital: "São Paulo",
      customers: 40000,
      orders: 41000,
      revenue: 5900000,
      aov: 143.9,
      avg_delivery_days: 8.5,
      avg_rating: 4.15,
      top_cities: [
        { city: "sao paulo", customers: 15000, orders: 15500, revenue: 2200000 },
        { city: "campinas", customers: 1400, orders: 1450, revenue: 216000 },
      ],
      top_categories: [{ category: "health_beauty", purchases: 5000 }],
    });
  });

  it("renders panel header and metric toggle buttons", async () => {
    render(
      <DashboardGeoHeatmap
        geoDistribution={mockGeoDistribution}
        topCities={mockTopCities}
        navigate={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByText("Brazilian Market Geolocation Heatmap")
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: /customers/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /orders/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /revenue/i })).toBeInTheDocument();
  });

  it("renders SVG map with Brazilian states", async () => {
    const { container } = render(
      <DashboardGeoHeatmap
        geoDistribution={mockGeoDistribution}
        topCities={mockTopCities}
        navigate={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(container.querySelector("svg.geoSvgMap")).toBeInTheDocument();
    });

    // Check that state elements exist
    const spElement = container.querySelector("#state-SP");
    const rjElement = container.querySelector("#state-RJ");
    expect(spElement).toBeInTheDocument();
    expect(rjElement).toBeInTheDocument();
  });

  it("switches active metric when metric buttons are clicked", async () => {
    render(
      <DashboardGeoHeatmap
        geoDistribution={mockGeoDistribution}
        topCities={mockTopCities}
        navigate={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /revenue/i })).toBeInTheDocument();
    });

    const revBtn = screen.getByRole("tab", { name: /revenue/i });
    fireEvent.click(revBtn);
    expect(revBtn).toHaveClass("active");

    const ordersBtn = screen.getByRole("tab", { name: /orders/i });
    fireEvent.click(ordersBtn);
    expect(ordersBtn).toHaveClass("active");
  });

  it("loads and displays state intelligence details after selecting a state", async () => {
    const { container } = render(
      <DashboardGeoHeatmap
        geoDistribution={mockGeoDistribution}
        topCities={mockTopCities}
        navigate={vi.fn()}
      />
    );

    fireEvent.click(container.querySelector("#state-SP"));

    await waitFor(() => {
      expect(screen.getByText("São Paulo")).toBeInTheDocument();
      expect(screen.getByText("Southeast Region")).toBeInTheDocument();
      expect(screen.getByText("Capital: São Paulo")).toBeInTheDocument();
      expect(screen.getByText("Top Cities in São Paulo")).toBeInTheDocument();
    });
    expect(ApiModule.dashboardService.stateDetail).toHaveBeenCalledWith(
      "SP",
      { timeframe: "all" },
    );
  });

  it("starts with the national overview without requesting state details", async () => {
    render(
      <DashboardGeoHeatmap
        geoDistribution={mockGeoDistribution}
        topCities={mockTopCities}
        navigate={vi.fn()}
      />
    );

    expect(screen.getByText("National Market Overview")).toBeInTheDocument();
    expect(screen.getByText("Top States Leaderboard")).toBeInTheDocument();
    expect(ApiModule.dashboardService.stateDetail).not.toHaveBeenCalled();
  });

  it("allows switching from a selected state to national overview", async () => {
    const { container } = render(
      <DashboardGeoHeatmap
        geoDistribution={mockGeoDistribution}
        topCities={mockTopCities}
        navigate={vi.fn()}
      />
    );

    fireEvent.click(container.querySelector("#state-SP"));
    await screen.findByText("Top Cities in São Paulo");
    fireEvent.click(screen.getByText("Overview"));

    expect(screen.getByText("National Market Overview")).toBeInTheDocument();
    expect(screen.getByText("Top States Leaderboard")).toBeInTheDocument();
  });

  it("handles empty or missing geoDistribution gracefully", async () => {
    render(<DashboardGeoHeatmap geoDistribution={[]} topCities={[]} />);
    await waitFor(() => {
      expect(
        screen.getByText("Brazilian Market Geolocation Heatmap")
      ).toBeInTheDocument();
    });
  });
});
