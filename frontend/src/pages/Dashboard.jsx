import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { dashboardService } from "../services/api";
import { ErrorState, LoadingState, Page } from "../components/States";

// Modular dashboard components
import DashboardHeroBanner from "../components/dashboard/DashboardHeroBanner";
import DashboardKpiCards from "../components/dashboard/DashboardKpiCards";
import { COMPARISON_PERIODS } from "../components/dashboard/dashboardConstants";
import DeferredDashboardSection, {
  DashboardSectionSkeleton,
} from "../components/dashboard/DeferredDashboardSection";
import { subscribeToDashboardDataChanges } from "../services/dashboardDataEvents";

const DashboardRevenueTrend = lazy(() => import("../components/dashboard/DashboardRevenueTrend"));
const DashboardCustomerSegments = lazy(() => import("../components/dashboard/DashboardCustomerSegments"));
const DashboardGeoHeatmap = lazy(() => import("../components/dashboard/DashboardGeoHeatmap"));
const DASHBOARD_POLL_INTERVAL_MS = 1 * 60 * 1000;

function getDashboardParams(selectedTime, range, compare, compPeriod) {
  const params =
    selectedTime === "custom"
      ? { timeframe: "custom", start_date: range.startDate, end_date: range.endDate }
      : { timeframe: selectedTime };

  if (compare && compPeriod) params.compare_to = compPeriod;
  return params;
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const requestId = useRef(0);
  const [refreshToken, setRefreshToken] = useState(0);
  const [refreshError, setRefreshError] = useState("");
  const [timeframe, setTimeframe] = useState("all");
  const [customRange, setCustomRange] = useState({
    startDate: "2017-01-01",
    endDate: "2018-08-31",
  });
  const [compareMode, setCompareMode] = useState(false);
  const [compareTo, setCompareTo] = useState(COMPARISON_PERIODS.all?.key || "");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const load = useCallback((
    selectedTime = timeframe,
    range = customRange,
    compare = compareMode,
    compPeriod = compareTo,
    isBackgroundRefresh = false,
  ) => {
    const currentRequestId = ++requestId.current;
    if (!isBackgroundRefresh) setError("");
    return dashboardService
      .summary({
        ...getDashboardParams(selectedTime, range, compare, compPeriod),
        sections: "core",
      })
      .then((response) => {
        if (currentRequestId === requestId.current) {
          setData(response);
          setRefreshError("");
        }
      })
      .catch((requestError) => {
        if (currentRequestId === requestId.current) {
          if (isBackgroundRefresh) setRefreshError(requestError.message);
          else setError(requestError.message);
        }
      });
  }, [timeframe, customRange, compareMode, compareTo]);

  const refreshDashboard = useCallback((fromAnotherTab = false) => {
    if (!fromAnotherTab && document.visibilityState !== "visible") return;
    setRefreshToken((token) => token + 1);
    load(timeframe, customRange, compareMode, compareTo, true);
  }, [load, timeframe, customRange, compareMode, compareTo]);

  const deferredParams = getDashboardParams(timeframe, customRange, compareMode, compareTo);
  const loadSection = useCallback(
    (section) => dashboardService.section(section, deferredParams),
    [timeframe, customRange.startDate, customRange.endDate, compareMode, compareTo],
  );

  useEffect(() => {
    if (timeframe !== "custom") {
      // Auto-set comparison period when timeframe changes
      const defaultComp = COMPARISON_PERIODS[timeframe];
      if (defaultComp && !compareTo) {
        setCompareTo(defaultComp.key);
      }
      load(timeframe, customRange, compareMode, compareTo || defaultComp?.key);
    }
  }, [timeframe, compareMode, compareTo]);

  useEffect(() => {
    if (!data) return undefined;

    const intervalId = window.setInterval(() => {
      refreshDashboard();
    }, DASHBOARD_POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [data !== null, refreshDashboard]);

  useEffect(() => {
    if (!data) return undefined;
    return subscribeToDashboardDataChanges(() => refreshDashboard(true));
  }, [data !== null, refreshDashboard]);

  const handleApplyCustom = (e) => {
    e?.preventDefault();
    setTimeframe("custom");
    load("custom", customRange, compareMode, compareTo);
  };

  const handleToggleCompare = () => {
    const next = !compareMode;
    setCompareMode(next);
    if (next) {
      const defaultComp = COMPARISON_PERIODS[timeframe];
      const cp = compareTo || defaultComp?.key || "2017";
      setCompareTo(cp);
      load(timeframe, customRange, true, cp);
    } else {
      load(timeframe, customRange, false, "");
    }
  };

  if (error)
    return (
      <Page>
        <ErrorState message={error} retry={() => load(timeframe, customRange, compareMode, compareTo)} />
      </Page>
    );

  const kpis = data?.kpis || {};
  const repeatRate =
    kpis.repeat_rate != null
      ? Number(kpis.repeat_rate).toFixed(1)
      : kpis.customers > 0
      ? ((Number(kpis.repeat_customers || 0) / Number(kpis.customers)) * 100).toFixed(1)
      : "0.0";

  return (
    <Page>
      {/* Hero Welcome Banner with Time Horizon Picker */}
      <DashboardHeroBanner
        data={data}
        timeframe={timeframe}
        setTimeframe={setTimeframe}
        customRange={customRange}
        setCustomRange={setCustomRange}
        handleApplyCustom={handleApplyCustom}
        load={load}
        compareMode={compareMode}
        compareTo={compareTo}
        setCompareTo={setCompareTo}
        onToggleCompare={handleToggleCompare}
      />
      {refreshError && (
        <div className="dashboardRefreshNotice" role="alert">
          <span>Could not refresh dashboard data: {refreshError}</span>
          <button
            type="button"
            className="btn ghost"
            onClick={() => load(timeframe, customRange, compareMode, compareTo, true)}
          >
            Retry now
          </button>
        </div>
      )}

      {/* KPI Cards Grid with Interactive Shortcuts */}
      <div className="dashboardSectionIntro">
        <h2>Business at a glance</h2>
        <p>Headline totals use the selected time period; repeat rate is the share of customers with more than one order.</p>
      </div>
      {data ? (
        <DashboardKpiCards
          kpis={kpis}
          repeatRate={repeatRate}
          navigate={navigate}
          comparison={data.comparison || null}
        />
      ) : (
        <div className="dashboardKpiLoading" role="status" aria-label="Loading key metrics">
          {Array.from({ length: 6 }, (_, index) => (
            <div className="dashboardKpiSkeleton" key={index} aria-hidden="true">
              <span className="dashboardSkeletonLine dashboardSkeletonLine--short" />
              <span className="dashboardSkeletonLine dashboardSkeletonLine--value" />
              <span className="dashboardSkeletonLine dashboardSkeletonLine--medium" />
            </div>
          ))}
          <span className="dashboardKpiLoadingLabel">
            <LoadingState text="Loading key metrics..." />
          </span>
        </div>
      )}

      {/* Primary Visualizations */}
      <div className="dashboardSectionIntro">
        <h2>Trends and customer mix</h2>
        <p>Monthly revenue and customer segments help show how purchasing behavior changes over time.</p>
      </div>
      <div className="grid2">
        <DeferredDashboardSection
          key={`trends-${JSON.stringify(deferredParams)}`}
          section="trends"
          title="Revenue and customer trends"
          loadSection={loadSection}
          refreshToken={refreshToken}
        >
          {(sectionData) => (
            <Suspense
              fallback={
                <div
                  className="dashboardLazyPlaceholderGroup dashboardLazyPlaceholderGroup--trends"
                  aria-busy="true"
                  aria-label="Loading trend charts"
                >
                  <DashboardSectionSkeleton section="trends" />
                </div>
              }
            >
              <>
                <DashboardRevenueTrend monthly={sectionData.monthly} />
                <DashboardCustomerSegments segments={sectionData.segments} navigate={navigate} />
              </>
            </Suspense>
          )}
        </DeferredDashboardSection>
      </div>

      {/* Brazilian Territorial Geolocation Heatmap */}
      <div className="dashboardSectionIntro dashboardSectionIntro--geography">
        <h2>Where customers shop</h2>
        <p>Explore the distribution of customers and orders across Brazilian states and cities.</p>
      </div>
      <DeferredDashboardSection
        key={`geography-${JSON.stringify(deferredParams)}`}
        section="geography"
        title="Geographic analytics"
        loadSection={loadSection}
        refreshToken={refreshToken}
      >
        {(sectionData) => (
          <Suspense
            fallback={
              <div
                className="dashboardLazyPlaceholderGroup dashboardLazyPlaceholderGroup--geography"
                aria-busy="true"
                aria-label="Loading geographic chart"
              >
                <DashboardSectionSkeleton section="geography" />
              </div>
            }
          >
            <DashboardGeoHeatmap
              geoDistribution={sectionData.geo_distribution}
              topCities={sectionData.top_cities || []}
              kpis={kpis}
              navigate={navigate}
              timeframe={timeframe}
            />
          </Suspense>
        )}
      </DeferredDashboardSection>
    </Page>
  );
}
