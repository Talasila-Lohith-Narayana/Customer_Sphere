import React from "react";

export default function AnalyticsRefreshControls({ refreshing, disabled, onRefresh }) {
  return (
    <div className="analyticsRefreshControls">
      <span className="analyticsFreshnessNote">
        Each panel shows its own latest successful update.
      </span>
      <button
        type="button"
        className="btn secondary"
        onClick={onRefresh}
        disabled={disabled || refreshing}
        aria-label="Refresh analytics data"
      >
        {refreshing ? "Refreshing..." : "Refresh"}
      </button>
    </div>
  );
}
