import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, CheckSquare, Copy, Download, Filter, Plus, Search, Square, Trash2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { customerService } from "../services/api";
import { ErrorState, Header, LoadingState, Page } from "../components/States";
import CustomerModal from "../components/CustomerModal";
import FilterModal from "../components/FilterModal";
import ConfirmModal from "../components/ConfirmModal";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import DataTable from "../components/DataTable";
import TablePagination from "../components/TablePagination";
import { publishDashboardDataChanged } from "../services/dashboardDataEvents";

// Reference data for filters and sorts (All 27 Brazilian States & Federal District)
const states = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA",
  "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN",
  "RO", "RR", "RS", "SC", "SE", "SP", "TO"
];
const LEGACY_SEGMENT_RISK = {
  "High Risk": "high",
  "Medium Risk": "medium",
  "Low Risk": "low",
};
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

function getCustomerPage(cache, params) {
  const key = JSON.stringify(params);
  const cachedPage = cache.get(key);
  if (cachedPage) return cachedPage;

  const request = customerService.list(params)
    .then((result) => {
      if (cache.get(key) === request) {
        cache.set(key, Promise.resolve(result));
        while (cache.size > 3) {
          cache.delete(cache.keys().next().value);
        }
      }
      return result;
    })
    .catch((requestError) => {
      if (cache.get(key) === request) cache.delete(key);
      throw requestError;
    });
  cache.set(key, request);
  return request;
}

function buildCustomerSearchParams(filters) {
  const params = new URLSearchParams();
  const values = {
    q: filters.query,
    state: filters.state,
    activity: filters.activity,
    rating: filters.ratings?.join(","),
    churn_risk: filters.churnRisk?.join(","),
    max_recency: filters.maxRecency,
    min_spend: filters.minSpend,
    min_orders: filters.minOrders,
    sort: filters.sortBy && filters.sortDir ? `${filters.sortBy}-${filters.sortDir}` : "",
  };
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, value);
  });
  return params;
}

