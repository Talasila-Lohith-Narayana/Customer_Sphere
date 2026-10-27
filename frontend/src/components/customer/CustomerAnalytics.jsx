import React, { useEffect, useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { analyticsService } from "../../services/api";
import { LoadingState, Panel } from "../States";
import DataTable from "../DataTable";
import { getChurnRiskLabel, getChurnRiskLevel } from "../../utils/churnRisk";

const currency = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function CustomerAnalyticsPanel({ title, sub, load, renderData }) {
  const [result, setResult] = useState({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setResult({ status: "loading" });
    load()
      .then((data) => {
        if (active) setResult({ status: "success", data });
      })
      .catch((error) => {
        if (active) setResult({ status: "error", error });
      });
    return () => {
      active = false;
    };
  }, [attempt, load]);

  return (
    <Panel title={title} sub={sub}>
      {result.status === "loading" && <LoadingState text="Loading customer analytics..." />}
      {result.status === "error" && (
        <div className="analyticsPanelError" role="alert">
          <AlertTriangle size={16} />
          <span>{result.error?.message || "Could not load this customer analytics data."}</span>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setAttempt((value) => value + 1)}
            aria-label={`Retry ${title}`}
          >
            <RotateCw size={14} />
            Retry
          </button>
        </div>
      )}
      {result.status === "success" && renderData(result.data)}
    </Panel>
  );
}

function CustomerClv({ data }) {
  return (
    <div className="customerAnalyticsMetrics">
      <div><span>Predicted lifetime value</span><strong>R$ {currency.format(Number(data.clv) || 0)}</strong></div>
      <div><span>Value tier</span><strong>{data.value_tier || "Unavailable"}</strong></div>
      <div><span>Segment</span><strong>{data.segment_label || "Unavailable"}</strong></div>
      <div>
        <span>Purchase frequency</span>
        <strong>
          {data.purchase_frequency_per_year == null
            ? "Unavailable"
            : `${Number(data.purchase_frequency_per_year).toFixed(2)} orders/year`}
        </strong>
      </div>
      <div>
        <span>Estimated lifespan</span>
        <strong>
          {data.customer_lifespan_years == null
            ? "Unavailable"
            : `${Number(data.customer_lifespan_years).toFixed(2)} years`}
        </strong>
      </div>
      <div>
        <span>Churn risk</span>
        <strong>
          {data.churn_probability == null
            ? "Unavailable"
            : `${(Number(data.churn_probability) * 100).toFixed(1)}% · ${getChurnRiskLabel(data.churn_probability)}`}
        </strong>
      </div>
    </div>
  );
}

function CampaignRecommendation({ data }) {
  return (
    <div className="customerCampaignRecommendation">
      <strong>{data.campaign_name}</strong>
      <div>
        <span>Priority {data.campaign_priority}</span>
        <span>Reason code {data.reason_code}</span>
      </div>
      <p>{data.reason}</p>
      <small>
        Recommendation source: {data.source === "database" ? "stored customer recommendation" : "campaign rules"}
      </small>
    </div>
  );
}

function CustomerDelivery({ data }) {
  const summary = data?.summary || {};
  const deliveries = data?.deliveries || [];
  return (
    <>
      <div className="customerAnalyticsMetrics">
        <div>
          <span>Delivered orders</span>
          <strong>{Number(summary.delivered_orders || 0).toLocaleString()}</strong>
        </div>
        <div>
          <span>Average delivery time</span>
          <strong>
            {summary.avg_delivery_days == null
              ? "Unavailable"
              : `${Number(summary.avg_delivery_days).toFixed(1)} days`}
          </strong>
        </div>
        <div>
          <span>On time</span>
          <strong>{summary.on_time_pct == null ? "Unavailable" : `${Number(summary.on_time_pct).toFixed(1)}%`}</strong>
        </div>
        <div>
          <span>Late</span>
          <strong>{summary.late_pct == null ? "Unavailable" : `${Number(summary.late_pct).toFixed(1)}%`}</strong>
        </div>
      </div>
      {deliveries.length > 0 && (
        <div className="dataTableWrap" style={{ marginTop: 14 }}>
          <DataTable data={deliveries} columns={[
            { header: "Order", accessorKey: "order_id" },
            { header: "Purchased", accessorKey: "purchased_at", cell: ({ row }) => row.original.purchased_at ? new Date(row.original.purchased_at).toLocaleDateString() : "—" },
            { header: "Delivered", accessorKey: "delivered_at", cell: ({ row }) => row.original.delivered_at ? new Date(row.original.delivered_at).toLocaleDateString() : "—" },
            { header: "Days", accessorKey: "delivery_days", cell: ({ row }) => row.original.delivery_days ?? "—" },
            { header: "Status", accessorKey: "delivery_status" },
          ]} />
        </div>
      )}
      {deliveries.length === 0 && <p className="analyticsEmpty">No delivered orders are available.</p>}
    </>
  );
}

