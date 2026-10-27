import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CustomerOverview from "./CustomerOverview";

describe("CustomerOverview Component", () => {
  const mockCustomer = {
    customer_id: "cust_123",
    segment: "High Risk",
    has_order_history: true,
    monetary_total: 1200.5,
    monetary_avg: 400.17,
    tenure_days: 145,
    weekend_order_ratio: 0.333,
    avg_order_value_per_day_active: 350.0,
    top_categories: [
      { label: "Electronics", share: 0.6 },
      { label: "Home", share: 0.4 },
    ],
    payment_preferences: [
      {
        type: "credit_card",
        label: "Credit Card",
        count: 3,
        share: 0.75,
        total_value: 900.0,
      },
      {
        type: "boleto",
        label: "Boleto",
        count: 1,
        share: 0.25,
        total_value: 300.5,
      },
    ],
  };

  it("renders behavior profile panel and signals", () => {
    render(<CustomerOverview customer={mockCustomer} />);

    expect(screen.getByText("Behavior profile")).toBeInTheDocument();
    expect(screen.getByText("Projected CLV")).toBeInTheDocument();
    expect(screen.getByText("Monetary avg")).toBeInTheDocument();
    expect(screen.getByText("Tenure")).toBeInTheDocument();
    expect(screen.getByText("Weekend ratio")).toBeInTheDocument();
    expect(screen.queryByText("ML Segment")).not.toBeInTheDocument();

    // Projected CLV is based on the customer's realized monetary total.
    expect(screen.getByText("R$ 1,200.50")).toBeInTheDocument();
    expect(screen.getByText("145 days")).toBeInTheDocument();
    expect(screen.getByText("33.3%")).toBeInTheDocument();
  });

  it("renders dynamic category preferences and percentages", () => {
    render(<CustomerOverview customer={mockCustomer} />);

    expect(screen.getByText("Category preferences")).toBeInTheDocument();
    expect(screen.getByText("Electronics")).toBeInTheDocument();
    expect(screen.getByText("60.0%")).toBeInTheDocument();
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("40.0%")).toBeInTheDocument();
  });

  it("aligns a model-colored dot with the churn risk label", () => {
    render(
      <CustomerOverview
        customer={mockCustomer}
        predictions={{
          has_ml_data: true,
          churn: { risk_level: "medium", percentage: 42 },
        }}
      />
    );

    expect(document.querySelector(".churnBadge .churnDot.medium")).toBeInTheDocument();
  });

  it("renders payment preferences cards with amounts and order counts", () => {
    render(<CustomerOverview customer={mockCustomer} />);

    expect(screen.getByText("Payment preferences")).toBeInTheDocument();
    expect(screen.getByText("Credit Card")).toBeInTheDocument();
    expect(screen.getByText("3 orders (75%)")).toBeInTheDocument();
    expect(screen.getByText("R$ 900.00")).toBeInTheDocument();
    expect(screen.getByText("Boleto")).toBeInTheDocument();
    expect(screen.getByText("1 order (25%)")).toBeInTheDocument();
    expect(screen.getByText("R$ 300.50")).toBeInTheDocument();
  });

  it("handles customers without order history cleanly", () => {
    const emptyCustomer = {
      has_order_history: false,
      top_categories: [],
      payment_preferences: [],
    };

    render(<CustomerOverview customer={emptyCustomer} />);

    expect(screen.getByText("No category history recorded.")).toBeInTheDocument();
    expect(screen.getByText("No payment history recorded.")).toBeInTheDocument();
  });
});