export default function Customers() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const toast = useToast();

  // Read URL query parameters if present (e.g. from Dashboard deep-links)
  const hasInitialSearchParams = Array.from(searchParams.keys()).length > 0;
  const legacySegmentRisk = LEGACY_SEGMENT_RISK[searchParams.get("segment") || ""];
  const paramChurnRisk = (searchParams.get("churn_risk") || legacySegmentRisk || "")
    .split(",")
    .filter(Boolean);
  const paramRating = (searchParams.get("rating") || "")
    .split(",")
    .filter(Boolean)
    .map((value) => parseInt(value, 10))
    .filter(Number.isFinite);
  const paramSort = searchParams.get("sort") || "";
  const [paramSortBy, paramSortDir] = paramSort ? paramSort.split("-") : ["", ""];

  const [query, setQuery] = useState(searchParams.get("q") || (hasInitialSearchParams ? "" : customersNavigationCache.query));
  const queryRef = useRef(query);
  queryRef.current = query;
  const [state, setState] = useState(searchParams.get("state") || (hasInitialSearchParams ? "" : customersNavigationCache.state));
  const [activity, setActivity] = useState(searchParams.get("activity") || (hasInitialSearchParams ? "" : customersNavigationCache.activity));
  const [ratings, setRatings] = useState(paramRating.length ? paramRating : (hasInitialSearchParams ? [] : customersNavigationCache.ratings));
  const [maxRecency, setMaxRecency] = useState(searchParams.get("max_recency") || (hasInitialSearchParams ? "" : customersNavigationCache.maxRecency));
  const [minSpend, setMinSpend] = useState(searchParams.get("min_spend") || (hasInitialSearchParams ? "" : customersNavigationCache.minSpend));
  const [minOrders, setMinOrders] = useState(searchParams.get("min_orders") || (hasInitialSearchParams ? "" : customersNavigationCache.minOrders));
  const [churnRisk, setChurnRisk] = useState(hasInitialSearchParams
    ? paramChurnRisk
    : customersNavigationCache.churnRisk || []);
  const [sortBy, setSortBy] = useState(paramSortBy || (hasInitialSearchParams ? "" : customersNavigationCache.sortBy));
  const [sortDir, setSortDir] = useState(paramSortDir || (hasInitialSearchParams ? "" : customersNavigationCache.sortDir));
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const sortMenuRef = useRef(null);
  const customerPageCacheRef = useRef(new Map());
  const latestLoadRef = useRef(0);

  // Sync state if URL search parameters change while staying on page, resetting other filters cleanly
  useEffect(() => {
    const hasParams = Array.from(searchParams.keys()).length > 0;
    if (hasParams) {
      setQuery(searchParams.get("q") || "");
      setState(searchParams.get("state") || "");
      setActivity(searchParams.get("activity") || "");
      setRatings((searchParams.get("rating") || "")
        .split(",")
        .filter(Boolean)
        .map((value) => parseInt(value, 10))
        .filter(Number.isFinite));
      const legacyRisk = LEGACY_SEGMENT_RISK[searchParams.get("segment") || ""];
      setChurnRisk((searchParams.get("churn_risk") || legacyRisk || "").split(",").filter(Boolean));
      const sort = searchParams.get("sort") || "";
      if (sort) {
        const [f, d] = sort.split("-");
        setSortBy(f || "");
        setSortDir(d || "desc");
      } else {
        setSortBy("");
        setSortDir("");
      }
      setMaxRecency(searchParams.get("max_recency") || "");
      setMinSpend(searchParams.get("min_spend") || "");
      setMinOrders(searchParams.get("min_orders") || "");
      setPage(1);
      if (legacyRisk) {
        const normalizedParams = new URLSearchParams(searchParams);
        normalizedParams.delete("segment");
        normalizedParams.set("churn_risk", legacyRisk);
        setSearchParams(normalizedParams, { replace: true });
      }
    }
  }, [searchParams, setSearchParams]);

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
      customerPageCacheRef.current.clear();
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
  }, [query, state, activity, ratings, churnRisk, maxRecency, minSpend, minOrders, sortBy, sortDir, page]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(event.target)) {
        setShowSortMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  const load = useCallback((requestedPage = page) => {
    const requestId = ++latestLoadRef.current;
    setError("");
    const params = {
      q: queryRef.current,
      state,
      activity,
      rating: ratings.length ? ratings.join(",") : undefined,
      churn_risk: churnRisk.length ? churnRisk.join(",") : undefined,
      max_recency: maxRecency || undefined,
      min_spend: minSpend || undefined,
      min_orders: minOrders || undefined,
      sort_by: sortBy || undefined,
      sort_dir: sortDir || undefined,
      include_churn: true,
      page: requestedPage,
      page_size: 12,
    };
    return getCustomerPage(customerPageCacheRef.current, params)
      .then((result) => {
        if (requestId === latestLoadRef.current) setData(result);
        if (requestedPage < result.pages) {
          getCustomerPage(customerPageCacheRef.current, { ...params, page: requestedPage + 1 }).catch((prefetchError) => {
            console.warn("Could not preload the next customer page.", prefetchError);
          });
        }
      })
      .catch((requestError) => {
        if (requestId === latestLoadRef.current) setError(requestError.message);
      });
  }, [page, state, activity, ratings, churnRisk, maxRecency, minSpend, minOrders, sortBy, sortDir]);
  useEffect(() => {
    load();
  }, [load]);
  const updateUrl = (overrides = {}) => {
    setSearchParams(buildCustomerSearchParams({
      query,
      state,
      activity,
      ratings,
      churnRisk,
      maxRecency,
      minSpend,
      minOrders,
      sortBy,
      sortDir,
      ...overrides,
    }), { replace: true });
  };
  const search = (event) => {
    event.preventDefault();
    setPage(1);
    updateUrl({ query: queryRef.current });
    load(1);
  };
  const clearFilters = () => {
    const hadAppliedSearch = searchParams.has("q");
    const hadOtherFilters = Boolean(
      state || activity || ratings.length || churnRisk.length || maxRecency || minSpend || minOrders
    );
    queryRef.current = "";
    setQuery("");
    setState("");
    setActivity("");
    setRatings([]);
    setChurnRisk([]);
    setMaxRecency("");
    setMinSpend("");
    setMinOrders("");
    setPage(1);
    updateUrl({
      state: "",
      query: "",
      activity: "",
      ratings: [],
      churnRisk: [],
      maxRecency: "",
      minSpend: "",
      minOrders: "",
    });
    if (hadAppliedSearch && !hadOtherFilters) load(1);
  };
  const copyCustomerId = async (event, customerId) => {
    event.stopPropagation();
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard access is unavailable in this browser.");
      }
      await navigator.clipboard.writeText(customerId);
      toast.success("Customer ID copied.");
    } catch (copyError) {
      toast.error(
        copyError instanceof Error
          ? `Could not copy customer ID: ${copyError.message}`
          : "Could not copy customer ID."
      );
    }
  };
  const applyFilters = (filters) => {
    const nextFilters = {
      state: filters.state,
      activity: filters.activity,
      ratings: filters.ratings || [],
      churnRisk: filters.churnRisk || [],
      maxRecency: filters.maxRecency,
      minSpend: filters.minSpend,
      minOrders: filters.minOrders,
    };
    setState(filters.state);
    setActivity(filters.activity);
    setRatings(filters.ratings || []);
    setChurnRisk(nextFilters.churnRisk);
    setMaxRecency(filters.maxRecency);
    setMinSpend(filters.minSpend);
    setMinOrders(filters.minOrders);
    setPage(1);
    updateUrl(nextFilters);
    setShowFilters(false);
  };
  const appliedSearchQuery = searchParams.get("q") || "";
  const activeFilterCount = [
    appliedSearchQuery,
    state,
    activity,
    ratings.length > 0,
    churnRisk.length > 0,
    maxRecency,
    minSpend,
    minOrders,
  ].filter(Boolean).length;
  const activeFilterChips = [
    ...(appliedSearchQuery ? [{
      label: `Search: ${appliedSearchQuery}`,
      remove: () => {
        queryRef.current = "";
        setQuery("");
        updateUrl({ query: "" });
        load(1);
      },
    }] : []),
    ...(state ? [{ label: `State: ${state}`, remove: () => {
      setState("");
      updateUrl({ state: "" });
    } }] : []),
    ...(activity ? [{
      label: activity === "active" ? "Has orders" : "No orders",
      remove: () => {
        setActivity("");
        updateUrl({ activity: "" });
      },
    }] : []),
    ...ratings.map((rating) => ({
      label: `Rating: ${rating} star${rating === 1 ? "" : "s"}`,
      remove: () => {
        const nextRatings = ratings.filter((value) => value !== rating);
        setRatings(nextRatings);
        updateUrl({ ratings: nextRatings });
      },
    })),
    ...churnRisk.map((risk) => ({
      label: `Model churn risk: ${risk}`,
      remove: () => {
        const nextChurnRisk = churnRisk.filter((value) => value !== risk);
        setChurnRisk(nextChurnRisk);
        updateUrl({ churnRisk: nextChurnRisk });
      },
    })),
    ...(maxRecency ? [{ label: `Max recency: ${maxRecency} days`, remove: () => {
      setMaxRecency("");
      updateUrl({ maxRecency: "" });
    } }] : []),
    ...(minSpend ? [{ label: `Min spend: R$ ${minSpend}`, remove: () => {
      setMinSpend("");
      updateUrl({ minSpend: "" });
    } }] : []),
    ...(minOrders ? [{ label: `Min orders: ${minOrders}`, remove: () => {
      setMinOrders("");
      updateUrl({ minOrders: "" });
    } }] : []),
  ];
  const toggleSort = (field) => {
    let nextSortBy = field;
    let nextSortDir = "desc";
    if (sortBy === field) {
      if (sortDir === "desc") {
        nextSortDir = "asc";
      } else {
        nextSortBy = "";
        nextSortDir = "";
      }
    }
    setSortBy(nextSortBy);
    setSortDir(nextSortDir);
    setPage(1);
    updateUrl({ sortBy: nextSortBy, sortDir: nextSortDir });
  };

  const renderSortIcon = (field) => {
    if (sortBy !== field) return <ArrowUpDown size={12} className="thSortIcon inactive" />;
    return sortDir === "asc" ? (
      <ArrowUp size={12} className="thSortIcon active" />
    ) : (
      <ArrowDown size={12} className="thSortIcon active" />
    );
  };

  const sortableHeader = (label, key, numeric = false) => (
    <button
      type="button"
      className={`tableSortButton${numeric ? " tableSortButton--numeric" : ""}`}
      onClick={() => toggleSort(key)}
    >
      {label} {renderSortIcon(key)}
    </button>
  );
  const columns = [
    ...(isSelectionMode ? [{
      id: "select",
      header: () => <input type="checkbox" checked={data.items.length > 0 && data.items.every((c) => selectedIds.includes(c.customer_unique_id))} onChange={toggleSelectAll} aria-label="Select all customers" />,
      cell: ({ row }) => <input type="checkbox" checked={selectedIds.includes(row.original.customer_unique_id)} onChange={(e) => toggleSelectOne(e, row.original.customer_unique_id)} aria-label={`Select ${row.original.customer_unique_id}`} />,
    }] : []),
    {
      header: "Customer",
      accessorKey: "customer_unique_id",
      cell: ({ row }) => {
        const customerId = row.original.customer_unique_id;
        return (
          <div className="customer customerDirectoryIdentity">
            <div className="avatar">{customerId?.[0]?.toUpperCase() || "C"}</div>
            <div className="customerIdWrap">
              <b className="customerId" title={customerId}>{customerId}</b>
            </div>
            <button
              type="button"
              className="copyCustomerId"
              aria-label={`Copy customer ID ${customerId}`}
              title="Copy customer ID"
              onClick={(event) => copyCustomerId(event, customerId)}
            >
              <Copy size={14} aria-hidden="true" />
            </button>
          </div>
        );
      },
    },
    { header: () => sortableHeader("Location", "city"), accessorKey: "customer_city", cell: ({ row }) => `${row.original.customer_city}, ${row.original.customer_state}` },
    {
      header: "Model churn risk",
      accessorKey: "segment",
      cell: ({ row }) => {
        const label = row.original.segment || "Unscored";
        const riskLevel = row.original.churn_risk_level || label.toLowerCase().split(" ")[0];
        const isUnscored = label === "Unscored";
        return (
          <div className="customerRiskCell">
            <span className={`churnRiskLabel${isUnscored ? " customerRiskUnscored" : ""}`}>
              {["high", "medium", "low"].includes(riskLevel) && (
                <span className={`churnDot ${riskLevel}`} aria-hidden="true" />
              )}
              {label}
            </span>
            {isUnscored && (
              isSelectionMode ? (
                <span className="customerUnscoredHint">No model prediction is available</span>
              ) : (
                <button
                  type="button"
                  className="customerUnscoredAction"
                  onClick={(event) => {
                    event.stopPropagation();
                    navigate(`/customers/${row.original.customer_unique_id}`);
                  }}
                >
                  Open profile for scoring options
                </button>
              )
            )}
          </div>
        );
      },
    },
    {
      header: () => sortableHeader("Orders", "orders"),
      accessorKey: "frequency",
      cell: ({ row }) => <span className="customerOrderCount">{row.original.frequency}</span>,
    },
    {
      header: () => sortableHeader("Spend", "spend", true),
      accessorKey: "monetary_total",
      cell: ({ row }) => (
        <span className="customerNumericValue">
          R$ {Number(row.original.monetary_total).toLocaleString("en-US")}
        </span>
      ),
    },
    {
      header: () => sortableHeader("Rating", "rating", true),
      accessorKey: "avg_review_score",
      cell: ({ row }) => (
        <span className="customerNumericValue">
          ★ {Number(row.original.avg_review_score).toFixed(1)}
        </span>
      ),
    },
    {
      header: () => sortableHeader("Recency", "recency", true),
      accessorKey: "recency_days",
      cell: ({ row }) => (
        <span className="customerNumericValue">{row.original.recency_days}d ago</span>
      ),
    },
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
                    updateUrl({ sortBy: "", sortDir: "" });
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
                      updateUrl({ sortBy: f, sortDir: d });
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
      {activeFilterChips.length > 0 && (
        <div className="activeFilterChips" aria-label="Active customer filters">
          <div className="activeFilterChipsHeading">
            <strong>Applied filters</strong>
            <span>{activeFilterCount}</span>
          </div>
          {activeFilterChips.map(({ label, remove }) => (
            <button
              type="button"
              className="activeFilterChip"
              key={label}
              onClick={() => {
                remove();
                setPage(1);
              }}
              aria-label={`Remove ${label} filter`}
            >
              {label}<span aria-hidden="true">×</span>
            </button>
          ))}
          <button type="button" className="clearActiveFilters" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      )}
      <div className="customerRiskLegend" role="note" aria-label="Model-predicted churn risk thresholds">
        <strong>Predicted churn risk</strong>
        <span><i className="churnDot low" aria-hidden="true" /> Low <b>&lt;30%</b></span>
        <span><i className="churnDot medium" aria-hidden="true" /> Medium <b>30–&lt;70%</b></span>
        <span><i className="churnDot high" aria-hidden="true" /> High <b>≥70%</b></span>
      </div>
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
        <ErrorState message={error} retry={() => load()} />
      ) : !data ? (
        <LoadingState text="Loading customers..." />
      ) : !data.items.length ? (
        <div className="customerEmptyState" role="status">
          <Search size={20} aria-hidden="true" />
          <strong>No customers found</strong>
          <span>
            {activeFilterCount
              ? "Try removing a filter or broadening your search."
              : "There are no customer records to display."}
          </span>
          {activeFilterCount > 0 && (
            <button type="button" className="btn secondary" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="table customerDirectoryTable">
          <DataTable
            columns={columns}
            data={data.items}
            ariaLabel="Customer directory"
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
            pageSize={data.page_size}
            itemLabel="unique customer"
            onPageChange={setPage}
          />
        </div>
      )}
      {showForm && (
        <CustomerModal
          close={() => setShowForm(false)}
          checkIdAvailable={customerService.isUniqueIdAvailable}
          save={async (payload) => {
            await customerService.create(payload);
            publishDashboardDataChanged();
           customerPageCacheRef.current.clear();
           setShowForm(false);
           toast.success("Customer created successfully.");
           setPage(1);
           await load(1);
          }}
        />
      )}
      {showFilters && (
        <FilterModal
          values={{
            state,
            activity,
            ratings,
            churnRisk,
            maxRecency,
            minSpend,
            minOrders,
          }}
          states={states}
          activityOptions={activityOptions}
          close={() => setShowFilters(false)}
          apply={applyFilters}
        />
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
