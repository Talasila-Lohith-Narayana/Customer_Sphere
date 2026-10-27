import React, { useState } from "react";
import AnalyticsPanel from "../components/analytics/AnalyticsPanel";
import AnalyticsRefreshControls from "../components/analytics/AnalyticsRefreshControls";
import useAnalyticsRefresh from "../components/analytics/useAnalyticsRefresh";
import { Page, Panel } from "../components/States";
import { analyticsService } from "../services/api";
import DataTable from "../components/DataTable";

const number = new Intl.NumberFormat("en-US");
const featureLabel = (feature) => feature.replaceAll("_", " ");
const percent = (value) => value == null ? "Unavailable" : `${(Number(value) * 100).toFixed(1)}%`;
const formatRefreshTimestamp = (value) => {
  if (!value) return "No stored prediction refresh is available.";
  const date = new Date(value.includes(" ") ? value.replace(" ", "T") : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};
const churnOverviewLoad = () => analyticsService.churnOverview();

function Performance({ data }) {
  const metrics = data?.metrics || {};
  const labels = [
    ["ROC AUC", metrics.roc_auc],
    ["PR AUC", metrics.pr_auc],
    ["Precision", metrics.precision],
    ["Recall", metrics.recall],
    ["F1 score", metrics.f1],
    ["Balanced accuracy", metrics.balanced_accuracy],
  ];
  return (
    <>
      <p className="analyticsMeta">
        {data.model_name || "Model"} · {data.split_evaluated || "test"} split
        {data.version_or_timestamp ? ` · ${data.version_or_timestamp}` : ""}
      </p>
      {labels.every(([, value]) => value == null)
        ? <p className="analyticsEmpty">Evaluation metrics are not available for this model.</p>
        : <div className="analyticsMetrics">{labels.map(([label, value]) => (
            <div className="analyticsMetric" key={label}><span>{label}</span><strong>{percent(value)}</strong></div>
          ))}</div>}
      {metrics.confusion_matrix && (
        <div className="confusionMatrix" aria-label="Confusion matrix">
          <div className="confusionMatrixTitle">Confusion matrix</div>
          <div className="confusionMatrixSubtitle">
            Rows: observed outcome · Columns: model prediction
          </div>
          <div className="confusionMatrixCorner" aria-hidden="true" />
          <div className="confusionMatrixHeader confusionMatrixPredictedNegative">Negative</div>
          <div className="confusionMatrixHeader confusionMatrixPredictedPositive">Positive</div>
          <div className="confusionMatrixHeader confusionMatrixActualNegative">Negative</div>
          <div className="confusionMatrixCell confusionMatrixTrueNegative">
            <span>TN</span>
            <strong>{metrics.confusion_matrix.tn}</strong>
          </div>
          <div className="confusionMatrixCell confusionMatrixFalsePositive">
            <span>FP</span>
            <strong>{metrics.confusion_matrix.fp}</strong>
          </div>
          <div className="confusionMatrixHeader confusionMatrixActualPositive">Positive</div>
          <div className="confusionMatrixCell confusionMatrixFalseNegative">
            <span>FN</span>
            <strong>{metrics.confusion_matrix.fn}</strong>
          </div>
          <div className="confusionMatrixCell confusionMatrixTruePositive">
            <span>TP</span>
            <strong>{metrics.confusion_matrix.tp}</strong>
          </div>
        </div>
      )}
    </>
  );
}

function ModelComparison({ data }) {
  const rows = data?.comparison_table || [];
  if (rows.length === 0) return <p className="analyticsEmpty">Model comparison data is not available.</p>;
  return (
    <>
      {data.summary_winner && <p className="analyticsMeta">Summary winner: {data.summary_winner}</p>}
      <div className="dataTableWrap modelComparisonTableWrap">
        <DataTable data={rows} columns={[
          { header: "Metric", accessorKey: "metric" },
          { header: "Logistic", accessorKey: "logistic_regression", cell: ({ row }) => row.original.logistic_regression == null ? "—" : Number(row.original.logistic_regression).toFixed(4) },
          { header: "LightGBM", accessorKey: "lightgbm", cell: ({ row }) => row.original.lightgbm == null ? "—" : Number(row.original.lightgbm).toFixed(4) },
          { header: "Better", accessorKey: "better", cell: ({ row }) => row.original.better || "—" },
        ]} />
      </div>
    </>
  );
}

function ThresholdAnalysis({ data }) {
  const rows = data?.best_thresholds || [];
  const curve = data?.sweep_curve || [];
  if (rows.length === 0 && curve.length === 0) {
    return <p className="analyticsEmpty">Recommended threshold data is not available.</p>;
  }
  const sampledCurve = curve.length > 12
    ? Array.from({ length: 12 }, (_, index) => curve[Math.round(index * (curve.length - 1) / 11)])
    : curve;
  return (
    <>
      <p className="analyticsMeta">Recommended model: {data.recommended_model || "Not specified"}</p>
      {rows.length > 0 ? (
        <div className="dataTableWrap thresholdTableWrap">
          <DataTable data={rows} columns={[
            { header: "Objective", accessorKey: "metric" },
            { header: "Logistic threshold / score", accessorKey: "best_threshold_logreg", cell: ({ row }) => row.original.best_threshold_logreg == null ? "—" : `${Number(row.original.best_threshold_logreg).toFixed(3)} / ${row.original.best_score_logreg == null ? "—" : Number(row.original.best_score_logreg).toFixed(3)}` },
            { header: "LightGBM threshold / score", accessorKey: "best_threshold_lgbm", cell: ({ row }) => row.original.best_threshold_lgbm == null ? "—" : `${Number(row.original.best_threshold_lgbm).toFixed(3)} / ${row.original.best_score_lgbm == null ? "—" : Number(row.original.best_score_lgbm).toFixed(3)}` },
            { header: "Better", accessorKey: "better", cell: ({ row }) => row.original.better || "—" },
          ]} />
        </div>
      ) : (
        <p className="analyticsEmpty">Best-threshold recommendations are not available; showing the reported threshold sweep.</p>
      )}
      {sampledCurve.length > 0 && (
        <div className="dataTableWrap curveTableWrap" style={{ marginTop: 12 }}>
          <DataTable data={sampledCurve} columns={[
            { header: "Threshold", accessorKey: "threshold", cell: ({ row }) => Number(row.original.threshold).toFixed(3) },
            { header: "Precision", accessorKey: "precision", cell: ({ row }) => percent(row.original.precision) },
            { header: "Recall", accessorKey: "recall", cell: ({ row }) => percent(row.original.recall) },
            { header: "F1", accessorKey: "f1", cell: ({ row }) => percent(row.original.f1) },
            { header: "Balanced accuracy", accessorKey: "balanced_accuracy", cell: ({ row }) => percent(row.original.balanced_accuracy) },
          ]} />
        </div>
      )}
    </>
  );
}

function ImbalanceExperiments({ data }) {
  const strategies = data?.strategies || [];
  if (strategies.length === 0) return <p className="analyticsEmpty">Class-imbalance experiment data is not available.</p>;
  return (
    <div className="dataTableWrap imbalanceTableWrap">
      <DataTable data={strategies} columns={[
        { header: "Strategy", accessorKey: "strategy" },
        { header: "Threshold", accessorKey: "tuned_threshold", cell: ({ row }) => row.original.tuned_threshold == null ? "—" : Number(row.original.tuned_threshold).toFixed(3) },
        { header: "Balanced acc.", accessorKey: "balanced_accuracy", cell: ({ row }) => percent(row.original.balanced_accuracy) },
        { header: "Recall", accessorKey: "churn_recall", cell: ({ row }) => row.original.churn_recall ?? "—" },
        { header: "Precision", accessorKey: "churn_precision", cell: ({ row }) => row.original.churn_precision == null ? "—" : percent(row.original.churn_precision) },
        { header: "PR AUC", accessorKey: "pr_auc", cell: ({ row }) => row.original.pr_auc == null ? "—" : Number(row.original.pr_auc).toFixed(4) },
      ]} />
    </div>
  );
}

function ChurnSummary({ data }) {
  return (
    <>
      <div className="analyticsMetrics analyticsMetricsCompact">
        <div className="analyticsMetric"><span>Scored customers</span><strong>{number.format(data.total_customers || 0)}</strong></div>
        <div className="analyticsMetric"><span>Average churn probability</span><strong>{percent(data.avg_churn_probability)}</strong></div>
        <div className="analyticsMetric"><span>High-risk customers</span><strong>{number.format(data.predicted_churn_customers || 0)}</strong></div>
        <div className="analyticsMetric"><span>Predicted churn rate</span><strong>{percent(data.predicted_churn_rate)}</strong></div>
      </div>
      <p className="analyticsMeta">
        High-risk threshold: {percent(data.threshold)} · Latest score: {formatRefreshTimestamp(data.refreshed_at)}
      </p>
    </>
  );
}

function ShapFeatureList({ data, valueKey, label }) {
  const features = data?.features || [];
  if (features.length === 0) return <p className="analyticsEmpty">Stored prediction explanations are not available.</p>;
  const maximum = Math.max(...features.map((entry) => Number(entry[valueKey]) || 0), 1e-12);
  return (
    <>
      <p className="analyticsMeta">{number.format(data.scored_customers || 0)} scored customers</p>
      <div className="analyticsRows">
        {features.map((entry) => (
          <div className="analyticsCampaignRow" key={entry.feature}>
            <div className="analyticsCampaignHeading">
              <strong>{featureLabel(entry.feature)}</strong>
              <span>{label}: {Number(entry[valueKey]).toFixed(4)} · {number.format(entry.customers_impacted ?? entry.customers_present ?? 0)} customers</span>
            </div>
            <span className="analyticsBarTrack" aria-hidden="true">
              <span className="analyticsBar" style={{ width: `${(Number(entry[valueKey]) / maximum) * 100}%` }} />
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function ProbabilityDistribution({ data }) {
  const bins = data?.bins || [];
  if (bins.length === 0 || !data.total_customers) {
    return <p className="analyticsEmpty">Stored churn probability data is not available.</p>;
  }
  const maximum = Math.max(...bins.map((bin) => Number(bin.count) || 0), 1);
  return (
    <>
      <p className="analyticsMeta">{number.format(data.total_customers)} scored customers</p>
      <div className="analyticsRows">
        {bins.map((bin) => (
          <div className="analyticsCampaignRow" key={bin.range}>
            <div className="analyticsCampaignHeading"><span>{bin.range}</span><span>{number.format(bin.count)}</span></div>
            <span className="analyticsBarTrack" aria-hidden="true">
              <span className="analyticsBar analyticsRetentionBar" style={{ width: `${(Number(bin.count) / maximum) * 100}%` }} />
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function ReasonCodeSummary({ data }) {
  const codes = data?.reason_codes || [];
  if (codes.length === 0) return <p className="analyticsEmpty">No stored reason-code counts are available.</p>;
  return (
    <>
      <p className="analyticsMeta">{number.format(data.total_reason_codes || 0)} total reason-code occurrences</p>
      <div className="analyticsRows">
        {codes.map((entry) => (
          <div className="analyticsRow" key={entry.reason_code}>
            <strong>{entry.reason_code}</strong>
            <span>{number.format(entry.count)} occurrences</span>
            <span>{entry.message || "No description available."}</span>
          </div>
        ))}
      </div>
    </>
  );
}

export default function Model() {
  const [view, setView] = useState("overview");
  const {
    panelProps,
    refreshing,
    disabled: refreshDisabled,
    refresh,
  } = useAnalyticsRefresh();

  return (
    <Page>
      <div className="modelPage">
        <div className="header">
          <div>
            <p className="eyebrow">CHURN MODEL INSIGHTS</p>
            <h1>Model diagnostics</h1>
            <p>Inspect churn risk, model reports, experiment records, and observed feature behavior.</p>
          </div>
          <AnalyticsRefreshControls
            refreshing={refreshing}
            disabled={refreshDisabled}
            onRefresh={refresh}
          />
        </div>
        <div className="modelPageSummary" aria-label="Model summary highlights">
          <div className="modelSummaryCard">
            <span className="modelSummaryLabel">Prediction coverage</span>
            <strong>Live scoring</strong>
          </div>
          <div className="modelSummaryCard">
            <span className="modelSummaryLabel">Monitoring</span>
            <strong>Current behavior</strong>
          </div>
          <div className="modelSummaryCard">
            <span className="modelSummaryLabel">Diagnostics</span>
            <strong>Model evaluation</strong>
          </div>
        </div>

        <div className="tabs modelTabs" role="tablist" aria-label="Model page sections">
          <button
            type="button"
            className={view === "all" ? "active" : ""}
            onClick={() => setView("all")}
            aria-selected={view === "all"}
          >
            All
          </button>
          <button
            type="button"
            className={view === "overview" ? "active" : ""}
            onClick={() => setView("overview")}
            aria-selected={view === "overview"}
          >
            Overview
          </button>
          <button
            type="button"
            className={view === "advanced" ? "active" : ""}
            onClick={() => setView("advanced")}
            aria-selected={view === "advanced"}
          >
            Advanced diagnostics
          </button>
        </div>

        {view === "overview" && (
          <section className="analyticsPageSection tabPanelTransition" aria-labelledby="model-churn-heading">
            <h2 id="model-churn-heading">Stored churn predictions</h2>
            <div className="grid2">
              <AnalyticsPanel {...panelProps} title="Churn overview" sub="Risk volume based on stored customer predictions" load={churnOverviewLoad}>
                {(data) => <ChurnSummary data={data.summary} />}
              </AnalyticsPanel>
              <AnalyticsPanel {...panelProps} title="Prediction refresh" sub="Most recent batch score and prediction distribution" load={churnOverviewLoad}>
                {(data) => <p className="analyticsMeta modelRefreshTimestamp">{formatRefreshTimestamp(data.last_refresh.last_refreshed_at)}</p>}
              </AnalyticsPanel>
              <AnalyticsPanel {...panelProps} title="Churn probability distribution" sub="Stored customer scores grouped into probability ranges" load={churnOverviewLoad}>
                {(data) => <ProbabilityDistribution data={data.probability_distribution} />}
              </AnalyticsPanel>
              <AnalyticsPanel {...panelProps} title="Reason-code summary" sub="Most frequently recorded explanations for churn predictions" load={churnOverviewLoad}>
                {(data) => <ReasonCodeSummary data={data.reason_codes} />}
              </AnalyticsPanel>
              <AnalyticsPanel {...panelProps} title="Top positive churn drivers" sub="Features most often pushing risk upward in stored explanations" load={churnOverviewLoad}>
                {(data) => <ShapFeatureList data={data.top_features} valueKey="avg_positive_shap" label="Avg. positive SHAP" />}
              </AnalyticsPanel>
              <AnalyticsPanel {...panelProps} title="Global feature importance" sub="Mean absolute SHAP contribution across stored predictions" load={churnOverviewLoad}>
                {(data) => <ShapFeatureList data={data.feature_importance} valueKey="mean_abs_shap" label="Mean |SHAP|" />}
              </AnalyticsPanel>
            </div>
          </section>
        )}

        {view === "advanced" && (
          <section className="analyticsPageSection tabPanelTransition" aria-labelledby="model-evaluation-heading">
            <h2 id="model-evaluation-heading">Model evaluation and feature behavior</h2>
            <div className="grid2">
              <AnalyticsPanel {...panelProps} title="Model test performance" sub="Reported metrics for the evaluated test split" load={analyticsService.modelPerformance}>
                {(data) => <Performance data={data} />}
              </AnalyticsPanel>
              <AnalyticsPanel {...panelProps} title="Model comparison" sub="Comparison of logistic regression and LightGBM reports" load={analyticsService.modelComparison}>
                {(data) => <ModelComparison data={data} />}
              </AnalyticsPanel>
              <AnalyticsPanel {...panelProps} title="Class-imbalance experiments" sub="Reported performance across imbalance strategies" load={analyticsService.modelImbalanceExperiments}>
                {(data) => <ImbalanceExperiments data={data} />}
              </AnalyticsPanel>
            </div>
          </section>
        )}

        {view === "all" && (
          <>
            <section className="analyticsPageSection tabPanelTransition" aria-labelledby="model-churn-heading">
              <h2 id="model-churn-heading">Stored churn predictions</h2>
              <div className="grid2">
                <AnalyticsPanel {...panelProps} title="Churn overview" sub="Risk volume based on stored customer predictions" load={churnOverviewLoad}>
                  {(data) => <ChurnSummary data={data.summary} />}
                </AnalyticsPanel>
                <AnalyticsPanel {...panelProps} title="Prediction refresh" sub="Most recent batch score and prediction distribution" load={churnOverviewLoad}>
                  {(data) => <p className="analyticsMeta modelRefreshTimestamp">{formatRefreshTimestamp(data.last_refresh.last_refreshed_at)}</p>}
                </AnalyticsPanel>
                <AnalyticsPanel {...panelProps} title="Churn probability distribution" sub="Stored customer scores grouped into probability ranges" load={churnOverviewLoad}>
                  {(data) => <ProbabilityDistribution data={data.probability_distribution} />}
                </AnalyticsPanel>
                <AnalyticsPanel {...panelProps} title="Reason-code summary" sub="Most frequently recorded explanations for churn predictions" load={churnOverviewLoad}>
                  {(data) => <ReasonCodeSummary data={data.reason_codes} />}
                </AnalyticsPanel>
                <AnalyticsPanel {...panelProps} title="Top positive churn drivers" sub="Features most often pushing risk upward in stored explanations" load={churnOverviewLoad}>
                  {(data) => <ShapFeatureList data={data.top_features} valueKey="avg_positive_shap" label="Avg. positive SHAP" />}
                </AnalyticsPanel>
                <AnalyticsPanel {...panelProps} title="Global feature importance" sub="Mean absolute SHAP contribution across stored predictions" load={churnOverviewLoad}>
                  {(data) => <ShapFeatureList data={data.feature_importance} valueKey="mean_abs_shap" label="Mean |SHAP|" />}
                </AnalyticsPanel>
              </div>
            </section>
            <section className="analyticsPageSection tabPanelTransition" aria-labelledby="model-evaluation-heading">              <h2 id="model-evaluation-heading">Model evaluation and feature behavior</h2>
              <div className="grid2">
                <AnalyticsPanel {...panelProps} title="Model test performance" sub="Reported metrics for the evaluated test split" load={analyticsService.modelPerformance}>
                  {(data) => <Performance data={data} />}
                </AnalyticsPanel>
                <AnalyticsPanel {...panelProps} title="Model comparison" sub="Comparison of logistic regression and LightGBM reports" load={analyticsService.modelComparison}>
                  {(data) => <ModelComparison data={data} />}
                </AnalyticsPanel>
                <AnalyticsPanel {...panelProps} title="Class-imbalance experiments" sub="Reported performance across imbalance strategies" load={analyticsService.modelImbalanceExperiments}>
                  {(data) => <ImbalanceExperiments data={data} />}
                </AnalyticsPanel>
              </div>
            </section>
          </>
        )}
      </div>
    </Page>
  );
}
