import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CustomerAiInsights from "./CustomerAiInsights";

function makePredictions(overrides = {}) {
  return {
    has_ml_data: true,
    is_realtime_score: true,
    churn: {
      percentage: 12.3,
      risk_level: "low",
      model_version: "v1",
      scored_at: "2025-03-01T10:00:00.000Z",
    },
    explainability: { shap_drivers: [], reason_codes: [] },
    ...overrides,
  };
}

describe("CustomerAiInsights", () => {
  it("explains SHAP direction and shows live score freshness", () => {
    render(<CustomerAiInsights predictions={makePredictions()} />);

    expect(screen.getByText("Live score")).toBeInTheDocument();
    expect(screen.getByText(/Scored: .*2025/)).toBeInTheDocument();
    expect(document.querySelector(".aiBadge .churnDot.low")).toBeInTheDocument();
    expect(
      screen.getByText(/SHAP values are contributions, not percentage points/),
    ).toBeInTheDocument();
  });

  it("marks saved pipeline scores as potentially stale", () => {
    render(
      <CustomerAiInsights
        predictions={makePredictions({ is_realtime_score: false })}
      />,
    );

    expect(
      screen.getByText("Saved pipeline score (may not reflect latest activity)"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Scored: .*2025/)).toBeInTheDocument();
  });

  it("reports when a score timestamp is unavailable", () => {
    render(
      <CustomerAiInsights
        predictions={makePredictions({
          churn: { percentage: 12.3, risk_level: "low", model_version: "v1" },
        })}
      />,
    );

    expect(screen.getByText("Scored: Time unavailable")).toBeInTheDocument();
  });

  it("shows each returned SHAP feature with its model input", () => {
    const shapDrivers = Array.from({ length: 13 }, (_, index) => ({
      feature: `feature_${index}`,
      label: `Feature ${index}`,
      impact: index / 100,
      direction: index ? "increases_risk" : "lowers_risk",
      feature_value: index,
    }));
    render(
      <CustomerAiInsights
        predictions={makePredictions({
          explainability: { shap_drivers: shapDrivers, reason_codes: [] },
        })}
      />,
    );

    expect(screen.getByText("Feature 12")).toBeInTheDocument();
    expect(screen.getByText("Model input: 12.0000")).toBeInTheDocument();
    expect(screen.getAllByText(/Model input:/)).toHaveLength(13);
  });

  it("explains when saved SHAP values have no stored model inputs", () => {
    render(
      <CustomerAiInsights
        predictions={makePredictions({
          explainability: {
            shap_drivers: [{
              feature: "avg_review_score",
              label: "Avg Review Score",
              impact: -0.1,
              direction: "lowers_risk",
            }],
            reason_codes: [],
          },
        })}
      />,
    );

    expect(
      screen.getByText("Model input: unavailable — run the model to capture it"),
    ).toBeInTheDocument();
  });
});
