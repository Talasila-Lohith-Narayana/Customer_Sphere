import React from "react";
import { Panel } from "../States";

export const PAYMENT_ICONS = {
  credit_card: "💳",
  boleto: "📄",
  voucher: "🎟️",
  debit_card: "🏧",
};

export default function CustomerOverview({ customer, predictions }) {
  const hasHistory = customer.has_order_history !== false;

  // Use dynamic top categories if provided, otherwise check static cat_shares
  let preferences = [];
  if (customer.top_categories && customer.top_categories.length > 0) {
    preferences = customer.top_categories.map((c) => [c.label, c.share]);
  } else {
    preferences = [
      ["Beauty", customer.cat_share_beauty],
      ["Books", customer.cat_share_books],
      ["Electronics", customer.cat_share_electronics],
      ["Fashion", customer.cat_share_fashion],
      ["Home", customer.cat_share_home],
      ["Sports", customer.cat_share_sports],
    ].filter((item) => item[1] != null);
  }

  const monetaryAvgDisplay =
    customer.monetary_avg != null && hasHistory
      ? `R$ ${Number(customer.monetary_avg).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "N/A";

  const tenureDisplay =
    customer.tenure_days != null && hasHistory
      ? `${customer.tenure_days} ${customer.tenure_days === 1 ? "day" : "days"}`
      : "N/A";

  const weekendRatioDisplay =
    customer.weekend_order_ratio != null && hasHistory
      ? `${(Number(customer.weekend_order_ratio) * 100).toFixed(1)}%`
      : "N/A";

  const activeDayAovDisplay =
    customer.avg_order_value_per_day_active != null && hasHistory
      ? `R$ ${Number(customer.avg_order_value_per_day_active).toFixed(2)}`
      : "N/A";

  const mlPredictedClv = predictions?.clv?.predicted_clv;
  const clvDisplay =
    mlPredictedClv != null
    ? `R$ ${Number(mlPredictedClv).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : hasHistory && customer.monetary_total != null
    ? `R$ ${Number(customer.monetary_total).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "N/A";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 17 }}>
      <div className="grid2" style={{ marginBottom: 0 }}>
        <Panel title="Behavior profile" sub="Customer purchase & engagement signals">
          <div className="signals">
            {[
              ["Projected CLV", clvDisplay],
              ["Monetary avg", monetaryAvgDisplay],
              ["Tenure", tenureDisplay],
              ["Active-day AOV", activeDayAovDisplay],
              ["Weekend ratio", weekendRatioDisplay],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <b>{value}</b>
              </div>
            ))}
            {/* Show risk only when a model prediction is available. */}
            {predictions?.has_ml_data ? (
              <div>
                <span>AI Churn Risk (ML)</span>
                <b>
                  <span
                    className={`churnBadge ${predictions.churn.risk_level}`}
                    style={{ fontWeight: 600 }}
                  >
                    <span
                      className={`churnDot ${predictions.churn.risk_level}`}
                      aria-hidden="true"
                    />
                    {predictions.churn.percentage}% ({predictions.churn.risk_level})
                  </span>
                </b>
              </div>
            ) : null}
          </div>
        </Panel>
        <Panel title="Category preferences" sub="Share of purchase behavior">
          <div className="prefs">
            {preferences.length > 0 ? (
              preferences.map(([label, value]) => (
                <div key={label}>
                  <span>
                    {label} <b>{(Number(value) * 100).toFixed(1)}%</b>
                  </span>
                  <i>
                    <u
                      style={{ width: `${Math.min(100, Number(value) * 100)}%` }}
                    />
                  </i>
                </div>
              ))
            ) : (
              <div className="state" style={{ padding: "16px 0", color: "var(--muted)", minHeight: 120 }}>
                No category history recorded.
              </div>
            )}
          </div>
        </Panel>
      </div>

      <Panel title="Payment preferences" sub="Payment methods used by this customer">
        {(customer.payment_preferences || []).length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            {customer.payment_preferences.map((pm) => (
              <div
                key={pm.type}
                className="dashPaymentPrefCard"
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding: "12px 14px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>{PAYMENT_ICONS[pm.type] || "💳"}</span>
                  <div>
                    <strong style={{ fontSize: 13, color: "#1e293b", display: "block" }}>{pm.label}</strong>
                    <span style={{ fontSize: 11, color: "#64748b" }}>
                      {pm.count} {pm.count === 1 ? "order" : "orders"} ({(Number(pm.share) * 100).toFixed(0)}%)
                    </span>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <b style={{ fontFamily: "Space Grotesk", fontSize: 13, color: "#0f172a", display: "block" }}>
                    R$ {Number(pm.total_value).toFixed(2)}
                  </b>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="state" style={{ padding: "16px 0", color: "var(--muted)", minHeight: 80 }}>
            No payment history recorded.
          </div>
        )}
      </Panel>
    </div>
  );
}
