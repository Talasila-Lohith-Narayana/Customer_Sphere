import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowDownUp,
  Boxes,
  DollarSign,
  Download,
  Package,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Star,
  Tag,
  Weight,
  X,
} from "lucide-react";
import { productsService } from "../services/api";
import { ErrorState, Header, LoadingState, Page } from "../components/States";
import ProductFilterModal from "../components/ProductFilterModal";
import { useToast } from "../context/ToastContext";
import DataTable from "../components/DataTable";
import TablePagination from "../components/TablePagination";

const sortOptions = [
  { key: "items_desc", label: "Most units sold", icon: "📦" },
  { key: "items_asc", label: "Fewest units sold", icon: "📦" },
  { key: "revenue_desc", label: "Highest revenue", icon: "💰" },
  { key: "revenue_asc", label: "Lowest revenue", icon: "💰" },
  { key: "price_desc", label: "Highest average price", icon: "🏷️" },
  { key: "price_asc", label: "Lowest average price", icon: "🏷️" },
  { key: "rating_desc", label: "Highest star rating", icon: "⭐" },
  { key: "rating_asc", label: "Lowest star rating", icon: "⭐" },
  { key: "category_asc", label: "Category (A to Z)", icon: "🔤" },
];

export default function Products() {
  const [searchParams] = useSearchParams();
  const paramCategory = searchParams.get("category") || "";
  const toast = useToast();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState({
    category: paramCategory || "",
    minPrice: "",
    maxPrice: "",
    minUnits: "",
    minRating: "",
  });
  const [showFilterModal, setShowFilterModal] = useState(false);

  // Sync category state if URL parameter changes (e.g. from Dashboard deep-links)
  useEffect(() => {
    const cat = searchParams.get("category");
    if (cat !== null) {
      setFilters((prev) => ({
        ...prev,
        category: cat || "",
      }));
      setPage(1);
    }
  }, [searchParams]);

  const [sortKey, setSortKey] = useState("items_desc");
  const [page, setPage] = useState(1);
  const limit = 15;

  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef(null);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Close sort menu on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (sortRef.current && !sortRef.current.contains(event.target)) {
        setSortOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const loadProducts = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await productsService.catalog({
        q: debouncedSearch || undefined,
        category: filters.category || undefined,
        min_price: filters.minPrice ? parseFloat(filters.minPrice) : undefined,
        max_price: filters.maxPrice ? parseFloat(filters.maxPrice) : undefined,
        min_units: filters.minUnits ? parseInt(filters.minUnits, 10) : undefined,
        min_rating: filters.minRating ? parseFloat(filters.minRating) : undefined,
        sort: sortKey,
        page,
        limit,
      });
      setData(res);
    } catch (err) {
      setError(err.message || "Failed to load products catalog.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, [debouncedSearch, filters, sortKey, page]);

const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await productsService.exportCsv({
        q: debouncedSearch || undefined,
        category: filters.category || undefined,
        min_price: filters.minPrice ? parseFloat(filters.minPrice) : undefined,
        max_price: filters.maxPrice ? parseFloat(filters.maxPrice) : undefined,
        min_units: filters.minUnits ? parseInt(filters.minUnits, 10) : undefined,
        min_rating: filters.minRating ? parseFloat(filters.minRating) : undefined,
        sort: sortKey,
      });
      const blob = new Blob([response.data], { type: "text/csv;charset=utf-8;" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `products_catalog_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast.success("Products catalog exported to CSV.");
    } catch (err) {
      toast.error("Failed to export products: " + err.message);
    } finally {
      setIsExporting(false);
    }
  };

        const toggleSort = (field) => {
    const [currField, currDir] = sortKey ? sortKey.split("_") : ["items", "desc"];
    if (currField === field) {
      if (currDir === "desc") {
        setSortKey(field + "_asc");
      } else {
        setSortKey("items_desc");
      }
    } else {
      setSortKey(field + "_desc");
    }
    setPage(1);
  };

  const renderSortIcon = (field) => {
    const [currField, currDir] = sortKey ? sortKey.split("_") : ["items", "desc"];
    if (currField !== field) return <ArrowUpDown size={12} className="thSortIcon inactive" />;
    return currDir === "asc" ? (
      <ArrowUp size={12} className="thSortIcon active" />
    ) : (
      <ArrowDown size={12} className="thSortIcon active" />
    );
  };

  const activeSort = sortOptions.find((s) => s.key === sortKey) || sortOptions[0];
  const activeFiltersCount = Object.values(filters).filter(Boolean).length;
  const activeFilterChips = [
    ...(debouncedSearch ? [{
      label: `Search: ${debouncedSearch}`,
      remove: () => {
        setSearch("");
        setDebouncedSearch("");
      },
    }] : []),
    ...(filters.category ? [{
      label: `Category: ${filters.category.replace(/_/g, " ")}`,
      remove: () => setFilters((current) => ({ ...current, category: "" })),
    }] : []),
    ...(filters.minPrice ? [{
      label: `Min price: R$ ${filters.minPrice}`,
      remove: () => setFilters((current) => ({ ...current, minPrice: "" })),
    }] : []),
    ...(filters.maxPrice ? [{
      label: `Max price: R$ ${filters.maxPrice}`,
      remove: () => setFilters((current) => ({ ...current, maxPrice: "" })),
    }] : []),
    ...(filters.minUnits ? [{
      label: `Min units: ${filters.minUnits}`,
      remove: () => setFilters((current) => ({ ...current, minUnits: "" })),
    }] : []),
    ...(filters.minRating ? [{
      label: `Min rating: ${filters.minRating} stars`,
      remove: () => setFilters((current) => ({ ...current, minRating: "" })),
    }] : []),
  ];

  const sortableHeader = (label, key) => <button type="button" className="tableSortButton" onClick={() => toggleSort(key)}>{label} {renderSortIcon(key)}</button>;
  const columns = [
    { header: "Product ID", accessorKey: "product_id", cell: ({ row }) => <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(37, 99, 235, 0.1)", color: "#2563eb", display: "grid", placeItems: "center" }}><Package size={16} /></div><div><code title={row.original.product_id} className="truncated-id" style={{ fontSize: 12, fontWeight: 600, maxWidth: 130 }}>{row.original.product_id}</code><div style={{ fontSize: 11, color: "#64748b" }}>{row.original.photos_qty} {row.original.photos_qty === 1 ? "photo" : "photos"}</div></div></div> },
    { header: () => sortableHeader("Category", "category"), accessorKey: "category_name", cell: ({ row }) => <span style={{ display: "inline-block", padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: "rgba(16, 185, 129, 0.1)", color: "#059669", textTransform: "capitalize" }}>{row.original.category_name.replace(/_/g, " ")}</span> },
    { header: () => sortableHeader("Units Sold", "items"), accessorKey: "total_units_sold", cell: ({ row }) => <b style={{ fontFamily: "Space Grotesk" }}>{row.original.total_units_sold.toLocaleString("en-US")}</b> },
    { header: () => sortableHeader("Total Revenue", "revenue"), accessorKey: "total_revenue", cell: ({ row }) => <span style={{ fontWeight: 600, color: "#059669" }}>R$ {row.original.total_revenue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> },
    { header: () => sortableHeader("Avg Price", "price"), accessorKey: "avg_price", cell: ({ row }) => `R$ ${row.original.avg_price.toFixed(2)}` },
    { header: "Avg Freight", accessorKey: "avg_freight", cell: ({ row }) => `R$ ${row.original.avg_freight.toFixed(2)}` },
    { header: () => sortableHeader("Rating", "rating"), accessorKey: "avg_rating", cell: ({ row }) => <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ color: "#f59e0b" }}>★</span><b>{row.original.avg_rating > 0 ? row.original.avg_rating.toFixed(1) : "—"}</b><small style={{ color: "#64748b", fontSize: 11 }}>({row.original.total_reviews})</small></span> },
    { header: "Weight", accessorKey: "weight_g", cell: ({ row }) => <span style={{ fontSize: 12, color: "#64748b" }}>{row.original.weight_g > 0 ? `${(row.original.weight_g / 1000).toFixed(2)} kg` : "—"}</span> },
  ];

  return (
    <Page>
      {/* Top Header Banner with Export CSV */}
      <div className="header">
        <div>
          <p className="eyebrow">WORKSPACE CATALOG</p>
          <h1>Products & Inventory</h1>
          <p>Browse, filter, and analyze all available marketplace products, sales volume, and customer feedback.</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            type="button"
            className="btn secondary"
            onClick={handleExport}
            disabled={isExporting || !data || data.total === 0}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, padding: "8px 14px" }}
            title="Download all matching filtered products as CSV"
          >
            <Download size={15} className={isExporting ? "spin" : ""} />
            <span>
              {isExporting
                ? "Exporting all..."
                : `Export CSV (${data?.total ? Number(data.total).toLocaleString("en-US") : ""})`}
            </span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar in single unified row */}
      <div className="filters" style={{ display: "flex", gap: 10, alignItems: "center", position: "relative", zIndex: 30 }}>
        {/* Full-text Search */}
        <div className="search" style={{ flex: 1, minWidth: 180 }}>
          <Search size={16} />
          <input
            type="search"
            placeholder="Search product ID or category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Compact Category Dropdown Filter */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
          <Tag size={15} style={{ color: "#64748b" }} />
          <select
            value={filters.category}
            onChange={(e) => {
              setFilters((prev) => ({ ...prev, category: e.target.value }));
              setPage(1);
            }}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--card-bg)",
              color: "var(--text-main)",
              fontSize: 12,
              maxWidth: 150,
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            <option value="">All Categories ({data?.categories?.length || 0})</option>
            {(data?.categories || []).map((cat) => (
              <option key={cat} value={cat}>
                {cat.replace(/_/g, " ").toUpperCase()}
              </option>
            ))}
          </select>
        </div>

        {/* Filter Modal Trigger Button */}
        <button
          type="button"
          className={`btn secondary ${activeFiltersCount > 0 ? "active" : ""}`}
          onClick={() => setShowFilterModal(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            padding: "8px 12px",
            flexShrink: 0,
            
          }}
        >
          <SlidersHorizontal size={14} />
          <span>Filters {activeFiltersCount > 0 ? `(${activeFiltersCount})` : ""}</span>
        </button>

        {/* Clear All Filters Button if active */}
        {activeFiltersCount > 0 && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setFilters({
                category: "",
                minPrice: "",
                maxPrice: "",
                minUnits: "",
                minRating: "",
              });
              setPage(1);
            }}
            style={{ fontSize: 12, padding: "4px 8px", color: "#ef4444", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}
          >
            <X size={13} /> Reset
          </button>
        )}

        {/* Sort Selector Dropdown */}
        <div className="sortSelectorWrapper" ref={sortRef} style={{ flexShrink: 0, position: "relative" }}>
          <button
            type="button"
            className={`btn secondary sortButton ${sortOpen || sortKey !== "items_desc" ? "active" : ""}`}
            onClick={() => setSortOpen(!sortOpen)}
            style={{ fontSize: 12, padding: "8px 12px" }}
          >
            <ArrowDownUp size={14} />
            <span>Sort: <strong>{activeSort.label}</strong></span>
          </button>
          {sortOpen && (
            <div className="sortDropdownMenu" style={{ right: 0, left: "auto", minWidth: 220, zIndex: 100 }}>
              <div className="sortDropdownHeader">Sort Products By</div>
              {sortOptions.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`sortMenuItem ${sortKey === opt.key ? "selected" : ""}`}
                  onClick={() => {
                    setSortKey(opt.key);
                    setSortOpen(false);
                    setPage(1);
                  }}
                >
                  <span className="sortMenuIcon">{opt.icon}</span>
                  <span className="sortMenuLabel">{opt.label}</span>
                  {sortKey === opt.key && <span className="sortMenuCheck">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {activeFilterChips.length > 0 && (
        <div className="activeFilterChips" aria-label="Active product filters">
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
          <button
            type="button"
            className="clearActiveFilters"
            onClick={() => {
              setSearch("");
              setDebouncedSearch("");
              setFilters({ category: "", minPrice: "", maxPrice: "", minUnits: "", minRating: "" });
              setPage(1);
            }}
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Filter Modal Dialog */}
      {showFilterModal && (
        <ProductFilterModal
          values={filters}
          categories={data?.categories || []}
          close={() => setShowFilterModal(false)}
          apply={(newFilters) => {
            setFilters(newFilters);
            setPage(1);
            setShowFilterModal(false);
          }}
        />
      )}

      {/* Error state */}
      {error && <ErrorState message={error} retry={loadProducts} />}

      {/* Loading State */}
      {loading && !data && <LoadingState text="Loading marketplace products catalog..." />}

      {/* Products Table */}
      {data && (
        <div className="table" style={{ marginTop: 12 }}>
          <DataTable columns={columns} data={data.items} emptyMessage="No matching products found in catalog. Try clearing or relaxing search filters." />
          <TablePagination
            page={page}
            pageCount={data.total_pages}
            totalItems={data.total}
            pageSize={limit}
            itemLabel="available product"
            onPageChange={setPage}
          />
        </div>
      )}
    </Page>
  );
}
