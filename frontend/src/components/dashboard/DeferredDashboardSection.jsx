import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, LoaderCircle } from "lucide-react";

export default function DeferredDashboardSection({
  section,
  title,
  loadSection,
  refreshToken,
  children,
}) {
  const containerRef = useRef(null);
  const inFlightRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);
  const [status, setStatus] = useState("pending");
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  const load = useCallback(() => {
    if (inFlightRef.current) return inFlightRef.current;
    setStatus("loading");
    setError("");
    const request = loadSection(section)
      .then((response) => {
        setData(response);
        setStatus("loaded");
      })
      .catch((requestError) => {
        setError(requestError.message);
        setStatus("error");
      })
      .finally(() => {
        inFlightRef.current = null;
      });
    inFlightRef.current = request;
    return request;
  }, [loadSection, section]);

  useEffect(() => {
    if (status !== "pending" || !containerRef.current) return undefined;

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
      { rootMargin: "150px 0px" },
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [status]);

  useEffect(() => {
    if (isVisible && status === "pending") load();
  }, [isVisible, load, status]);

  const lastRefreshTokenRef = useRef(refreshToken);
  useEffect(() => {
    if (lastRefreshTokenRef.current === refreshToken) return;
    lastRefreshTokenRef.current = refreshToken;
    if (status === "loaded" || status === "error") load();
  }, [load, refreshToken, status]);

  if (data !== null) {
    return (
      <div className="dashboardLazyLoaded" aria-busy={status === "loading"}>
        {children(data)}
        {status === "loading" && (
          <p className="dashboardLazyRefreshMessage" role="status">
            <LoaderCircle className="spin" size={15} />
            Refreshing {title.toLowerCase()}…
          </p>
        )}
        {status === "error" && (
          <div className="dashboardLazyRefreshError" role="alert">
            <span>Could not refresh {title.toLowerCase()}: {error}</span>
            <button className="btn ghost" type="button" onClick={load}>
              Retry
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`dashboardLazyPlaceholderGroup dashboardLazyPlaceholderGroup--${section}`}
      ref={containerRef}
      aria-busy={status === "loading"}
      aria-label={`${title} ${status === "loading" ? "loading" : "placeholder"}`}
    >
      <DashboardSectionSkeleton section={section} />
      {status === "error" ? (
        <div className="dashboardLazyStatus dashboardLazyStatus--error" role="alert">
          <p className="dashboardLazyError">
            <AlertTriangle size={16} /> {error}
          </p>
          <button className="btn ghost" type="button" onClick={load}>
            Retry {title}
          </button>
        </div>
      ) : (
        <p className="dashboardLazyMessage" role="status">
          {status === "loading" ? (
            <>
              <LoaderCircle className="spin" size={16} />
              Loading {title.toLowerCase()}…
            </>
          ) : (
            <>This section loads when you scroll to it</>
          )}
        </p>
      )}
    </div>
  );
}

export function DashboardSectionSkeleton({ section }) {
  const titles =
    section === "trends"
      ? ["Revenue growth trend", "Customer segments"]
      : ["Brazilian Market Geolocation Heatmap"];

  return titles.map((title, index) => (
    <section
      className={`panel dashboardLazyPlaceholder dashboardLazyPlaceholder--${section}`}
      key={title}
      aria-hidden="true"
    >
      <h2>{title}</h2>
      <div
        className={`dashboardSkeleton dashboardSkeleton--${section} dashboardSkeleton--${section}-${index + 1}`}
      >
        <span className="dashboardSkeletonLine dashboardSkeletonLine--short" />
        <span className="dashboardSkeletonChart" />
        <div className="dashboardSkeletonRows">
          <span />
          <span />
          <span />
        </div>
      </div>
    </section>
  ));
}
