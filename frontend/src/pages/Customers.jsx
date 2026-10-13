import React, { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, CheckSquare, Download, Filter, Plus, Search, Square, Tag, Trash2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { customerService } from "../services/api";
import { ErrorState, Header, LoadingState, Page } from "../components/States";
import CustomerModal from "../components/CustomerModal";
import FilterModal from "../components/FilterModal";
import ConfirmModal from "../components/ConfirmModal";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { SEGMENT_COLORS } from "../components/dashboard/dashboardConstants";
import DataTable from "../components/DataTable";
import TablePagination from "../components/TablePagination";
import { publishDashboardDataChanged } from "../services/dashboardDataEvents";

// Reference data for filters and sorts (All 27 Brazilian States & Federal District)
const states = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA",
  "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN",
  "RO", "RR", "RS", "SC", "SE", "SP", "TO"
];
const segments = [
  "",
  "High Risk",
  "Medium Risk",
  "Low Risk",
];
const activityOptions = [
  ["", "All activity"],
  ["active", "Has orders"],
  ["inactive", "No orders"],
];

const sortOptions = [
  { key: "spend-desc", label: "Highest spend", icon: "💰" },
  { key: "spend-asc", label: "Lowest spend", icon: "💰" },
  { key: "rating-desc", label: "Highest rating", icon: "⭐" },
  { key: "rating-asc", label: "Lowest rating", icon: "⭐" },
  { key: "recency-asc", label: "Most recent purchase", icon: "🕒" },
  { key: "recency-desc", label: "Oldest purchase (recency)", icon: "🕒" },
  { key: "orders-desc", label: "Most orders", icon: "📦" },
  { key: "orders-asc", label: "Fewest orders", icon: "📦" },
  { key: "city-asc", label: "Location (A to Z)", icon: "📍" },
  { key: "city-desc", label: "Location (Z to A)", icon: "📍" },
];

const initialFilterState = {
  query: "",
  state: "",
  segment: "",
  activity: "",
  ratings: [],
  churnRisk: [],
  maxRecency: "",
  minSpend: "",
  minOrders: "",
  sortBy: "",
  sortDir: "",
  page: 1,
};

// In-memory cache preserved during client-side route navigation, cleared on browser page refresh
let customersNavigationCache = { ...initialFilterState };

