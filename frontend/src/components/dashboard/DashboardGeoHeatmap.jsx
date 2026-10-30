import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Users,
  ShoppingBag,
  DollarSign,
  MapPin,
  TrendingUp,
  Star,
  Clock,
  ArrowRight,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { Panel } from "../States";
import {
  BRAZIL_MAP_VIEWBOX,
  BRAZIL_REGIONS,
  BRAZIL_STATES,
} from "./brazilMapData";
import { dashboardService } from "../../services/api";
import { useTheme } from "../../context/ThemeContext";

// Formatters
const fmtNum = (v) => Number(v || 0).toLocaleString("en-US");
const fmtBRL = (v) =>
  `R$ ${Number(v || 0).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  })}`;

// Dark Mode Color Ramp (Subtle deep navy -> Electric cyan)
const DARK_COLOR_STOPS = [
  { stop: 0.0, color: "#1e293b" }, // Empty / baseline
  { stop: 0.12, color: "#1e3a8a" }, // Very low
  { stop: 0.28, color: "#1d4ed8" }, // Low
  { stop: 0.48, color: "#0284c7" }, // Medium
  { stop: 0.70, color: "#0ea5e9" }, // High
  { stop: 0.88, color: "#38bdf8" }, // Very high
  { stop: 1.0, color: "#67e8f9" }, // Hotspot (e.g. SP)
];

// Light Mode Color Ramp (Crisp Sky -> Cyan Blue -> Royal Blue -> Deep Sapphire)
const LIGHT_COLOR_STOPS = [
  { stop: 0.0, color: "#e0f2fe" }, // Baseline soft sky blue (crisp contrast on light bg)
  { stop: 0.15, color: "#7dd3fc" }, // Low-tier (e.g. North/Northeast states)
  { stop: 0.35, color: "#38bdf8" }, // Medium-low (e.g. Central-West/South)
  { stop: 0.55, color: "#0284c7" }, // Medium (e.g. RS, PR)
  { stop: 0.75, color: "#1d4ed8" }, // High (e.g. MG, RJ)
  { stop: 1.0, color: "#1e3a8a" }, // Hotspot (SP - deep royal sapphire)
];

function interpolateColor(ratio, isDark = false) {
  const stops = isDark ? DARK_COLOR_STOPS : LIGHT_COLOR_STOPS;
  const r = Math.max(0, Math.min(1, ratio));
  for (let i = 0; i < stops.length - 1; i++) {
    const s1 = stops[i];
    const s2 = stops[i + 1];
    if (r >= s1.stop && r <= s2.stop) {
      const t = (r - s1.stop) / (s2.stop - s1.stop);
      const c1 = hexToRgb(s1.color);
      const c2 = hexToRgb(s2.color);
      const red = Math.round(c1.r + (c2.r - c1.r) * t);
      const green = Math.round(c1.g + (c2.g - c1.g) * t);
      const blue = Math.round(c1.b + (c2.b - c1.b) * t);
      return `rgb(${red}, ${green}, ${blue})`;
    }
  }
  return stops[stops.length - 1].color;
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
  };
}