function CustomerRisk({ data }) {
  const riskLevel = getChurnRiskLevel(data.churn_probability);
  return (
    <div className="customerAnalyticsMetrics">
      <div>
        <span>Model-predicted churn risk</span>
        <strong className="churnRiskLabel">
          {riskLevel && (
            <span className={`churnDot ${riskLevel}`} aria-hidden="true" />
          )}
          {getChurnRiskLabel(data.churn_probability)}
        </strong>
      </div>
      <div>
        <span>Model churn probability</span>
        <strong>
          {data.churn_probability == null
            ? "Unavailable"
            : `${(Number(data.churn_probability) * 100).toFixed(1)}%`}
        </strong>
      </div>
    </div>
  );
}

function CustomerExplanation({ data }) {
  const reasons = data.reason_codes || [];
  const shapValues = Object.entries(data.shap_values || {})
    .sort(([, left], [, right]) => Math.abs(Number(right)) - Math.abs(Number(left)))
    .slice(0, 6);
  return (
    <>
      <p className="analyticsMeta">
        {data.model_version || "Model version unavailable"}
        {data.scored_at ? ` · Scored ${new Date(data.scored_at).toLocaleString()}` : ""}
      </p>
      {reasons.length > 0 && (
        <div className="analyticsRows customerReasonList">
          {reasons.map((reason) => (
            <div key={reason.code}>
              <strong>{reason.code}</strong>
              <span>{reason.message || "No description available."}</span>
            </div>
          ))}
        </div>
      )}
      {shapValues.length > 0 && (
        <div className="dataTableWrap" style={{ marginTop: 12 }}>
          <DataTable data={shapValues.map(([feature, value]) => ({ feature, value }))} columns={[
            { header: "Feature", accessorKey: "feature", cell: ({ row }) => row.original.feature.replaceAll("_", " ") },
            { header: "SHAP value", accessorKey: "value", cell: ({ row }) => Number(row.original.value).toFixed(4) },
            { header: "Effect", accessorKey: "effect", cell: ({ row }) => Number(row.original.value) > 0 ? "Raises risk" : "Lowers risk" },
          ]} />
        </div>
      )}
      {reasons.length === 0 && shapValues.length === 0 && (
        <p className="analyticsEmpty">No stored explanation details are available.</p>
      )}
    </>
  );
}

export default function CustomerAnalytics({ customerUniqueId }) {
  if (!customerUniqueId) return null;

  return (
    <section className="customerAnalyticsSection" aria-label="Customer analytics">
      <h2 className="analyticsSectionTitle">Customer Intelligence Analytics</h2>
      <div className="grid3 customerAnalyticsGrid">
        <CustomerAnalyticsPanel
          title="Customer lifetime value"
          sub="Analytics pipeline value and purchase outlook"
          load={() => analyticsService.customerClv(customerUniqueId)}
          renderData={(data) => <CustomerClv data={data} />}
        />
        <CustomerAnalyticsPanel
          title="Retention recommendation"
          sub="Recommended campaign and reason for this customer"
          load={() => analyticsService.customerCampaign(customerUniqueId)}
          renderData={(data) => <CampaignRecommendation data={data} />}
        />
        <CustomerAnalyticsPanel
          title="Delivery performance"
          sub="Delivered order timing and reliability for this customer"
          load={() => analyticsService.customerDelivery(customerUniqueId)}
          renderData={(data) => <CustomerDelivery data={data} />}
        />
      </div>
      <div className="grid2 customerChurnDetailsGrid">
        <CustomerAnalyticsPanel
          title="Stored churn risk"
          sub="Persisted risk tier and probability for this customer"
          load={() => analyticsService.customerRisk(customerUniqueId)}
          renderData={(data) => <CustomerRisk data={data} />}
        />
        <CustomerAnalyticsPanel
          title="Churn explanation"
          sub="Stored reason codes and feature contributions for this customer"
          load={() => analyticsService.customerExplanation(customerUniqueId)}
          renderData={(data) => <CustomerExplanation data={data} />}
        />
      </div>
    </section>
  );
}
