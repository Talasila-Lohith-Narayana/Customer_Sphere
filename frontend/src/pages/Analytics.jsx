import React, { useState } from "react";
import AnalyticsPanel from "../components/analytics/AnalyticsPanel";
import AnalyticsRefreshControls from "../components/analytics/AnalyticsRefreshControls";
import useAnalyticsRefresh from "../components/analytics/useAnalyticsRefresh";
import { Page } from "../components/States";
import { analyticsService } from "../services/api";
import DataTable from "../components/DataTable";

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const currency = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});
const dateTime = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  hour12: false,
});

const formatClv = (value) => `R$ ${currency.format(Number(value) || 0)}`;
const formatTimestamp = (value) => {
  if (!value || value === "unknown") return "Unknown";
  const compactTimestamp = String(value).match(/^(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})$/);
  const parsed = compactTimestamp
    ? new Date(
      Number(compactTimestamp[1]),
      Number(compactTimestamp[2]) - 1,
      Number(compactTimestamp[3]),
      Number(compactTimestamp[4]),
      Number(compactTimestamp[5]),
      Number(compactTimestamp[6]),
    )
    : new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : dateTime.format(parsed);
};

function Metric({ label, value, detail, definition }) {
  return (
    <div className="analyticsMetric" title={definition}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
      {definition && <small className="analyticsMetricDefinition">{definition}</small>}
    </div>
  );
}

function CampaignOverview({ data }) {
  const campaigns = data?.campaigns || [];
  if (!campaigns.length) {
    return <p className="analyticsEmpty">No active campaigns were returned.</p>;
  }
  const maximum = Math.max(...campaigns.map((campaign) => Number(campaign.customer_count) || 0), 1);

  return (
    <div className="analyticsRows">
      {campaigns.slice(0, 8).map((campaign) => (
        <div className="analyticsCampaignRow" key={campaign.campaign_name}>
          <div className="analyticsCampaignHeading">
            <strong>{campaign.campaign_name}</strong>
            <span>Priority {campaign.campaign_priority} · {number.format(campaign.customer_count)} customers</span>
          </div>
          <span className="analyticsBarTrack" aria-hidden="true">
            <span
              className="analyticsBar"
              style={{ width: `${(Number(campaign.customer_count || 0) / maximum) * 100}%` }}
            />
          </span>
        </div>
      ))}
    </div>
  );
}

