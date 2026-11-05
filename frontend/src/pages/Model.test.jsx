import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Model from "./Model";
import { analyticsService } from "../services/api";

describe("Model diagnostics", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  const churnOverviewResponse = {
    summary: {
      total_customers: 50,
      avg_churn_probability: 0.2,
      predicted_churn_customers: 5,
      predicted_churn_rate: 0.1,
      threshold: 0.7,
      refreshed_at: "2025-03-01 10:00:00",
    },
    last_refresh: { last_refreshed_at: "2025-03-01 10:00:00" },
    probability_distribution: { total_customers: 0, bins: [] },
    reason_codes: { total_reason_codes: 0, reason_codes: [] },
    top_features: { scored_customers: 0, features: [] },
    feature_importance: { scored_customers: 0, features: [] },
  };

  it("loads each diagnostics panel only when it enters the viewport", async () => {
    const observers = [];
    class TestIntersectionObserver {
      constructor(callback) {
        this.callback = callback;
        this.target = null;
        observers.push(this);
      }
      observe(target) {
        this.target = target;
      }
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    const modelPerformance = vi
      .spyOn(analyticsService, "modelPerformance")
      .mockResolvedValue({ metrics: {} });
    const churnOverview = vi.spyOn(analyticsService, "churnOverview");

    render(<Model />);
    fireEvent.click(screen.getByRole("button", { name: "All" }));

    expect(modelPerformance).not.toHaveBeenCalled();
    expect(churnOverview).not.toHaveBeenCalled();
    expect(screen.getAllByText("Loads when this panel enters view").length).toBeGreaterThan(0);

    const performanceObserver = observers
      .filter((observer) => observer.target?.textContent.includes("Model test performance"))
      .pop();
    act(() => performanceObserver.callback([{ isIntersecting: true }]));

    await waitFor(() => expect(modelPerformance).toHaveBeenCalledTimes(1));
    expect(churnOverview).not.toHaveBeenCalled();
  });

  it("shares one in-flight request between visible panels using the same endpoint", async () => {
    const observers = [];
    class TestIntersectionObserver {
      constructor(callback) {
        this.callback = callback;
        this.target = null;
        observers.push(this);
      }
      observe(target) {
        this.target = target;
      }
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    const churnOverview = vi
      .spyOn(analyticsService, "churnOverview")
      .mockResolvedValue(churnOverviewResponse);
    render(<Model />);

    observers
      .filter((observer) => observer.target?.textContent.includes("Churn"))
      .slice(0, 2)
      .forEach((observer) => act(() => observer.callback([{ isIntersecting: true }])));

    await waitFor(() => expect(churnOverview).toHaveBeenCalledTimes(1));
  });

  it("shows a request error and lets the user retry that panel", async () => {
    const observers = [];
    class TestIntersectionObserver {
      constructor(callback) {
        this.callback = callback;
        this.target = null;
        observers.push(this);
      }
      observe(target) {
        this.target = target;
      }
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    const churnOverview = vi
      .spyOn(analyticsService, "churnOverview")
      .mockRejectedValueOnce(new Error("Prediction service unavailable"))
      .mockResolvedValue(churnOverviewResponse);
    render(<Model />);

    const overviewObserver = observers
      .filter((observer) => observer.target?.textContent.includes("Churn overview"))
      .pop();
    act(() => overviewObserver.callback([{ isIntersecting: true }]));

    expect(await screen.findByText("Prediction service unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry Churn overview" }));

    expect(await screen.findByText("Scored customers")).toBeInTheDocument();
    expect(churnOverview).toHaveBeenCalledTimes(2);
  });

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
    const churnOverview = vi.spyOn(analyticsService, "churnOverview").mockResolvedValue(churnOverviewResponse);
    render(<Model />);

    expect(await screen.findByText("Scored customers")).toBeInTheDocument();
    expect(await screen.findByText("High-risk customers")).toBeInTheDocument();
    expect(await screen.findByText("20.0%", { selector: "strong" })).toBeInTheDocument();
    expect(await screen.findByText("Mar 1, 2025, 10:00 AM")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh analytics data" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Refresh analytics data" }));
    await waitFor(() => {
      expect(churnOverview).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("button", { name: "Refresh analytics data" })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Advanced diagnostics" }));

    expect(await screen.findByText("Evaluation metrics are not available for this model.")).toBeInTheDocument();
    expect(screen.getByText("Model comparison data is not available.")).toBeInTheDocument();
    expect(screen.getByText("Class-imbalance experiments")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "60.0%" })).toBeInTheDocument();
  });
});
