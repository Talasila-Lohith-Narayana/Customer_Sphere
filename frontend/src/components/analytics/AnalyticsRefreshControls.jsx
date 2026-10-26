import React from "react";

const formatTimestamp = (value) => {
  if (!value) return "Not loaded yet";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
};

export default function AnalyticsRefreshControls({ refreshing, disabled, lastUpdated, onRefresh }) {
  return (
    <div className="analyticsRefreshControls">
      <span className="analyticsLastUpdated" aria-live="polite">
        Last loaded: {formatTimestamp(lastUpdated)}
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