function DeliveryOverview({ data }) {
  const summary = data?.summary || {};
  const statuses = data?.by_delivery_status || [];
  return (
    <>
      <div className="analyticsMetrics analyticsMetricsCompact">
        <Metric
          label="Delivered orders"
          value={number.format(summary.delivered_orders || 0)}
          definition="Orders with a recorded delivery completion."
        />
        <Metric
          label="Average delivery"
          value={`${Number(summary.avg_delivery_days || 0).toFixed(1)} days`}
          definition="Average elapsed time from purchase to delivery."
        />
        <Metric
          label="On time"
          value={`${Number(summary.on_time_pct || 0).toFixed(1)}%`}
          definition="Share of delivered orders that arrived by the estimated date."
        />
        <Metric
          label="Late"
          value={`${Number(summary.late_pct || 0).toFixed(1)}%`}
          definition="Share of delivered orders that arrived after the estimated date."
        />
      </div>
      <div className="analyticsRows analyticsStatusRows">
        {statuses.map((status) => (
          <div className="analyticsRow" key={status.delivery_status}>
            <strong>{status.delivery_status}</strong>
            <span>{number.format(status.orders || 0)} orders</span>
            <span>{Number(status.avg_delivery_days || 0).toFixed(1)} day average</span>
            <span>
              {status.avg_churn_probability == null
                ? "Churn unavailable"
                : `${(Number(status.avg_churn_probability) * 100).toFixed(1)}% avg. churn score`}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function ClvOverview({ data }) {
  const metrics = [
    ["Customers with CLV", number.format(data?.customers || 0), "Customers with an estimated lifetime value."],
    ["Average CLV", formatClv(data?.avg_clv), "Mean predicted customer lifetime value (R$)."],
    ["Median CLV", formatClv(data?.median_clv), "Middle predicted customer lifetime value (R$)."],
    ["Total projected CLV", formatClv(data?.total_clv), "Sum of predicted customer lifetime values (R$)."],
  ];
  return (
    <div className="analyticsMetrics clvMetrics">
      {metrics.map(([label, value, definition]) => (
        <Metric key={label} label={label} value={value} definition={definition} />
      ))}
    </div>
  );
}

function ValueTierOverview({ data }) {
  if (!Array.isArray(data) || data.length === 0) {
    return <p className="analyticsEmpty">No value-tier data is available.</p>;
  }
  return (
    <div className="analyticsRows valueTierRows">
      {data.map((tier) => (
        <div className="analyticsRow" key={tier.value_tier}>
          <strong>{tier.value_tier} value</strong>
          <span>{number.format(tier.customers || 0)} customers ({Number(tier.pct_share || 0).toFixed(1)}%)</span>
          <span>{formatClv(tier.avg_clv)} average CLV</span>
        </div>
      ))}
    </div>
  );
}

function CohortOverview({ data }) {
  const cohorts = data?.data || [];
  if (!cohorts.length) {
    return <p className="analyticsEmpty">No cohort summary data is available.</p>;
  }
  return (
    <>
      <p className="analyticsMeta">All {number.format(cohorts.length)} acquisition months · newest first</p>
      <div className="dataTableWrap cohortSummaryTableWrap">
        <DataTable
          data={[...cohorts].reverse()}
          columns={[
            { header: "Cohort", accessorKey: "cohort", cell: ({ row }) => <strong>{row.original.label}</strong> },
            { header: "Customers", accessorKey: "cohort_size", cell: ({ row }) => row.original.cohort_size == null ? "—" : number.format(row.original.cohort_size) },
            { header: "Months observed", accessorKey: "months_observed" },
            { header: "M1 retention", accessorKey: "m1_retention_pct", cell: ({ row }) => row.original.m1_retention_pct == null ? "—" : `${Number(row.original.m1_retention_pct).toFixed(1)}%` },
            { header: "M3 retention", accessorKey: "m3_retention_pct", cell: ({ row }) => row.original.m3_retention_pct == null ? "—" : `${Number(row.original.m3_retention_pct).toFixed(1)}%` },
            { header: "Repeat purchase", accessorKey: "cumulative_repeat_purchase_rate_pct", cell: ({ row }) => row.original.cumulative_repeat_purchase_rate_pct == null ? "—" : `${Number(row.original.cumulative_repeat_purchase_rate_pct).toFixed(1)}%` },
          ]}
        />
      </div>
    </>
  );
}

function CampaignSegmentOverview({ data }) {
  if (!Array.isArray(data) || data.length === 0) {
    return <p className="analyticsEmpty">No campaign allocation data is available.</p>;
  }
  return (
    <div className="analyticsRows">
      {data.slice(0, 6).map((segment) => (
        <div className="analyticsCampaignSegment" key={segment.segment_label}>
          <div className="analyticsCampaignHeading">
            <strong>{segment.segment_label}</strong>
            <span>{number.format(segment.total_customers || 0)} customers</span>
          </div>
          <p>
            {(segment.campaigns || [])
              .map((campaign) => `${campaign.campaign_name} (${number.format(campaign.customer_count)})`)
              .join(" · ")}
          </p>
        </div>
      ))}
    </div>
  );
}

function ModelOverview({ data }) {
  const features = data?.features || [];
  return (
    <>
      <div className="analyticsMetrics analyticsMetricsCompact">
        <Metric label="Active model" value={data?.model_name || "Unavailable"} />
        <Metric label="Features" value={number.format(data?.features_count || features.length)} />
        <Metric
          label="Operating point"
          value={data?.operating_point?.value == null
            ? "Unavailable"
            : `${(Number(data.operating_point.value) * 100).toFixed(1)}%`}
          detail={data?.operating_point?.mode || ""}
        />
        <Metric label="Model timestamp" value={formatTimestamp(data?.timestamp)} />
      </div>
      {features.length > 0 && (
        <details className="analyticsDetails">
          <summary>View model features</summary>
          <ul>
            {features.map((feature) => <li key={feature}>{feature.replaceAll("_", " ")}</li>)}
          </ul>
        </details>
      )}
    </>
  );
}

function CalibrationOverview({ data }) {
  const before = data?.test_calibration_before;
  const after = data?.test_calibration_after;
  if (!before || !after) {
    return <p className="analyticsEmpty">Calibration metrics are not available.</p>;
  }
  const rows = [
    ["Brier score", before.brier_score, after.brier_score],
    ["Log loss", before.log_loss, after.log_loss],
    ["Expected calibration error", before.ece, after.ece],
    ["Maximum calibration error", before.mce, after.mce],
  ];
  return (
    <>
      <p className="analyticsMeta">Selected method: {data.selected_method || "Not specified"}</p>
      <div className="dataTableWrap calibrationTableWrap">
        <DataTable
          data={rows.map(([label, initial, calibrated]) => ({ label, initial, calibrated }))}
          columns={[
            { header: "Metric", accessorKey: "label" },
            { header: "Before", accessorKey: "initial", cell: ({ row }) => row.original.initial == null ? "—" : Number(row.original.initial).toFixed(4) },
            { header: "After", accessorKey: "calibrated", cell: ({ row }) => row.original.calibrated == null ? "—" : Number(row.original.calibrated).toFixed(4) },
          ]}
        />
      </div>
    </>
  );
}

function ChurnDefinition({ data }) {
  const counts = data?.counts || {};
  return (
    <>
      <p className="analyticsDefinition">{data?.definition_rule}</p>
      <div className="analyticsMetrics analyticsMetricsCompact">
        <Metric label="Reference date" value={data?.reference_date || "—"} />
        <Metric label="Return window" value={`${data?.return_window_days || 0} days`} />
        <Metric label="Retained" value={number.format(counts.retained || 0)} />
        <Metric label="Churned" value={number.format(counts.churned || 0)} />
        <Metric label="Censored" value={number.format(counts.censored || 0)} />
        <Metric label="Uncensored churn rate" value={`${Number(counts.churn_rate_uncensored_pct || 0).toFixed(1)}%`} />
      </div>
    </>
  );
}

export default function Analytics() {
  const [view, setView] = useState("value");
  const {
    panelProps,
    refreshing,
    disabled: refreshDisabled,
    lastUpdated,
    refresh,
  } = useAnalyticsRefresh();

  return (
    <Page>
      <div className="analyticsDashboardPage">
        <div className="header">
          <div>
            <p className="eyebrow">CUSTOMER INTELLIGENCE</p>
            <h1>Analytics</h1>
            <p>Explore customer value, retention, campaign reach, and model diagnostics.</p>
            <p className="analyticsPageContext">Percentages are shown as rates; CLV values use Brazilian reais (R$). Cohort retention is measured from each customer&apos;s first-purchase month.</p>
          </div>
          <AnalyticsRefreshControls
            refreshing={refreshing}
            disabled={refreshDisabled}
            lastUpdated={lastUpdated}
            onRefresh={refresh}
          />
        </div>

        <div className="tabs modelTabs" role="tablist" aria-label="Analytics sections">
          <button
            type="button"
            role="tab"
            className={view === "value" ? "active" : ""}
            aria-selected={view === "value"}
            onClick={() => setView("value")}
          >
            Customer value and retention
          </button>
          <button
            type="button"
            role="tab"
            className={view === "campaigns" ? "active" : ""}
            aria-selected={view === "campaigns"}
            onClick={() => setView("campaigns")}
          >
            Campaigns
          </button>
          <button
            type="button"
            role="tab"
            className={view === "cohorts" ? "active" : ""}
            aria-selected={view === "cohorts"}
            onClick={() => setView("cohorts")}
          >
            Cohort summary
          </button>
          <button
            type="button"
            role="tab"
            className={view === "model" ? "active" : ""}
            aria-selected={view === "model"}
            onClick={() => setView("model")}
          >
            Model diagnostics
          </button>
        </div>

        {view === "value" && (
          <section className="analyticsPageSection tabPanelTransition" aria-labelledby="analytics-value-heading">
            <h2 id="analytics-value-heading">Customer value and retention</h2>
            <div className="grid2 analyticsPageGrid">
              <AnalyticsPanel
                {...panelProps}
                title="Lifetime value overview"
                sub="Predicted value across customers"
                load={analyticsService.clvSummary}
              >
                {(data) => <ClvOverview data={data} />}
              </AnalyticsPanel>
              <AnalyticsPanel
                {...panelProps}
                title="Value tiers"
                sub="Customer distribution by predicted value tier"
                load={analyticsService.valueTiers}
              >
                {(data) => <ValueTierOverview data={data} />}
              </AnalyticsPanel>
              <AnalyticsPanel
                {...panelProps}
                title="Delivery performance"
                sub="Delivered order speed and on-time rate"
                load={analyticsService.deliveryPerformance}
              >
                {(data) => <DeliveryOverview data={data} />}
              </AnalyticsPanel>
            </div>
          </section>
        )}

        {view === "cohorts" && (
          <section className="analyticsPageSection tabPanelTransition" aria-labelledby="analytics-cohort-heading">
            <h2 id="analytics-cohort-heading">Cohort summary</h2>
            <AnalyticsPanel
              {...panelProps}
              title="Acquisition cohort summary"
              sub="Retention and repeat purchasing by first-purchase month"
              load={analyticsService.cohortSummary}
            >
              {(data) => <CohortOverview data={data} />}
            </AnalyticsPanel>
          </section>
        )}

        {view === "campaigns" && (
          <section className="analyticsPageSection tabPanelTransition" aria-labelledby="analytics-campaign-heading">
            <h2 id="analytics-campaign-heading">Campaigns</h2>
            <div className="grid2 analyticsPageGrid">
              <AnalyticsPanel
                {...panelProps}
                title="Active campaign reach"
                sub="Current campaign count, targeting volume, and priority customers"
                load={analyticsService.activeCampaigns}
              >
                {(data) => (
                  <>
                    <div className="analyticsMetrics analyticsMetricsCompact">
                      <Metric label="Active campaigns" value={number.format(data.active_campaigns || 0)} />
                      <Metric label="Customers targeted" value={number.format(data.customers_targeted || 0)} />
                      <Metric label="High priority" value={number.format(data.high_priority_customers || 0)} />
                    </div>
                    <CampaignOverview data={data} />
                  </>
                )}
              </AnalyticsPanel>
              <AnalyticsPanel
                {...panelProps}
                title="Campaign allocation by segment"
                sub="Campaign targeting distribution across customer segments"
                load={analyticsService.campaignsBySegment}
              >
                {(data) => <CampaignSegmentOverview data={data} />}
              </AnalyticsPanel>
            </div>
          </section>
        )}

        {view === "model" && (
          <section className="analyticsPageSection tabPanelTransition" aria-labelledby="analytics-model-heading">
            <h2 id="analytics-model-heading">Model diagnostics</h2>
            <div className="grid2 analyticsPageGrid">
              <AnalyticsPanel
                {...panelProps}
                title="Active model"
                sub="Current model metadata and inference features"
                load={analyticsService.modelVersion}
              >
                {(data) => <ModelOverview data={data} />}
              </AnalyticsPanel>
              <AnalyticsPanel
                {...panelProps}
                title="Calibration quality"
                sub="Test-set probability calibration before and after calibration"
                load={analyticsService.modelCalibration}
              >
                {(data) => <CalibrationOverview data={data} />}
              </AnalyticsPanel>
              <AnalyticsPanel
                {...panelProps}
                title="Churn definition"
                sub="How churn labels and censored customers are defined"
                load={analyticsService.churnDefinition}
              >
                {(data) => <ChurnDefinition data={data} />}
              </AnalyticsPanel>
            </div>
          </section>
        )}
      </div>
    </Page>
  );
}
