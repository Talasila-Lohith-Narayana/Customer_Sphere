import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Panel } from "../States";
import { SegmentBarTooltip, getSegmentChurnColor } from "./dashboardConstants";

export default function DashboardCustomerSegments({ segments = [], navigate }) {
  return (
    <Panel title="Predicted churn risk" sub="Model probability bands · Click a band to view customers">
      <div className="chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={segments}
            layout="vertical"
            margin={{ top: 8, right: 12, left: 4, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line, #f1f5f9)" />
            <XAxis
              type="number"
              tick={{ fill: "#64748b", fontSize: 11 }}
              tickMargin={8}
            />
            <YAxis
              type="category"
              dataKey="segment"
              width={110}
              tick={{ fill: "var(--text-muted, #475569)", fontSize: 11, fontWeight: 500 }}
              tickMargin={8}
            />
            <Tooltip content={<SegmentBarTooltip />} cursor={{ fill: "rgba(255, 255, 255, 0.05)" }} />
            <Bar
              dataKey="count"
              radius={[0, 6, 6, 0]}
              style={{ cursor: "pointer" }}
              onClick={(entry) => {
                if (entry?.segment) {
                  const riskLevel = entry.segment.toLowerCase().replace(" risk", "");
                  navigate(`/customers?churn_risk=${encodeURIComponent(riskLevel)}`);
                }
              }}
            >
              {segments.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={getSegmentChurnColor(
                    entry.churn_percentage ?? entry.churnPercentage,
                  )}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}
