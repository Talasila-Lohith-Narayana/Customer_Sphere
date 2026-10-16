import React from "react";
import {
  Repeat2,
  ShoppingBag,
  TrendingUp,
  Truck,
  Users,
  WalletCards,
} from "lucide-react";
function DeltaBadge({ pctChange, tooltip }) {
  if (pctChange == null) return null;
  const isPositive = pctChange > 0;
  const isNegative = pctChange < 0;
  const color = isPositive ? "#10b981" : isNegative ? "#f43f5e" : "#94a3b8";
  const bg = isPositive
    ? "rgba(16, 185, 129, 0.12)"
    : isNegative
    ? "rgba(244, 63, 94, 0.12)"
    : "rgba(148, 163, 184, 0.1)";
  const arrow = isPositive ? "↑" : isNegative ? "↓" : "—";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        background: bg,
        color,
        fontSize: 10,
        fontWeight: 700,
        padding: "2px 7px",
        borderRadius: 999,
        marginLeft: 6,
        animation: "fadeSlideIn 0.4s ease-out",
        border: `1px solid ${color}22`,
      }}
      title={tooltip || `${pctChange > 0 ? "+" : ""}${pctChange}% vs comparison period`}
    >
      {arrow} {Math.abs(pctChange)}%
    </span>
  );
}

export default function DashboardKpiCards({ kpis = {}, repeatRate, navigate, comparison }) {
  // Map KPI keys to the comparison data keys
  const compMap = {
    "Total Customers": "customers",
    "Gross Revenue": "revenue",
    "Total Orders": "orders",
    "Avg Order Value": "avg_order_value",
    "Avg Fulfillment": "avg_delivery_days",
    "Repeat Rate": "repeat_rate",
  };

  const metrics = [
    {
      label: "Total Customers",
      value: Number(kpis.customers || 0).toLocaleString("en-US"),
      icon: Users,
      badgeText: `${Number(kpis.repeat_customers || 0).toLocaleString("en-US")} repeat customers`,
      badgeColor: "blue",
      theme: "blue",
      onClick: () => navigate("/customers"),
      linkHint: "View Directory",
    },
    {
      label: "Gross Revenue",
      value: `R$ ${Number(kpis.revenue || 0).toLocaleString("en-US")}`,
      icon: WalletCards,
      badgeText: "Historical marketplace GMV",
      badgeColor: "emerald",
      theme: "emerald",
      onClick: () => navigate("/customers?sort=spend-desc"),
      linkHint: "Top Spenders",
    },
    {
      label: "Total Orders",
      value: Number(kpis.orders || 0).toLocaleString("en-US"),
      icon: ShoppingBag,
      badgeText: `${(Number(kpis.orders || 0) / (Number(kpis.customers) || 1)).toFixed(2)} orders / customer`,
      badgeColor: "indigo",
      theme: "indigo",
      onClick: () => navigate("/customers?activity=active"),
      linkHint: "Active Buyers",
    },
    {
      label: "Avg Order Value",
      value: `R$ ${Number(kpis.avg_order_value || 0).toFixed(2)}`,
      icon: TrendingUp,
      badgeText: "Average ticket size per order",
      badgeColor: "amber",
      theme: "amber",
      onClick: () => navigate("/products?sort=price_desc"),
      linkHint: "Premium Catalog",
    },
    {
      label: "Avg Fulfillment",
      value: `${Number(kpis.avg_delivery_days || 0).toFixed(1)} days`,
      icon: Truck,
      badgeText: "Order placement to delivery",
      badgeColor: "teal",
      theme: "teal",
      onClick: () => navigate("/customers"),
      linkHint: "Customer SLAs",
    },
    {
      label: "Repeat Rate",
      value: `${repeatRate}%`,
      icon: Repeat2,
      badgeText: "Multi-order retention",
      badgeColor: "purple",
      theme: "purple",
      onClick: () => navigate("/customers?activity=active&min_orders=2"),
      linkHint: "Repeat customers",
    },
  ];

  return (
    <div className="kpis">
      {metrics.map((m) => {
        const Icon = m.icon;
        const compKey = compMap[m.label];

        let delta = null;
        let deltaTooltip = null;

        if (comparison) {
          if (m.label === "Repeat Rate") {
            if (comparison.repeat_rate?.pct_change != null) {
              delta = comparison.repeat_rate.pct_change;
              const ppDelta = comparison.repeat_rate.delta;
              if (ppDelta != null) {
                deltaTooltip = `${delta > 0 ? "+" : ""}${delta}% (${ppDelta > 0 ? "+" : ""}${ppDelta} pp) vs comparison period`;
              }
            } else if (comparison.repeat_customers && comparison.customers) {
              const curCust = Number(comparison.customers.current || kpis.customers || 0);
              const prevCust = Number(comparison.customers.previous || 0);
              const curRep = Number(comparison.repeat_customers.current || kpis.repeat_customers || 0);
              const prevRep = Number(comparison.repeat_customers.previous || 0);
              const curRate = curCust > 0 ? (curRep / curCust) * 100 : 0;
              const prevRate = prevCust > 0 ? (prevRep / prevCust) * 100 : 0;
              if (prevRate > 0) {
                delta = Number((((curRate - prevRate) / prevRate) * 100).toFixed(1));
                const ppDelta = Number((curRate - prevRate).toFixed(1));
                deltaTooltip = `${delta > 0 ? "+" : ""}${delta}% (${ppDelta > 0 ? "+" : ""}${ppDelta} pp) vs comparison period`;
              }
            }
          } else if (compKey && comparison[compKey]) {
            delta = comparison[compKey].pct_change;
          }
        }

        return (
          <div
            className="kpi"
            key={m.label}
            onClick={m.onClick}
            style={{ cursor: "pointer" }}
            title={`Click to jump: ${m.linkHint}`}
          >
            <div className="kpiContent">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span
                  className="kpiLabel"
                  title={
                    m.label === "Total Customers"
                      ? "Counts unique customers in the selected period. Yearly counts can overlap when a customer is active in multiple years."
                      : undefined
                  }
                >
                  {m.label}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap" }}>
                <b className="kpiValue">{m.value}</b>
                {delta != null && <DeltaBadge pctChange={delta} tooltip={deltaTooltip} />}
              </div>
              <div className="kpiSub">
                <span className={`metricBadge ${m.badgeColor}`}>{m.badgeText}</span>
              </div>
            </div>
            <div className={`kpiIconWrapper ${m.theme}`}>
              <Icon size={22} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
