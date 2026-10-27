import React from "react";
import { BrainCircuit, AlertTriangle, TrendingUp, Sparkles, RefreshCw } from "lucide-react";
import { Panel } from "../States";

function formatScoreTime(value) {
  if (!value) return "Time unavailable";

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : date.toLocaleString();
}

export default function CustomerAiInsights({ predictions, onRescore, rescoreLoading }) {
  if (!predictions || !predictions.has_ml_data) {
    return (
      <Panel
        title="🤖 AI Intelligence & Churn Explainability"
        sub="Machine Learning model predictions & behavioral drivers"
        action={
          onRescore && (
            <button
              className="btn secondary"
              onClick={onRescore}
              disabled={rescoreLoading}
              style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "5px 11px" }}
            >
              <RefreshCw size={13} className={rescoreLoading ? "spin" : ""} />
              {rescoreLoading ? "Running Model..." : "Run AI Model"}
            </button>
          )
        }
      >
        <div className="state" style={{ padding: "36px 0", textAlign: "center" }}>
          <BrainCircuit size={36} style={{ margin: "0 auto 12px", opacity: 0.6, color: "var(--muted)" }} />
          <p style={{ margin: 0, fontWeight: 500, color: "var(--text-main)" }}>
            {predictions?.message || "No pre-computed ML predictions found for this customer profile."}
          </p>
          <span style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginTop: 4 }}>
            Click "Run AI Model" above to score this customer profile on demand.
          </span>
        </div>
      </Panel>
    );
  }

  const { churn, explainability, clv, recommendation } = predictions;

  const riskBadgeClass = `aiBadge ${churn?.risk_level || "neutral"}`;
  const scoreSource = predictions.is_realtime_score
    ? "Live score"
    : "Saved pipeline score (may not reflect latest activity)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 17 }}>
      {/* Score source and timestamp are relevant even when manual rescoring is unavailable. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "0 2px" }}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: predictions.is_realtime_score ? "#38bdf8" : "#10b981", display: "inline-block" }}></span>
          <span>{scoreSource}</span>
          <span aria-hidden="true">·</span>
          <span>Scored: {formatScoreTime(churn?.scored_at)}</span>
        </div>
        {onRescore && (
          <button
            className="btn secondary"
            onClick={onRescore}
            disabled={rescoreLoading}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "6px 12px" }}
          >
            <RefreshCw size={13} className={rescoreLoading ? "spin" : ""} />
            {rescoreLoading ? "Running Model..." : "Run AI Model Manually"}
          </button>
        )}
      </div>
      {/* Top 3 KPI Metric Cards for AI (Fully Dark-Mode Ready) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
        {/* Churn Prediction Card */}
        <div className="aiMetricCard">
          <div className="aiMetricHeader">
            <span className="aiMetricLabel">
              <AlertTriangle size={15} style={{ color: churn?.risk_level === "high" ? "#ef4444" : "#f59e0b" }} />
              Churn Risk Score
            </span>
            <span className={riskBadgeClass}>
              <span
                className={`churnDot ${churn?.risk_level || ""}`}
                aria-hidden="true"
              />
              {churn?.risk_level} Risk
            </span>
          </div>
          <div className="aiMetricValue" style={{ color: churn?.risk_level === "high" ? "#ef4444" : undefined }}>
            {churn?.percentage != null ? `${churn.percentage}%` : "N/A"}
          </div>
          <div className="aiMetricSub">
            Model: {churn?.model_version || "LightGBM"}
          </div>
        </div>

        {/* Predicted CLV Card */}
        <div className="aiMetricCard">
          <div className="aiMetricHeader">
            <span className="aiMetricLabel">
              <TrendingUp size={15} style={{ color: "#34d399" }} />
              Predicted Lifetime Value
            </span>
            {clv?.value_tier && (
              <span className="aiBadge neutral">
                {clv.value_tier} Value
              </span>
            )}
          </div>
          <div className="aiMetricValue" style={{ color: "#10b981" }}>
            {clv?.predicted_clv != null ? `R$ ${clv.predicted_clv.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "N/A"}
          </div>
          <div className="aiMetricSub">
            Est. Lifespan: {clv?.customer_lifespan_years != null ? `${clv.customer_lifespan_years} yrs` : "N/A"}
          </div>
        </div>
      </div>

      {/* Main Grid: SHAP Drivers & Retention Actions */}
      <div className="grid2" style={{ marginBottom: 0 }}>
        {/* SHAP Feature Contribution */}
        <Panel
          title="Feature Impact (SHAP Analysis)"
          sub="▲ pushes the model output toward higher churn; ▼ pushes it lower. SHAP values are contributions, not percentage points, and bar lengths are visual guides."
        >
          {explainability?.shap_drivers && explainability.shap_drivers.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {explainability.shap_drivers.map((driver) => {
                const isRisk = driver.direction === "increases_risk";
                const absImpact = Math.min(100, Math.abs(driver.impact) * 20);
                return (
                  <div key={driver.feature} className="shapRow">
                    <div className="shapHeader">
                      <span>
                        <span className="shapLabel">{driver.label}</span>
                        <small style={{ display: "block", color: "var(--text-muted)", marginTop: 3 }}>
                          Model input: {driver.feature_value == null
                            ? "unavailable — run the model to capture it"
                            : Number.isFinite(Number(driver.feature_value))
                              ? Number(driver.feature_value).toFixed(4)
                              : String(driver.feature_value)}
                        </small>
                      </span>
                      <span className={isRisk ? "shapImpactRisk" : "shapImpactSafe"}>
                        {isRisk ? "▲ Increases Churn" : "▼ Decreases Churn"} ({driver.impact > 0 ? `+${driver.impact}` : driver.impact})
                      </span>
                    </div>
                    <div className="shapTrack">
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.max(12, absImpact)}%`,
                          background: isRisk ? "#ef4444" : "#10b981",
                          borderRadius: 4,
                          transition: "width 0.4s ease",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="state" style={{ padding: "16px 0", color: "var(--muted)" }}>
              No SHAP contributions available.
            </div>
          )}
        </Panel>

        {/* Reason Codes & Next Best Retention Action */}
        <div style={{ display: "flex", flexDirection: "column", gap: 17 }}>
          <Panel
            title="Key Behavioral Reason Codes"
            sub="Synthesized indicators from customer interaction logs"
          >
            {explainability?.reason_codes && explainability.reason_codes.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {explainability.reason_codes.map((rc, idx) => (
                  <div key={idx} className="reasonCodeCard">
                    <span className="reasonCodeTag">
                      {rc.code}
                    </span>
                    <span className="reasonCodeText">
                      {rc.explanation}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="state" style={{ padding: "16px 0", color: "var(--muted)" }}>
                No active anomaly reason codes triggered.
              </div>
            )}
          </Panel>

          {/* Retention Recommendation */}
          {recommendation?.campaign_name && (
            <Panel
              title="Targeted Retention Campaign"
              sub="Algorithmic next-best-action recommendation"
            >
              <div className="retentionBanner">
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <Sparkles size={16} style={{ color: "#818cf8" }} />
                  <strong className="retentionTitle">
                    {recommendation.campaign_name}
                  </strong>
                </div>
                <div style={{ display: "flex", gap: 14, fontSize: 12, color: "var(--text-muted)" }}>
                  <span>
                    Priority: <b style={{ color: "var(--text-main)" }}>Rank #{recommendation.priority}</b>
                  </span>
                  {recommendation.trigger_reason && (
                    <span>
                      Trigger: <b style={{ color: "var(--text-main)" }}>{recommendation.trigger_reason}</b>
                    </span>
                  )}
                </div>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
