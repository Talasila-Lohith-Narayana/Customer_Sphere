import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import AnalyticsPanel from "../components/analytics/AnalyticsPanel";
import { Page, Panel } from "../components/States";
import { analyticsService } from "../services/api";
import DataTable from "../components/DataTable";
import TablePagination from "../components/TablePagination";

const number = new Intl.NumberFormat("en-US");

function ActiveCampaigns({ data, onSelect }) {
  const campaigns = data?.campaigns || [];
  if (campaigns.length === 0) {
    return <p className="analyticsEmpty">No active campaigns were returned.</p>;
  }
  const columns = [
    { header: "Campaign", accessorKey: "campaign_name", cell: ({ row }) => <strong>{row.original.campaign_name}</strong> },
    { header: "Priority", accessorKey: "campaign_priority", cell: ({ row }) => <span className={`campaignPriority priority${row.original.campaign_priority}`}>P{row.original.campaign_priority}</span> },
    { header: "Customers", accessorKey: "customer_count", cell: ({ row }) => number.format(row.original.customer_count) },
    { id: "targets", header: "Targets", cell: ({ row }) => <button type="button" className="btn ghost" onClick={() => onSelect(row.original.campaign_name)}>View customers</button> },
  ];
  return <div className="dataTableWrap"><DataTable columns={columns} data={campaigns} /></div>;
}

function CampaignSegments({ data }) {
  if (!Array.isArray(data) || data.length === 0) {
    return <p className="analyticsEmpty">No campaign allocation data is available.</p>;
  }
  return (
    <div className="analyticsRows">
      {data.map((segment) => (
        <div className="analyticsCampaignSegment" key={segment.segment_label}>
          <div className="analyticsCampaignHeading">
            <strong>{segment.segment_label}</strong>
            <span>{number.format(segment.total_customers)} customers</span>
          </div>
          <div className="analyticsCampaignTags">
            {(segment.campaigns || []).map((campaign) => (
              <span key={`${campaign.campaign_name}-${campaign.reason_code}`}>
                {campaign.campaign_name} · {number.format(campaign.customer_count)}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CampaignCustomers({ data, navigate }) {
  const items = data?.items || [];
  if (items.length === 0) {
    return <p className="analyticsEmpty">No customers are available for this campaign.</p>;
  }
  return (
    <>
      <p className="analyticsMeta">
        {number.format(data.total)} targeted customers · ordered by churn probability
      </p>
      <div className="dataTableWrap campaignAudienceTableWrap">
        <DataTable
          columns={[
            { header: "Customer", accessorKey: "customer_unique_id", cell: ({ row }) => <button type="button" className="analyticsLinkButton" title={row.original.customer_unique_id} onClick={() => navigate(`/customers/${row.original.customer_unique_id}`)}>{row.original.customer_unique_id}</button> },
            { header: "Risk", accessorKey: "risk_tier" },
            { header: "Priority", accessorKey: "campaign_priority", cell: ({ row }) => `P${row.original.campaign_priority}` },
            { header: "Segment", accessorKey: "segment_label" },
            { header: "Value", accessorKey: "value_tier" },
            { header: "Churn score", accessorKey: "churn_probability", cell: ({ row }) => row.original.churn_probability == null ? "—" : `${(Number(row.original.churn_probability) * 100).toFixed(1)}%` },
            { header: "Reason", accessorKey: "reason_code" },
          ]}
          data={items}
        />
      </div>
      <p className="analyticsMeta">Showing page {data.page} of targeted customers.</p>
    </>
  );
}

export default function Campaigns() {
  const [selectedCampaign, setSelectedCampaign] = useState("");
  const [page, setPage] = useState(1);
  const audienceRef = useRef(null);
  const navigate = useNavigate();
  const loadCampaignCustomers = useCallback(
    () => analyticsService.campaignCustomers(selectedCampaign, { page, page_size: 25 }),
    [selectedCampaign, page],
  );

  useEffect(() => {
    if (selectedCampaign && typeof audienceRef.current?.scrollIntoView === "function") {
      audienceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedCampaign]);

  return (
    <Page>
      <div className="campaignsPage">
        <div className="header">
          <div>
            <p className="eyebrow">CUSTOMER ENGAGEMENT</p>
            <h1>Campaigns</h1>
            <p>Review active retention campaigns and explore the customers targeted by each.</p>
          </div>
        </div>

        <AnalyticsPanel
          title="Active campaign reach"
          sub="Campaign volume, total audience, and high-priority targets"
          load={analyticsService.activeCampaigns}
        >
          {(data) => (
            <>
              <div className="analyticsMetrics analyticsMetricsCompact">
                <div className="analyticsMetric"><span>Active campaigns</span><strong>{number.format(data.active_campaigns || 0)}</strong></div>
                <div className="analyticsMetric"><span>Customers targeted</span><strong>{number.format(data.customers_targeted || 0)}</strong></div>
                <div className="analyticsMetric"><span>High priority</span><strong>{number.format(data.high_priority_customers || 0)}</strong></div>
              </div>
              <ActiveCampaigns data={data} onSelect={(name) => { setSelectedCampaign(name); setPage(1); }} />
            </>
          )}
        </AnalyticsPanel>

        <div className="campaignsLower">
          <AnalyticsPanel
            title="Campaign allocation by segment"
            sub="Campaign mix and audience counts for each customer segment"
            load={analyticsService.campaignsBySegment}
          >
            {(data) => <CampaignSegments data={data} />}
          </AnalyticsPanel>
          {selectedCampaign ? (
            <div className="campaignAudience" ref={audienceRef}>
              <AnalyticsPanel
                title="Campaign audience"
                sub={selectedCampaign}
                load={loadCampaignCustomers}
                preserveDataOnRefresh
              >
                {(data) => (
                  <>
                    <CampaignCustomers data={data} navigate={navigate} />
                    <TablePagination
                      className="campaignAudiencePager"
                      page={page}
                      pageCount={Math.ceil(data.total / data.page_size)}
                      totalItems={data.total}
                      pageSize={data.page_size}
                      itemLabel="targeted customer"
                      onPageChange={setPage}
                    />
                  </>
                )}
              </AnalyticsPanel>
            </div>
          ) : (
            <Panel
              title="Campaign audience"
              sub="Select a campaign above to inspect its audience"
            >
              <p className="analyticsEmpty">Choose “View customers” for a campaign to load its audience.</p>
            </Panel>
          )}
        </div>
      </div>
    </Page>
  );
}
