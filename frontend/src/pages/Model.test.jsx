import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Model from "./Model";
import { analyticsService } from "../services/api";

describe("Model diagnostics", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows available feature diagnostics and honest empty states for missing reports", async () => {
    vi.spyOn(analyticsService, "modelPerformance").mockResolvedValue({
      model_name: "LightGBM",
      split_evaluated: "test",
      metrics: { roc_auc: null, pr_auc: null, precision: null, recall: null },
    });
    vi.spyOn(analyticsService, "modelComparison").mockResolvedValue({
      comparison_table: [],
      summary_winner: null,
    });
    vi.spyOn(analyticsService, "modelImbalanceExperiments").mockResolvedValue({
      strategies: [{
        strategy: "weighted",
        tuned_threshold: 0.4,
        balanced_accuracy: 0.8,
        churn_recall: "75.0%",
        churn_precision: 0.6,
        pr_auc: 0.5,
      }],
    });
    vi.spyOn(analyticsService, "churnOverview").mockResolvedValue({
      summary: {
        total_customers: 50,
        avg_churn_probability: 0.2,
        predicted_churn_customers: 5,
        predicted_churn_rate: 0.1,
        threshold: 0.5,
        refreshed_at: "2025-03-01 10:00:00",
      },
      last_refresh: { last_refreshed_at: "2025-03-01 10:00:00" },
      probability_distribution: { total_customers: 0, bins: [] },
      reason_codes: { total_reason_codes: 0, reason_codes: [] },
      top_features: { scored_customers: 0, features: [] },
      feature_importance: { scored_customers: 0, features: [] },
    });
    render(<Model />);

    expect(await screen.findByText("Scored customers")).toBeInTheDocument();
    expect(await screen.findByText("20.0%", { selector: "strong" })).toBeInTheDocument();
    expect(await screen.findByText("Mar 1, 2025, 10:00 AM")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Advanced diagnostics" }));

    expect(await screen.findByText("Evaluation metrics are not available for this model.")).toBeInTheDocument();
    expect(screen.getByText("Model comparison data is not available.")).toBeInTheDocument();
    expect(screen.getByText("Class-imbalance experiments")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "60.0%" })).toBeInTheDocument();
  });
});