export default function DashboardGeoHeatmap({
  geoDistribution = [],
  topCities = [],
  kpis = {},
  navigate,
  timeframe = "all",
}) {
  const themeContext = useTheme();
  const isDark = themeContext ? themeContext.isDark : false;
  const [activeMetric, setActiveMetric] = useState("customers"); // 'customers' | 'orders' | 'revenue'
  const [selectedRegion, setSelectedRegion] = useState("all");
  const [hoveredState, setHoveredState] = useState(null);
  const [selectedState, setSelectedState] = useState(null);
  const [stateDetailData, setStateDetailData] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailRetry, setDetailRetry] = useState(0);
  const detailCache = useRef({});

  // Map state distribution into lookup dictionary keyed by UF code
  const statesMap = useMemo(() => {
    const map = {};
    (geoDistribution || []).forEach((item) => {
      if (item && item.state) {
        map[item.state] = item;
      }
    });
    return map;
  }, [geoDistribution]);

  // Compute min, max, total for the active metric across all 27 states
  const metricStats = useMemo(() => {
    const values = Object.keys(BRAZIL_STATES).map((uf) => {
      const data = statesMap[uf];
      if (!data) return 0;
      return Number(data[activeMetric] || 0);
    });

    const max = Math.max(...values, 1);
    const min = Math.min(...values);
    const total = values.reduce((a, b) => a + b, 0) || 1;
    return { min, max, total };
  }, [statesMap, activeMetric]);

  // Compute regional summary stats
  const regionalSummary = useMemo(() => {
    const summary = {};
    BRAZIL_REGIONS.filter((r) => r.key !== "all").forEach((r) => {
      summary[r.key] = { customers: 0, orders: 0, revenue: 0, count: 0 };
    });

    Object.keys(BRAZIL_STATES).forEach((uf) => {
      const meta = BRAZIL_STATES[uf].meta;
      const data = statesMap[uf] || {};
      const reg = meta.region;
      if (summary[reg]) {
        summary[reg].customers += Number(data.customers || 0);
        summary[reg].orders += Number(data.orders || 0);
        summary[reg].revenue += Number(data.revenue || 0);
        summary[reg].count += 1;
      }
    });

    return summary;
  }, [statesMap]);

  // Fetch detailed breakdown when a state is selected
  useEffect(() => {
    let active = true;
    if (!selectedState) {
      setStateDetailData(null);
      setDetailError("");
      setLoadingDetail(false);
      return () => {
        active = false;
      };
    }

    const cacheKey = `${selectedState}_${timeframe}`;
    if (detailCache.current[cacheKey]) {
      setStateDetailData(detailCache.current[cacheKey]);
      setDetailError("");
      setLoadingDetail(false);
      return () => {
        active = false;
      };
    }

    setDetailError("");
    setLoadingDetail(true);
    dashboardService
      .stateDetail(selectedState, { timeframe })
      .then((data) => {
        if (!active) return;
        detailCache.current[cacheKey] = data;
        setStateDetailData(data);
      })
      .catch((requestError) => {
        if (active) setDetailError(requestError.message);
      })
      .finally(() => {
        if (active) setLoadingDetail(false);
      });
    return () => {
      active = false;
    };
  }, [selectedState, timeframe, detailRetry]);

  // Metrics definition
  const metrics = [
    { key: "customers", label: "Customers", icon: Users, format: fmtNum },
    { key: "orders", label: "Orders", icon: ShoppingBag, format: fmtNum },
    { key: "revenue", label: "Revenue", icon: DollarSign, format: fmtBRL },
  ];

  const currentMetricDef = metrics.find((m) => m.key === activeMetric);

  // Active state data (from summary geoDistribution)
  const activeStateData = selectedState ? statesMap[selectedState] || null : null;
  const activeStateMeta = selectedState ? BRAZIL_STATES[selectedState]?.meta : null;

  // Derive legend gradient style directly from active theme color ramp
  const activeStops = isDark ? DARK_COLOR_STOPS : LIGHT_COLOR_STOPS;
  const legendGradientStyle = {
    background: `linear-gradient(90deg, ${activeStops
      .map((s) => `${s.color} ${Math.round(s.stop * 100)}%`)
      .join(", ")})`,
  };

  return (
    <Panel
      title="Brazilian Market Geolocation Heatmap"
      sub="Territorial customer density, order volumes & revenue across 27 federative units"
      className="dashGeoPanel"
    >
      <div className="geoHeatmapContainer">
        {/* Top Control Bar: Metric Switcher & Region Filters */}
        <div className="geoControlBar">
          {/* Metric Selector Pills */}
          <div className="geoMetricToggleGroup" role="tablist" aria-label="Heatmap Metric">
            {metrics.map((m) => {
              const Icon = m.icon;
              const isActive = activeMetric === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  className={`geoMetricBtn ${isActive ? "active" : ""}`}
                  onClick={() => setActiveMetric(m.key)}
                  role="tab"
                  aria-selected={isActive}
                >
                  <Icon size={14} />
                  <span>{m.label}</span>
                </button>
              );
            })}
          </div>

          {/* Region Filter Chips */}
          <div className="geoRegionChips" role="group" aria-label="Region Filter">
            {BRAZIL_REGIONS.map((reg) => {
              const isSelected = selectedRegion === reg.key;
              return (
                <button
                  key={reg.key}
                  type="button"
                  className={`geoRegionChip ${isSelected ? "active" : ""}`}
                  onClick={() => setSelectedRegion(reg.key)}
                >
                  {reg.label.split(" (")[0]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Main 2-Column Section: Map on Left, Intelligence Panel on Right */}
        <div className="geoMainGrid">
          {/* MAP CANVAS */}
          <div className="geoMapWrapper">
            <svg
              viewBox={BRAZIL_MAP_VIEWBOX}
              className="geoSvgMap"
              xmlns="http://www.w3.org/2000/svg"
              role="img"
              aria-label="Interactive Map of Brazilian States"
            >
              <defs>
                {/* Glow filter for hovered / active states */}
                <filter id="geoGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor={isDark ? "#38bdf8" : "#0284c7"} floodOpacity={isDark ? "0.8" : "0.5"} />
                </filter>
                <filter id="geoSelectGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow
                    dx="0"
                    dy="0"
                    stdDeviation="3"
                    floodColor={isDark ? "#ffffff" : "#0f172a"}
                    floodOpacity={isDark ? "0.8" : "0.3"}
                  />
                </filter>
              </defs>

              {/* RENDER ALL 27 BRAZILIAN STATES (selected/hovered states rendered last to layer on top) */}
              {Object.keys(BRAZIL_STATES)
                .sort((a, b) => {
                  if (a === selectedState) return 1;
                  if (b === selectedState) return -1;
                  if (a === hoveredState?.uf) return 1;
                  if (b === hoveredState?.uf) return -1;
                  return 0;
                })
                .map((uf) => {
                const shape = BRAZIL_STATES[uf];
                const data = statesMap[uf] || {};
                const value = Number(data[activeMetric] || 0);
                const valRange = Math.max(1, metricStats.max - metricStats.min);
                const rawRatio = Math.max(0, Math.min(1, (value - metricStats.min) / valRange));
                // Power scaling (gamma = 0.55) to bring out regional tiering across Brazil
                const ratio = rawRatio > 0 ? Math.pow(rawRatio, 0.55) : 0;
                const fillColor = interpolateColor(ratio, isDark);

                const isHovered = hoveredState?.uf === uf;
                const isSelected = selectedState === uf;
                const matchesRegion =
                  selectedRegion === "all" || shape.meta.region === selectedRegion;

                const opacity = matchesRegion ? 1 : 0.22;
                const strokeColor = isSelected
                  ? (isDark ? "#ffffff" : "#0f172a")
                  : isHovered
                  ? (isDark ? "#38bdf8" : "#0284c7")
                  : (isDark ? "#475569" : "#64748b");
                const strokeWidth = isSelected ? 2.5 : isHovered ? 1.8 : 0.8;
                const filter = isSelected
                  ? "url(#geoSelectGlow)"
                  : isHovered
                  ? "url(#geoGlow)"
                  : undefined;

                const commonProps = {
                  id: `state-${uf}`,
                  fill: fillColor,
                  stroke: strokeColor,
                  strokeWidth: strokeWidth,
                  strokeLinecap: "round",
                  strokeLinejoin: "round",
                  filter: filter,
                  opacity: opacity,
                  cursor: "pointer",
                  tabIndex: 0,
                  role: "button",
                  "aria-label": `${shape.meta.name} (${uf}): ${currentMetricDef.format(value)}`,
                  onMouseEnter: (e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHoveredState({
                      uf,
                      meta: shape.meta,
                      data: data,
                      value: value,
                      centroid: shape.centroid,
                      x: rect.left,
                      y: rect.top,
                    });
                  },
                  onMouseLeave: () => setHoveredState(null),
                  onClick: () => {
                    setSelectedState(selectedState === uf ? null : uf);
                  },
                  onKeyDown: (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      setSelectedState(selectedState === uf ? null : uf);
                    }
                  },
                };

                return shape.type === "polygon" ? (
                  <polygon key={uf} points={shape.points} {...commonProps} />
                ) : (
                  <path key={uf} d={shape.d} {...commonProps} />
                );
              })}

              {/* STATE CODE LABELS AT CENTROIDS */}
              {Object.keys(BRAZIL_STATES).map((uf) => {
                const shape = BRAZIL_STATES[uf];
                const matchesRegion =
                  selectedRegion === "all" || shape.meta.region === selectedRegion;
                if (!matchesRegion) return null;

                const [cx, cy] = shape.centroid;
                const isSelected = selectedState === uf;
                const stateData = statesMap[uf] || {};
                const stateVal = Number(stateData[activeMetric] || 0);
                const valRange = Math.max(1, metricStats.max - metricStats.min);
                const rawRatio = Math.max(0, Math.min(1, (stateVal - metricStats.min) / valRange));
                const stateRatio = rawRatio > 0 ? Math.pow(rawRatio, 0.55) : 0;
                const textFill = isDark
                  ? "#ffffff"
                  : stateRatio > 0.45
                  ? "#ffffff"
                  : "#0f172a";

                return (
                  <text
                    key={`lbl-${uf}`}
                    x={cx}
                    y={cy + 3}
                    textAnchor="middle"
                    className="geoStateLabel"
                    style={{
                      fill: textFill,
                      fontWeight: isSelected ? 800 : 700,
                      fontSize: uf === "DF" || uf === "SE" ? "6.5px" : "7.5px",
                      pointerEvents: "none",
                    }}
                  >
                    {uf}
                  </text>
                );
              })}
            </svg>

            {/* FLOATING HOVER TOOLTIP */}
            {hoveredState && (
              <div className="geoTooltipCard">
                <div className="geoTooltipHeader">
                  <div>
                    <strong className="geoTooltipTitle">
                      {hoveredState.meta.name} ({hoveredState.uf})
                    </strong>
                    <span className="geoTooltipRegion">
                      {hoveredState.meta.region} • Cap: {hoveredState.meta.capital}
                    </span>
                  </div>
                  <span className="geoTooltipPct">
                    {metricStats.total > 0
                      ? `${((hoveredState.value / metricStats.total) * 100).toFixed(1)}%`
                      : "0%"}
                  </span>
                </div>

                <div className="geoTooltipMetricRow">
                  <span className="geoTooltipMetricLabel">{currentMetricDef.label}:</span>
                  <span className="geoTooltipMetricVal">
                    {currentMetricDef.format(hoveredState.value)}
                  </span>
                </div>

                <div className="geoTooltipSubStats">
                  <span>
                    Cust: {fmtNum(hoveredState.data?.customers)}
                  </span>
                  <span>•</span>
                  <span>
                    Orders: {fmtNum(hoveredState.data?.orders)}
                  </span>
                  <span>•</span>
                  <span>
                    Rev: {fmtBRL(hoveredState.data?.revenue)}
                  </span>
                </div>
                <div className="geoTooltipHint">Click to inspect state details</div>
              </div>
            )}

            {/* COLOR RAMP LEGEND */}
            <div className="geoLegendBar">
              <div className="geoLegendHeader">
                <span className="geoLegendLabel">Low Density</span>
                <span className="geoLegendLabel">High Concentration</span>
              </div>
              <div className="geoLegendGradient" style={legendGradientStyle} />
              <div className="geoLegendValues">
                <span>{currentMetricDef.format(metricStats.min)}</span>
                <span>{currentMetricDef.format(Math.round(metricStats.max / 2))}</span>
                <span>{currentMetricDef.format(metricStats.max)}</span>
              </div>
            </div>
          </div>

          {/* STATE INTELLIGENCE & REGIONAL DRILLDOWN PANEL */}
          <div className="geoDetailPanel">
            {selectedState && activeStateMeta ? (
              <div className="geoStateCard">
                {/* State Card Header */}
                <div className="geoStateHeader">
                  <div className="geoStateTitleWrap">
                    <div className="geoStateBadge">{selectedState}</div>
                    <div>
                      <h3 className="geoStateTitle">{activeStateMeta.name}</h3>
                      <div className="geoStateSub">
                        <span>{activeStateMeta.region} Region</span>
                        <span>•</span>
                        <span>Capital: {activeStateMeta.capital}</span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="geoResetBtn"
                    onClick={() => setSelectedState(null)}
                    title="Clear selection and view national overview"
                  >
                    <RotateCcw size={13} />
                    <span>Overview</span>
                  </button>
                </div>

                {/* State KPI Grid */}
                <div className="geoStateKpiGrid">
                  <div className="geoStateKpiBox">
                    <span className="geoKpiBoxLabel">Customers</span>
                    <strong className="geoKpiBoxVal">
                      {fmtNum(stateDetailData?.customers || activeStateData?.customers)}
                    </strong>
                    <span className="geoKpiBoxSub">
                      {activeStateData?.pct_customers ?? 0}% of national
                    </span>
                  </div>

                  <div className="geoStateKpiBox">
                    <span className="geoKpiBoxLabel">Orders</span>
                    <strong className="geoKpiBoxVal">
                      {fmtNum(stateDetailData?.orders || activeStateData?.orders)}
                    </strong>
                    <span className="geoKpiBoxSub">
                      {activeStateData?.pct_orders ?? 0}% of national
                    </span>
                  </div>

                  <div className="geoStateKpiBox">
                    <span className="geoKpiBoxLabel">Total Revenue</span>
                    <strong className="geoKpiBoxVal highlight">
                      {fmtBRL(stateDetailData?.revenue || activeStateData?.revenue)}
                    </strong>
                    <span className="geoKpiBoxSub">
                      {activeStateData?.pct_revenue ?? 0}% market share
                    </span>
                  </div>

                  <div className="geoStateKpiBox">
                    <span className="geoKpiBoxLabel">Avg Order Value</span>
                    <strong className="geoKpiBoxVal">
                      {fmtBRL(stateDetailData?.aov || activeStateData?.aov)}
                    </strong>
                    <span className="geoKpiBoxSub">AOV per order</span>
                  </div>
                </div>

                {/* Performance Highlights (Delivery & CSAT) */}
                {stateDetailData && (
                  <div className="geoPerformanceBar">
                    <div className="geoPerfItem">
                      <Clock size={14} className="geoPerfIcon" />
                      <span>
                        Avg Delivery: <b>{stateDetailData.avg_delivery_days} days</b>
                      </span>
                    </div>
                    <div className="geoPerfItem">
                      <Star size={14} className="geoPerfIcon yellow" />
                      <span>
                        CSAT Score: <b>{stateDetailData.avg_rating} ★</b>
                      </span>
                    </div>
                  </div>
                )}

                {/* Top Cities in Selected State */}
                <div className="geoSectionWrap">
                  <h4 className="geoSectionTitle">
                    <MapPin size={14} />
                    <span>Top Cities in {activeStateMeta.name}</span>
                  </h4>

                  {loadingDetail ? (
                    <div className="geoLoadingText">Loading cities breakdown...</div>
                  ) : detailError ? (
                    <div className="geoDetailError">
                      <span>{detailError}</span>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => setDetailRetry((retry) => retry + 1)}
                      >
                        Retry city details
                      </button>
                    </div>
                  ) : stateDetailData?.top_cities && stateDetailData.top_cities.length > 0 ? (
                    <div className="geoCityList">
                      {stateDetailData.top_cities.map((c, idx) => {
                        const topCityRev = stateDetailData.top_cities[0]?.revenue || 1;
                        const pctBar = Math.min(100, Math.round((c.revenue / topCityRev) * 100));
                        return (
                          <div key={c.city} className="geoCityRow">
                            <div className="geoCityHeader">
                              <span className="geoCityRank">{idx + 1}</span>
                              <span className="geoCityName">{c.city}</span>
                              <span className="geoCityRev">{fmtBRL(c.revenue)}</span>
                            </div>
                            <div className="geoCityBarTrack">
                              <div
                                className="geoCityBarFill"
                                style={{ width: `${pctBar}%` }}
                              />
                            </div>
                            <div className="geoCityFooter">
                              <span>{fmtNum(c.customers)} customers</span>
                              <span>{fmtNum(c.orders)} orders</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="geoEmptyText">No city data available for this timeframe.</div>
                  )}
                </div>

                {/* Shortcut link to Customers page filtered by this state */}
                <div className="geoActionRow">
                  <button
                    type="button"
                    className="geoCtaBtn"
                    onClick={() => navigate && navigate(`/customers?state=${selectedState}`)}
                  >
                    <span>View {activeStateMeta.name} Customers</span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            ) : (
              /* NATIONAL OVERVIEW (When no specific state is selected) */
              <div className="geoNationalCard">
                <div className="geoNationalHeader">
                  <div className="geoNatTitleWrap">
                    <Sparkles size={16} className="text-accent" />
                    <h3 className="geoStateTitle">National Market Overview</h3>
                  </div>
                  <span className="geoNatSubtitle">
                    27 Federative Units • Select a state to drill down
                  </span>
                </div>

                {/* Top 5 States Volume Leaderboard */}
                <div className="geoSectionWrap">
                  <h4 className="geoSectionTitle">
                    <TrendingUp size={14} />
                    <span>Top States Leaderboard</span>
                  </h4>
                  <div className="geoLeaderList">
                    {(geoDistribution || []).slice(0, 5).map((st, idx) => {
                      const maxRev = (geoDistribution[0]?.revenue || 1);
                      const pctBar = Math.min(100, Math.round((st.revenue / maxRev) * 100));
                      return (
                        <div
                          key={st.state}
                          className="geoLeaderRow"
                          onClick={() => setSelectedState(st.state)}
                          role="button"
                          tabIndex={0}
                        >
                          <div className="geoLeaderInfo">
                            <span className="geoRankPill">{idx + 1}</span>
                            <span className="geoStateCode">{st.state}</span>
                            <span className="geoStateName">{st.name || st.state}</span>
                            <strong className="geoLeaderRev">{fmtBRL(st.revenue)}</strong>
                          </div>
                          <div className="geoCityBarTrack">
                            <div
                              className="geoCityBarFill"
                              style={{ width: `${pctBar}%` }}
                            />
                          </div>
                          <div className="geoLeaderMeta">
                            <span>{fmtNum(st.customers)} cust.</span>
                            <span>{st.pct_revenue ?? 0}% market share</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Regional Breakdown Share */}
                <div className="geoSectionWrap">
                  <h4 className="geoSectionTitle">
                    <span>Regional Market Share</span>
                  </h4>
                  <div className="geoRegionGrid">
                    {Object.keys(regionalSummary).map((regKey) => {
                      const reg = regionalSummary[regKey];
                      const regMetricVal = Number(reg[activeMetric] || 0);
                      const sharePct = metricStats.total > 0
                        ? ((regMetricVal / metricStats.total) * 100).toFixed(1)
                        : "0.0";
                      return (
                        <div
                          key={regKey}
                          className="geoRegionCard"
                          onClick={() => setSelectedRegion(regKey)}
                          role="button"
                          tabIndex={0}
                        >
                          <div className="geoRegCardHeader">
                            <span className="geoRegCardTitle">{regKey}</span>
                            <span className="geoRegCardShare">{sharePct}%</span>
                          </div>
                          <div className="geoRegCardNumbers">
                            <span>{fmtBRL(reg.revenue)}</span>
                            <span>{fmtNum(reg.customers)} cust.</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Top Cities Nationwide */}
                {topCities && topCities.length > 0 && (
                  <div className="geoSectionWrap">
                    <h4 className="geoSectionTitle">
                      <MapPin size={14} />
                      <span>Top Cities Nationwide</span>
                    </h4>
                    <div className="geoTopCitiesGrid">
                      {topCities.slice(0, 6).map((c) => (
                        <div
                          key={`${c.city}-${c.state}`}
                          className="geoTopCityBadge"
                          onClick={() => setSelectedState(c.state)}
                          role="button"
                          tabIndex={0}
                        >
                          <div className="geoTopCityName">
                            {c.city} ({c.state})
                          </div>
                          <div className="geoTopCityVal">{fmtBRL(c.revenue)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}
