import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Eye, RotateCw } from "lucide-react";
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
  panelUpdates = {},
  deferUntilVisible = false,
}) {
  const containerRef = useRef(null);
  const [isVisible, setIsVisible] = useState(!deferUntilVisible);
  const [result, setResult] = useState({ status: "loading", data: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!deferUntilVisible || isVisible || !containerRef.current) return undefined;

    if (typeof window.IntersectionObserver !== "function") {
      setIsVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px" },
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [deferUntilVisible, isVisible]);

  useEffect(() => {
    if (deferUntilVisible && !isVisible) return undefined;

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
          onLoaded?.(title);
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
    deferUntilVisible,
    isVisible,
  ]);

  if (deferUntilVisible && !isVisible) {
    return (
      <div ref={containerRef} aria-busy="false" aria-label={`${title} is waiting to load`}>
        <Panel title={title} sub={sub}>
          <p className="analyticsPanelDeferred" role="status">
            <Eye size={15} aria-hidden="true" />
            Loads when this panel enters view
          </p>
        </Panel>
      </div>
    );
  }

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
        <>
          {children(result.data)}
          {panelUpdates[title] && (
            <p className="analyticsPanelUpdated">
              Updated {new Intl.DateTimeFormat("en-US", {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(panelUpdates[title])}
            </p>
          )}
        </>}
    </Panel>
  );
}