export default function Customers() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const toast = useToast();

  // Read URL query parameters if present (e.g. from Dashboard deep-links)
  const paramState = searchParams.get("state") || "";
  const paramSegment = searchParams.get("segment") || "";
  const paramActivity = searchParams.get("activity") || "";
  const paramRating = searchParams.get("rating") ? [parseInt(searchParams.get("rating"), 10)] : [];
  const paramSort = searchParams.get("sort") || "";
  const [paramSortBy, paramSortDir] = paramSort ? paramSort.split("-") : ["", ""];

  const [query, setQuery] = useState(paramState || paramSegment || paramActivity || paramRating.length || paramSort ? "" : customersNavigationCache.query);
  const [state, setState] = useState(paramState || (paramSegment || paramActivity || paramRating.length || paramSort ? "" : customersNavigationCache.state));
  const [segment, setSegment] = useState(paramSegment || (paramState || paramActivity || paramRating.length || paramSort ? "" : customersNavigationCache.segment));
  const [activity, setActivity] = useState(paramActivity || (paramState || paramSegment || paramRating.length || paramSort ? "" : customersNavigationCache.activity));
  const [ratings, setRatings] = useState(paramRating.length ? paramRating : (paramState || paramSegment || paramActivity || paramSort ? [] : customersNavigationCache.ratings));
  const [maxRecency, setMaxRecency] = useState(paramState || paramSegment || paramActivity || paramRating.length || paramSort ? "" : customersNavigationCache.maxRecency);
  const [minSpend, setMinSpend] = useState(paramState || paramSegment || paramActivity || paramRating.length || paramSort ? "" : customersNavigationCache.minSpend);
  const [minOrders, setMinOrders] = useState(paramState || paramSegment || paramActivity || paramRating.length || paramSort ? "" : customersNavigationCache.minOrders);
  const [churnRisk, setChurnRisk] = useState(paramState || paramSegment || paramActivity || paramRating.length || paramSort ? [] : (customersNavigationCache.churnRisk || []));
  const [sortBy, setSortBy] = useState(paramSortBy || (paramState || paramSegment || paramActivity || paramRating.length ? "" : customersNavigationCache.sortBy));
  const [sortDir, setSortDir] = useState(paramSortDir || (paramState || paramSegment || paramActivity || paramRating.length ? "" : customersNavigationCache.sortDir));
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkSegment, setBulkSegment] = useState("Low Risk");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const sortMenuRef = useRef(null);

  // Sync state if URL search parameters change while staying on page, resetting other filters cleanly
  useEffect(() => {
    const hasParams = Array.from(searchParams.keys()).length > 0;
    if (hasParams) {
      setState(searchParams.get("state") || "");
      setSegment(searchParams.get("segment") || "");
      setActivity(searchParams.get("activity") || "");
      setRatings(searchParams.get("rating") ? [parseInt(searchParams.get("rating"), 10)] : []);
      const sort = searchParams.get("sort") || "";
      if (sort) {
        const [f, d] = sort.split("-");
        setSortBy(f || "");
        setSortDir(d || "desc");
      } else {
        setSortBy("");
        setSortDir("");
      }
      setQuery("");
      setMaxRecency("");
      setMinSpend("");
      setMinOrders("");
      setPage(1);
    }
  }, [searchParams]);

  // Toggle selection mode on/off
  const toggleSelectionMode = () => {
    if (isSelectionMode) {
      setSelectedIds([]);
      setIsSelectionMode(false);
    } else {
      setIsSelectionMode(true);
    }
  };

  const [isExporting, setIsExporting] = useState(false);

  // Export all filtered customers matching current search criteria to CSV file
  const exportToCSV = async () => {
    setIsExporting(true);
    try {
      const response = await customerService.exportCsv({
        q: query,
        state,
        segment,
        activity,
        rating: ratings.length ? ratings.join(",") : undefined,
        churn_risk: churnRisk.length ? churnRisk.join(",") : undefined,
        max_recency: maxRecency || undefined,
        min_spend: minSpend || undefined,
        min_orders: minOrders || undefined,
        sort_by: sortBy || undefined,
        sort_dir: sortDir || undefined,
      });

      const blob = new Blob([response.data], { type: "text/csv;charset=utf-8;" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const countLabel = data?.total ? `${data.total}_records_` : "";
      link.setAttribute(
        "download",
        `customers_export_${countLabel}${new Date().toISOString().split("T")[0]}.csv`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast.success("Customer data exported to CSV.");
    } catch (err) {
      toast.error(`Export failed: ${err.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  // Toggle selection for all customers on current page
  const toggleSelectAll = () => {
    if (!data?.items) return;
    const pageIds = data.items.map((c) => c.customer_unique_id);
    const allSelected = pageIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((curr) => curr.filter((id) => !pageIds.includes(id)));
    } else {
      setSelectedIds((curr) => Array.from(new Set([...curr, ...pageIds])));
    }
  };

  // Toggle single customer row selection
  const toggleSelectOne = (e, uid) => {
    e.stopPropagation();
    setSelectedIds((curr) =>
      curr.includes(uid) ? curr.filter((id) => id !== uid) : [...curr, uid]
    );
  };

  // Execute Bulk Segment Update
  const executeBulkSegment = async () => {
    if (selectedIds.length === 0) return;
    setBulkBusy(true);
    try {
      await customerService.bulkSegmentUpdate({
        customer_unique_ids: selectedIds,
        segment: bulkSegment,
      });
      publishDashboardDataChanged();
      setShowBulkModal(false);
      setSelectedIds([]);
      toast.success(`Segment updated for ${selectedIds.length} customer(s).`);
      await load();
    } catch (err) {
      toast.error(`Bulk update failed: ${err.message}`);
    } finally {
      setBulkBusy(false);
    }
  };

  // Execute Bulk Customer Delete
  const handleConfirmBulkDelete = async () => {
    setShowBulkDeleteConfirm(false);
    if (selectedIds.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await customerService.bulkDelete({
        customer_unique_ids: selectedIds,
      });
      if (res.deleted_count > 0) publishDashboardDataChanged();
      toast.success(`Bulk delete complete. Deleted: ${res.deleted_count}, Skipped: ${res.skipped_count}`);
      if (res.skipped_count > 0) {
        toast.warning(`${res.skipped_count} customer(s) skipped — they have order history.`);
      }
      setSelectedIds([]);
      await load();
    } catch (err) {
      toast.error(`Bulk delete failed: ${err.message}`);
    } finally {
      setBulkBusy(false);
    }
  };

  // Keep navigation cache in sync with state
  useEffect(() => {
    customersNavigationCache = {
      query,
      state,
      segment,
      activity,
      ratings,
      churnRisk,
      maxRecency,
      minSpend,
      minOrders,
      sortBy,
      sortDir,
      page,
    };
  }, [query, state, segment, activity, ratings, churnRisk, maxRecency, minSpend, minOrders, sortBy, sortDir, page]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(event.target)) {
        setShowSortMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  const load = () => {
    setError("");
    return customerService
      .list({
        q: query,
        state,
        segment,
        activity,
        rating: ratings.length ? ratings.join(",") : undefined,
        churn_risk: churnRisk.length ? churnRisk.join(",") : undefined,
        max_recency: maxRecency || undefined,
        min_spend: minSpend || undefined,
        min_orders: minOrders || undefined,
        sort_by: sortBy || undefined,
        sort_dir: sortDir || undefined,
        include_churn: false,
        page,
        page_size: 12,
      })
      .then(setData)
      .catch((requestError) => setError(requestError.message));
  };
  useEffect(() => {
    load();
  }, [page, state, segment, activity, ratings, churnRisk, maxRecency, minSpend, minOrders, sortBy, sortDir]);
  const search = (event) => {
    event.preventDefault();
    setPage(1);
    load();
  };
  const clearFilters = () => {
    setState("");
    setSegment("");
    setActivity("");
    setRatings([]);
    setChurnRisk([]);
    setMaxRecency("");
    setMinSpend("");
    setMinOrders("");
    setPage(1);
  };
  const applyFilters = (filters) => {
    setState(filters.state);
    setSegment(filters.segment);
    setActivity(filters.activity);
    setRatings(filters.ratings || []);
    setChurnRisk(filters.churnRisk || []);
    setMaxRecency(filters.maxRecency);
    setMinSpend(filters.minSpend);
    setMinOrders(filters.minOrders);
    setPage(1);
    setShowFilters(false);
  };
  const activeFilterCount = [
    state,
    segment,
    activity,
    ratings.length > 0,
    churnRisk.length > 0,
    maxRecency,
    minSpend,
    minOrders,
  ].filter(Boolean).length;
  const toggleSort = (field) => {
    if (sortBy === field) {
      if (sortDir === "desc") {
        setSortDir("asc");
      } else {
        setSortBy("");
        setSortDir("");
      }
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
    setPage(1);
  };

  const renderSortIcon = (field) => {
    if (sortBy !== field) return <ArrowUpDown size={12} className="thSortIcon inactive" />;
    return sortDir === "asc" ? (
      <ArrowUp size={12} className="thSortIcon active" />
    ) : (
      <ArrowDown size={12} className="thSortIcon active" />
    );
  };

  const sortableHeader = (label, key) => (
    <button type="button" className="tableSortButton" onClick={() => toggleSort(key)}>
      {label} {renderSortIcon(key)}
    </button>
  );
  const columns = [
    ...(isSelectionMode ? [{
      id: "select",
      header: () => <input type="checkbox" checked={data.items.length > 0 && data.items.every((c) => selectedIds.includes(c.customer_unique_id))} onChange={toggleSelectAll} aria-label="Select all customers" />,
      cell: ({ row }) => <input type="checkbox" checked={selectedIds.includes(row.original.customer_unique_id)} onChange={(e) => toggleSelectOne(e, row.original.customer_unique_id)} aria-label={`Select ${row.original.customer_unique_id}`} />,
    }] : []),
    { header: "Customer", accessorKey: "customer_unique_id", cell: ({ row }) => <div className="customer"><div className="avatar">{row.original.customer_city?.[0]}</div><div><b title={row.original.customer_unique_id}>{row.original.customer_unique_id}</b></div></div> },
    { header: () => sortableHeader("Location", "city"), accessorKey: "customer_city", cell: ({ row }) => `${row.original.customer_city}, ${row.original.customer_state}` },
    { header: "Segment", accessorKey: "segment", cell: ({ row }) => <em>{row.original.segment && <span className="churnDot" style={{ background: SEGMENT_COLORS[row.original.segment] || "#94a3b8", boxShadow: `0 0 6px ${(SEGMENT_COLORS[row.original.segment] || "#94a3b8")}66` }} title={`Segment: ${row.original.segment}`} />}{row.original.segment}</em> },
    { header: () => sortableHeader("Orders", "orders"), accessorKey: "frequency" },
    { header: () => sortableHeader("Spend", "spend"), accessorKey: "monetary_total", cell: ({ row }) => `R$ ${Number(row.original.monetary_total).toLocaleString("en-US")}` },
    { header: () => sortableHeader("Rating", "rating"), accessorKey: "avg_review_score", cell: ({ row }) => `★ ${Number(row.original.avg_review_score).toFixed(1)}` },
    { header: () => sortableHeader("Recency", "recency"), accessorKey: "recency_days", cell: ({ row }) => `${row.original.recency_days}d ago` },
  ];

  return (
    <Page>
      <div className="header">
        <div>
          <p className="eyebrow">CUSTOMER DIRECTORY</p>
          <h1>Customers</h1>
          <p>Search and explore customer value across your Olist dataset.</p>
        </div>
        <div className="customerHeaderActions" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {isAdmin && (
            <button
              type="button"
              className={`btn ${isSelectionMode ? "primary" : "secondary"}`}
              onClick={toggleSelectionMode}
              title={isSelectionMode ? "Exit Bulk Selection Mode" : "Enter Bulk Selection Mode"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: isSelectionMode ? "#2563eb" : undefined,
                color: isSelectionMode ? "#fff" : undefined,
                borderColor: isSelectionMode ? "#1d4ed8" : undefined,
              }}
            >
              <CheckSquare size={15} /> {isSelectionMode ? "Done Selecting" : "Select Customers"}
            </button>
          )}
          <button
            type="button"
            className="btn secondary"
            onClick={exportToCSV}
            disabled={isExporting}
            title="Download all matching filtered customers as CSV"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Download size={15} className={isExporting ? "spin" : ""} />
            {isExporting ? "Exporting all..." : `Export CSV (${data?.total ? Number(data.total).toLocaleString("en-US") : ""})`}
          </button>
          {isAdmin && (
            <button className="btn primary" onClick={() => setShowForm(true)}>
              <Plus size={16} />
              Add customer
            </button>
          )}
        </div>
      </div>
      <form className="filters" onSubmit={search}>
        <div className="customerSearchGroup">
          <div className="search customerSearch">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search unique customer ID or city..."
            />
          </div>
          <button type="submit" className="btn secondary customerSearchButton">
            <Search size={16} />
            Search
          </button>
        </div>
        <div className="sortSelectorWrapper" ref={sortMenuRef}>
          <button
            type="button"
            className={`btn secondary sortButton ${showSortMenu || sortBy ? "active" : ""}`}
            onClick={() => setShowSortMenu(!showSortMenu)}
          >
            <ArrowUpDown size={16} />
            <span>
              {sortBy ? (
                <>Sort: <strong>{sortOptions.find(o => o.key === `${sortBy}-${sortDir}`)?.label || `${sortBy} (${sortDir})`}</strong></>
              ) : (
                "Sort"
              )}
            </span>
          </button>
          {showSortMenu && (
            <div className="sortDropdownMenu">
              <div className="sortDropdownHeader">Sort Customers By</div>
              {sortBy && (
                <button
                  type="button"
                  className="sortMenuItem"
                  style={{ color: "#ef4444", borderBottom: "1px solid #edf0f4", marginBottom: 4 }}
                  onClick={() => {
                    setSortBy("");
                    setSortDir("");
                    setPage(1);
                    setShowSortMenu(false);
                  }}
                >
                  <span className="sortMenuIcon">🔄</span>
                  <span className="sortMenuLabel">Clear sorting (Default)</span>
                </button>
              )}
              {sortOptions.map((opt) => {
                const isSelected = `${sortBy}-${sortDir}` === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    className={`sortMenuItem ${isSelected ? "selected" : ""}`}
                    onClick={() => {
                      const [f, d] = opt.key.split("-");
                      setSortBy(f);
                      setSortDir(d);
                      setPage(1);
                      setShowSortMenu(false);
                    }}
                  >
                    <span className="sortMenuIcon">{opt.icon}</span>
                    <span className="sortMenuLabel">{opt.label}</span>
                    {isSelected && <Check size={14} className="sortMenuCheck" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn secondary filterToggle"
          onClick={() => setShowFilters(true)}
        >
          <Filter size={16} />
          Filters{activeFilterCount > 0 && <b>{activeFilterCount}</b>}
        </button>
      </form>
      {/* Bulk Operations Toolbar */}
      {selectedIds.length > 0 && (
        <div
          style={{
            background: "#1e293b",
            color: "#fff",
            padding: "10px 16px",
            borderRadius: 10,
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            animation: "filterReveal 0.2s ease-out",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {selectedIds.length} customer{selectedIds.length > 1 ? "s" : ""} selected
            </span>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setSelectedIds([])}
              style={{ fontSize: 11, padding: "4px 8px", background: "#334155", color: "#cbd5e1" }}
            >
              Clear selection
            </button>
          </div>
          {isAdmin && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                className="btn secondary"
                onClick={() => setShowBulkModal(true)}
                style={{ fontSize: 12, padding: "6px 12px", background: "#0f172a", color: "#38bdf8", borderColor: "#334155" }}
              >
                <Tag size={14} /> Change Segment
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() => setShowBulkDeleteConfirm(true)}
                disabled={bulkBusy}
                style={{ fontSize: 12, padding: "6px 12px", background: "#450a0a", color: "#f87171", borderColor: "#7f1d1d" }}
              >
                <Trash2 size={14} /> Bulk Delete
              </button>
            </div>
          )}
        </div>
      )}

      {error ? (
        <ErrorState message={error} retry={load} />
      ) : !data ? (
        <LoadingState />
      ) : !data.items.length ? (
        <div className="state">No customers match these filters.</div>
      ) : (
        <div className="table">
          <DataTable
            columns={columns}
            data={data.items}
            getRowProps={(customer) => ({
              onClick: () => {
                if (isSelectionMode) {
                  toggleSelectOne({ stopPropagation: () => {} }, customer.customer_unique_id);
                } else {
                  navigate(`/customers/${customer.customer_unique_id}`);
                }
              },
              style: { background: selectedIds.includes(customer.customer_unique_id) ? "rgba(37, 99, 235, 0.08)" : undefined },
            })}
          />
          <TablePagination
            page={page}
            pageCount={data.pages}
            totalItems={data.total}
            itemLabel="unique customer"
            onPageChange={setPage}
          />
        </div>
      )}
      {showForm && (
        <CustomerModal
          close={() => setShowForm(false)}
          save={async (payload) => {
            await customerService.create(payload);
            publishDashboardDataChanged();
            setShowForm(false);
            toast.success("Customer created successfully.");
            setPage(1);
            await load();
          }}
        />
      )}
      {showFilters && (
        <FilterModal
          values={{
            state,
            segment,
            activity,
            ratings,
            churnRisk,
            maxRecency,
            minSpend,
            minOrders,
          }}
          states={states}
          segments={segments}
          activityOptions={activityOptions}
          close={() => setShowFilters(false)}
          apply={applyFilters}
        />
      )}
      {showBulkModal && (
        <div className="modalBg">
          <form className="modal" style={{ maxWidth: 400 }} onSubmit={(e) => { e.preventDefault(); executeBulkSegment(); }}>
            <button type="button" className="close" onClick={() => setShowBulkModal(false)}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>×</span>
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: "#e0f2fe",
                  color: "#0369a1",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Tag size={18} />
              </div>
              <div>
                <p className="eyebrow" style={{ margin: 0 }}>BULK OPERATIONS</p>
                <h2 style={{ margin: 0, fontSize: 18 }}>Update Segment</h2>
              </div>
            </div>
            <p className="filterHint" style={{ marginBottom: 16 }}>
              Change the RFM segment category for <b>{selectedIds.length}</b> selected customer{selectedIds.length > 1 ? "s" : ""}.
            </p>
            <label>
              Target Segment
              <select
                value={bulkSegment}
                onChange={(e) => setBulkSegment(e.target.value)}
                style={{ width: "100%", marginTop: 4 }}
              >
                <option value="High Risk">High Risk</option>
                <option value="Medium Risk">Medium Risk</option>
                <option value="Low Risk">Low Risk</option>
              </select>
            </label>
            <div className="actions" style={{ marginTop: 18 }}>
              <button type="button" className="btn secondary" onClick={() => setShowBulkModal(false)} disabled={bulkBusy}>
                Cancel
              </button>
              <button className="btn primary" disabled={bulkBusy}>
                {bulkBusy ? "Updating..." : "Apply to Selected"}
              </button>
            </div>
          </form>
        </div>
      )}

      {showBulkDeleteConfirm && (
        <ConfirmModal
          title="Delete Selected Customers?"
          message={`Are you sure you want to delete ${selectedIds.length} selected customer${selectedIds.length > 1 ? "s" : ""}? Only customers without order history will be deleted. This cannot be undone.`}
          confirmLabel="Bulk Delete"
          isDanger={true}
          loading={bulkBusy}
          onConfirm={handleConfirmBulkDelete}
          onCancel={() => setShowBulkDeleteConfirm(false)}
        />
      )}
    </Page>
  );
}
