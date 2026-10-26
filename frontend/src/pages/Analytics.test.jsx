import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Analytics from "./Analytics";
import { analyticsService } from "../services/api";

describe("Analytics page", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders live analytics sections and their data", async () => {
    vi.spyOn(analyticsService, "clvSummary").mockResolvedValue({
      customers: 96095,
      avg_clv: 294.45,
      median_clv: 152.69,
      total_clv: 28295586,
    });
    vi.spyOn(analyticsService, "valueTiers").mockResolvedValue([
      { value_tier: "High", customers: 32032, pct_share: 33.33, avg_clv: 667.66 },
    ]);
    vi.spyOn(analyticsService, "cohortSummary").mockResolvedValue({
      count: 10,
      data: Array.from({ length: 10 }, (_, index) => {
        const month = index + 11;
        const year = month > 12 ? 2018 : 2017;
        const monthNumber = month > 12 ? month - 12 : month;
        const date = new Date(year, monthNumber - 1, 1);
        return {
          cohort: `${year}-${String(monthNumber).padStart(2, "0")}`,
          label: date.toLocaleString("en-US", { month: "short", year: "numeric" }),
          cohort_size: 42,
          months_observed: 10 - index,
          m1_retention_pct: 7.5,
          m3_retention_pct: null,
          cumulative_repeat_purchase_rate_pct: 11.2,
        };
      }),
    });
    vi.spyOn(analyticsService, "deliveryPerformance").mockResolvedValue({
      summary: {
        delivered_orders: 96473,
        avg_delivery_days: 12.5,
        on_time_pct: 91.9,
        late_pct: 8.1,
      },
      by_delivery_status: [],
    });
    vi.spyOn(analyticsService, "activeCampaigns").mockResolvedValue({
      active_campaigns: 13,
      customers_targeted: 93348,
      high_priority_customers: 36672,
      campaigns: [{
        campaign_name: "Priority Recovery",
        campaign_priority: 1,
        customer_count: 4936,
      }],
    });
    vi.spyOn(analyticsService, "campaignsBySegment").mockResolvedValue([]);
    vi.spyOn(analyticsService, "modelVersion").mockResolvedValue({
      model_name: "LightGBM Classifier",
      timestamp: "20261006_122016",
      features_count: 13,
      features: ["monetary_value"],
      operating_point: { mode: "rate", value: 0.05 },
    });
    vi.spyOn(analyticsService, "modelCalibration").mockResolvedValue({
      selected_method: "isotonic",
      test_calibration_before: { brier_score: 0.0199, log_loss: 0.071, ece: 0.0208, mce: 0.3881 },
      test_calibration_after: { brier_score: 0.0153, log_loss: 0.0572, ece: 0, mce: 0 },
    });
    vi.spyOn(analyticsService, "churnDefinition").mockResolvedValue({
      reference_date: "2018-10-17",
      return_window_days: 180,
      definition_rule: "No repeat purchase within 180 days.",
      counts: {
        retained: 2512,
        churned: 66392,
        censored: 27191,
        churn_rate_uncensored_pct: 96.35,
      },
    });

    render(<Analytics />);

    expect(await screen.findByText("R$ 294.45")).toBeInTheDocument();
    expect(screen.getByText("R$ 28,295,586.00")).toBeInTheDocument();
    expect(screen.getByText("High value")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Cohort summary" }));
    await waitFor(() => expect(analyticsService.cohortSummary).toHaveBeenCalled());
    expect(await screen.findByText("Aug 2018")).toBeInTheDocument();
    expect(await screen.findByText("Nov 2017")).toBeInTheDocument();
    expect(await screen.findByText("All 10 acquisition months · newest first")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByRole("cell", { name: "42" })).toHaveLength(10);
    });

    fireEvent.click(screen.getByRole("tab", { name: "Customer value and retention" }));
    expect(await screen.findByText("12.5 days")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Campaigns" }));
    expect(await screen.findByText("Priority Recovery")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Model diagnostics" }));
    expect(await screen.findByText("LightGBM Classifier")).toBeInTheDocument();
    expect(screen.getByText("Oct 6, 2026, 12:20")).toBeInTheDocument();
    expect(await screen.findByText(/Selected method: isotonic/)).toBeInTheDocument();
    expect(await screen.findByText("No repeat purchase within 180 days.")).toBeInTheDocument();
  });

  it("keeps working panels visible and retries a failed analytics endpoint", async () => {
    const activeCampaigns = vi
      .spyOn(analyticsService, "activeCampaigns")
      .mockRejectedValueOnce(new Error("Campaign service unavailable"))
      .mockResolvedValueOnce({
        active_campaigns: 0,
        customers_targeted: 0,
        high_priority_customers: 0,
        campaigns: [],
      });
    vi.spyOn(analyticsService, "clvSummary").mockResolvedValue({});
    vi.spyOn(analyticsService, "valueTiers").mockResolvedValue([]);
    vi.spyOn(analyticsService, "cohortSummary").mockResolvedValue({ data: [] });
    vi.spyOn(analyticsService, "deliveryPerformance").mockResolvedValue({ summary: {}, by_delivery_status: [] });
    vi.spyOn(analyticsService, "campaignsBySegment").mockResolvedValue([]);
    vi.spyOn(analyticsService, "modelVersion").mockResolvedValue({});
    vi.spyOn(analyticsService, "modelCalibration").mockResolvedValue({});
    vi.spyOn(analyticsService, "churnDefinition").mockResolvedValue({});

    render(<Analytics />);

    fireEvent.click(screen.getByRole("tab", { name: "Campaigns" }));
    expect(await screen.findByText("Campaign service unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry Active campaign reach" }));

    await waitFor(() => {
      expect(activeCampaigns).toHaveBeenCalledTimes(2);
      expect(screen.getByText("No active campaigns were returned.")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("tab", { name: "Customer value and retention" }));
    expect(screen.getByText("Value tiers")).toBeInTheDocument();
  });

  it("reloads the selected analytics section and reports when data was loaded", async () => {
    const clvSummary = vi.spyOn(analyticsService, "clvSummary").mockResolvedValue({
      customers: 10,
      avg_clv: 25,
      median_clv: 20,
      total_clv: 250,
    });
    vi.spyOn(analyticsService, "valueTiers").mockResolvedValue([]);
    vi.spyOn(analyticsService, "deliveryPerformance").mockResolvedValue({ summary: {}, by_delivery_status: [] });

    render(<Analytics />);

    await screen.findByText("R$ 25.00");
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh analytics data" })).toBeEnabled());
    expect(screen.getByText(/^Last loaded:/)).not.toHaveTextContent("Not loaded yet");
    fireEvent.click(screen.getByRole("button", { name: "Refresh analytics data" }));

    await waitFor(() => {
      expect(clvSummary).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("button", { name: "Refresh analytics data" })).toBeEnabled();
    });
  });
});
