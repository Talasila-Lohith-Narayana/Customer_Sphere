import React, { useEffect, useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { LoadingState, Panel } from "../States";

export default function AnalyticsPanel({
  title,
  sub,
  load,
  children,
  preserveDataOnRefresh = false,
  refreshKey = 0,
  onLoadStateChange,
  onLoaded,
}) {
  const [result, setResult] = useState({ status: "loading", data: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    onLoadStateChange?.(title, true);
    setResult((current) =>
      preserveDataOnRefresh && current.data
        ? { ...current, status: "refreshing" }
        : { status: "loading", data: null },
    );
    let request;
    try {
      request = load();
    } catch (error) {
      request = Promise.reject(error);
    }
    request
      .then((data) => {
        if (active) {
          setResult({ status: "success", data });
          onLoaded?.();
        }
      })
      .catch((error) => {
        if (active) {
          setResult((current) => ({
            status: "error",
            error,
            data: preserveDataOnRefresh ? current.data : null,
          }));
        }
      })
      .finally(() => {
        if (active) onLoadStateChange?.(title, false);
      });
    return () => {
      active = false;
      onLoadStateChange?.(title, false);
    };
  }, [
    attempt,
    load,
    onLoaded,
    onLoadStateChange,
    preserveDataOnRefresh,
    refreshKey,
    title,
  ]);

  return (
    <Panel title={title} sub={sub}>
      {result.status === "loading" && <LoadingState text="Loading analytics..." />}
      {result.status === "error" && !result.data && (
        <div className="analyticsPanelError" role="alert">
          <AlertTriangle size={16} />
          <span>{result.error?.message || "Could not load this analytics data."}</span>
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
      {result.status === "refreshing" && (
        <p className="analyticsPanelRefreshing" role="status">
          Updating results…
        </p>
      )}
      {result.status === "error" && result.data && (
        <div className="analyticsPanelError" role="alert">
          <AlertTriangle size={16} />
          <span>{result.error?.message || "Could not refresh this analytics data."}</span>
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
      {(result.status === "success" || result.status === "refreshing" || (result.status === "error" && result.data)) &&
        children(result.data)}
    </Panel>
  );
}
