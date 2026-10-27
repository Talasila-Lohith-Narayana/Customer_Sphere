import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Dashboard from "./Dashboard";
import * as ApiModule from "../services/api";

const mockDashboardData = {
  kpis: {
    customers: 96000,
    revenue: 16000000,
    orders: 99000,
    avg_order_value: 160.0,
    avg_delivery_days: 12.0,
    repeat_customers: 3000,
    avg_rating: 4.1,
  },
  top_states: [{ state: "SP", revenue: 5000000, customers: 40000 }],
  monthly: [{ month: "2018-01", revenue: 1000000, orders: 6000 }],
  segments: [{ segment: "High Risk", count: 1200 }],
  payments: [{ type: "credit_card", total_value: 1000000, count: 5000 }],
  ratings_dist: [{ stars: 5, count: 5000 }],
  categories: [{ category: "health_beauty", purchases: 1000 }],
};

describe("Dashboard Page Orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("displays loading state initially", () => {
    vi.spyOn(ApiModule.dashboardService, "summary").mockReturnValue(
      new Promise(() => {})
    );

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    expect(screen.getByText("Executive Business Overview")).toBeInTheDocument();
    expect(screen.getByText("Loading key metrics...")).toBeInTheDocument();
  });

  it("displays error state when dashboard data fails to load and supports retry", async () => {
    const spy = vi
      .spyOn(ApiModule.dashboardService, "summary")
      .mockRejectedValueOnce(new Error("Database connection lost"))
      .mockResolvedValueOnce(mockDashboardData);

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
      expect(screen.getByText("Database connection lost")).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(spy).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Executive Business Overview")).toBeInTheDocument();
    });
  });

  it("renders full dashboard widgets once data loads and handles time horizon switches", async () => {
    const spy = vi.spyOn(ApiModule.dashboardService, "summary").mockResolvedValue(
      mockDashboardData
    );
    vi.spyOn(ApiModule.dashboardService, "section").mockImplementation((section) => {
      if (section === "trends") {
        return Promise.resolve({
          monthly: mockDashboardData.monthly,
          segments: mockDashboardData.segments,
        });
      }
      if (section === "geography") {
        return Promise.resolve({
          geo_distribution: mockDashboardData.top_states,
          top_states: mockDashboardData.top_states,
          top_cities: [],
        });
      }
      throw new Error(`Unexpected deferred section request: ${section}`);
    });
    vi.spyOn(ApiModule.dashboardService, "stateDetail").mockResolvedValue({
      top_cities: [],
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Executive Business Overview")).toBeInTheDocument();
      expect(screen.getByText("Total Customers")).toBeInTheDocument();
      expect(screen.getByText("Revenue growth trend")).toBeInTheDocument();
      expect(screen.getByText("Predicted churn risk")).toBeInTheDocument();
      expect(screen.getByText("Brazilian Market Geolocation Heatmap")).toBeInTheDocument();
      expect(screen.queryByText("Regional distribution")).not.toBeInTheDocument();
      expect(screen.queryByText("Payment methods")).not.toBeInTheDocument();
      expect(screen.queryByText("Review distribution")).not.toBeInTheDocument();
      expect(screen.queryByText("Top product categories")).not.toBeInTheDocument();
    });

    // Switch timeframe to 2018
    const btn2018 = screen.getByRole("button", { name: "Year 2018" });
    fireEvent.click(btn2018);

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({ timeframe: "2018", sections: "core" });
    });

    // Switch to Custom Range
    const customBtn = screen.getByRole("button", { name: "Custom Range" });
    fireEvent.click(customBtn);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Apply Range" })).toBeInTheDocument();
    });

    const applyBtn = screen.getByRole("button", { name: "Apply Range" });
    fireEvent.click(applyBtn);

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({
        timeframe: "custom",
        start_date: "2017-01-01",
        end_date: "2018-08-31",
        sections: "core",
      });
    });
  });

  it("loads only dashboard sections that approach the viewport", async () => {
    const observers = [];
    class TestIntersectionObserver {
      constructor(callback) {
        this.callback = callback;
        observers.push(this);
      }
      observe() {}
      disconnect() {}
      trigger() {
        this.callback([{ isIntersecting: true }]);
      }
    }
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    const sectionSpy = vi.spyOn(ApiModule.dashboardService, "section").mockResolvedValue({});
    vi.spyOn(ApiModule.dashboardService, "summary").mockResolvedValue(mockDashboardData);

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    await waitFor(() => expect(observers.length).toBe(2));
    expect(sectionSpy).not.toHaveBeenCalled();

    act(() => observers[0].trigger());
    await waitFor(() => expect(sectionSpy).toHaveBeenCalledTimes(1));
  });

  it("refreshes dashboard data every minute", async () => {
    const intervalSpy = vi.spyOn(window, "setInterval");
    const summarySpy = vi.spyOn(ApiModule.dashboardService, "summary").mockResolvedValue(
      mockDashboardData
    );
    vi.spyOn(ApiModule.dashboardService, "section").mockResolvedValue({});

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Total Customers")).toBeInTheDocument();
    });
    const pollInterval = intervalSpy.mock.calls.find(([, delay]) => delay === 60_000);
    expect(pollInterval).toBeDefined();
    intervalSpy.mockRestore();

    summarySpy.mockClear();
    act(() => pollInterval[0]());
    await waitFor(() => expect(summarySpy).toHaveBeenCalledTimes(1));
  });

  it("refreshes dashboard data when another tab reports a data change", async () => {
    const observers = [];
    class TestBroadcastChannel {
      static channels = [];

      constructor(name) {
        this.name = name;
        this.listeners = new Set();
        this.closed = false;
        TestBroadcastChannel.channels.push(this);
      }
      addEventListener(type, listener) {
        if (type === "message") this.listeners.add(listener);
      }
      removeEventListener(type, listener) {
        if (type === "message") this.listeners.delete(listener);
      }
      postMessage(data) {
        TestBroadcastChannel.channels
          .filter((candidate) => candidate !== this && !candidate.closed && candidate.name === this.name)
          .forEach((candidate) => {
            candidate.listeners.forEach((listener) => listener({ data }));
          });
      }
      close() {
        this.closed = true;
        this.listeners.clear();
      }
    }
    class TestIntersectionObserver {
      constructor(callback) {
        this.callback = callback;
        observers.push(this);
      }
      observe() {}
      disconnect() {}
      trigger() {
        this.callback([{ isIntersecting: true }]);
      }
    }
    vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    const summarySpy = vi.spyOn(ApiModule.dashboardService, "summary").mockResolvedValue(
      mockDashboardData
    );
    const sectionSpy = vi.spyOn(ApiModule.dashboardService, "section").mockResolvedValue({});
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    await waitFor(() => expect(summarySpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(observers).toHaveLength(2));
    act(() => observers.forEach((observer) => observer.trigger()));
    await waitFor(() => expect(sectionSpy).toHaveBeenCalledTimes(2));

    const otherTab = new TestBroadcastChannel("customer-sphere-dashboard-data");
    act(() => otherTab.postMessage({ timestamp: Date.now() }));

    await waitFor(() => expect(summarySpy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(sectionSpy).toHaveBeenCalledTimes(4));
  });

  it("handles empty/zero customer metrics gracefully", async () => {
    vi.spyOn(ApiModule.dashboardService, "summary").mockResolvedValue({
      ...mockDashboardData,
      kpis: {
        customers: 0,
        revenue: 0,
        orders: 0,
        repeat_customers: 0,
      },
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Executive Business Overview")).toBeInTheDocument();
      expect(screen.getByText("0.0%")).toBeInTheDocument();
    });
  });
});
