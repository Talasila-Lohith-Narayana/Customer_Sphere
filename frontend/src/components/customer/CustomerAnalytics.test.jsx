import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CustomerAnalytics from "./CustomerAnalytics";
import { analyticsService } from "../../services/api";

describe("CustomerAnalytics", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders customer CLV and a tailored campaign recommendation", async () => {
    vi.spyOn(analyticsService, "customerClv").mockResolvedValue({
      clv: 1058.92,
      value_tier: "High",
      segment_label: "High-Value Satisfied Repeat Buyers",
      purchase_frequency_per_year: 8.36,
      customer_lifespan_years: 0.97,
      churn_probability: 0.2222,
      risk_tier: "Low Risk",
    });
    vi.spyOn(analyticsService, "customerCampaign").mockResolvedValue({
      campaign_name: "VIP Loyalty Recognition Program",
      campaign_priority: 3,
      reason_code: "RC03",
      reason: "Recognize the customer's loyalty.",
      source: "database",
    });
    vi.spyOn(analyticsService, "customerDelivery").mockResolvedValue({
      summary: {
        delivered_orders: 2,
        avg_delivery_days: 11.5,
        on_time_pct: 50,
        late_pct: 50,
      },
      deliveries: [
        {
          order_id: "order_1",
          purchased_at: "2018-01-01",
          delivered_at: "2018-01-10",
          delivery_days: 9,
          delivery_status: "On time",
        },
      ],
    });
    vi.spyOn(analyticsService, "customerRisk").mockResolvedValue({
      customer_unique_id: "unique_123",
      risk_tier: "Low Risk",
      churn_probability: 0.2222,
    });
    vi.spyOn(analyticsService, "customerExplanation").mockResolvedValue({
      customer_unique_id: "unique_123",
      churn_probability: 0.2222,
      shap_values: { avg_review_score: -0.14, freight_ratio: 0.08 },
      reason_codes: [{ code: "RC01", message: "Positive reviews lower risk." }],
      model_version: "v1",
      scored_at: "2025-03-01T10:00:00Z",
    });

    render(<CustomerAnalytics customerUniqueId="unique_123" />);

    expect(await screen.findByText("VIP Loyalty Recognition Program")).toBeInTheDocument();
    expect(screen.getByText("R$ 1,058.92")).toBeInTheDocument();
    expect(screen.getByText("8.36 orders/year")).toBeInTheDocument();
    expect(screen.getByText(/22\.2% · Low Risk/)).toBeInTheDocument();
    expect(document.querySelector(".churnRiskLabel .churnDot.low")).toBeInTheDocument();
    expect(screen.getByText("Reason code RC03")).toBeInTheDocument();
    expect(screen.getByText("11.5 days")).toBeInTheDocument();
    expect(screen.getByText("order_1")).toBeInTheDocument();
    expect(screen.getByText("Churn explanation")).toBeInTheDocument();
    expect(screen.getByText("Positive reviews lower risk.")).toBeInTheDocument();
    expect(screen.getByText("Stored churn risk")).toBeInTheDocument();
  });

  it("isolates endpoint errors and retries a failed campaign recommendation", async () => {
    const customerCampaign = vi
      .spyOn(analyticsService, "customerCampaign")
      .mockRejectedValueOnce(new Error("Campaign unavailable"))
      .mockResolvedValueOnce({
        campaign_name: "Repeat Purchase Incentive Program",
        campaign_priority: 2,
        reason_code: "RC04",
        reason: "Encourage another purchase.",
        source: "rules",
      });
    vi.spyOn(analyticsService, "customerClv").mockResolvedValue({
      clv: 275,
      value_tier: "Medium",
    });
    vi.spyOn(analyticsService, "customerDelivery").mockResolvedValue({
      summary: { delivered_orders: 0 },
      deliveries: [],
    });
    vi.spyOn(analyticsService, "customerRisk").mockResolvedValue({
      risk_tier: "Medium Risk",
      churn_probability: 0.4,
    });
    vi.spyOn(analyticsService, "customerExplanation").mockResolvedValue({
      reason_codes: [],
      shap_values: {},
    });

    render(<CustomerAnalytics customerUniqueId="unique_123" />);

    expect(await screen.findByText("Campaign unavailable")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry Retention recommendation" }));

    await waitFor(() => {
      expect(customerCampaign).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Repeat Purchase Incentive Program")).toBeInTheDocument();
    });
  });
});
