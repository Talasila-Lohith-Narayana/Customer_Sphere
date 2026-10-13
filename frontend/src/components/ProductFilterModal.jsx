import React, { useState } from "react";
import { Package, SlidersHorizontal, Star, X } from "lucide-react";

export default function ProductFilterModal({
  values,
  categories,
  close,
  apply,
}) {
  const [draft, setDraft] = useState({
    category: values.category || "",
    minPrice: values.minPrice || "",
    maxPrice: values.maxPrice || "",
    minUnits: values.minUnits || "",
    minRating: values.minRating || "",
  });

  const update = (field, value) =>
    setDraft((current) => ({ ...current, [field]: value }));

  const clear = () =>
    setDraft({
      category: "",
      minPrice: "",
      maxPrice: "",
      minUnits: "",
      minRating: "",
    });

  return (
    <div className="modalBg">
      <form
        className="modal filterModal"
        onSubmit={(event) => {
          event.preventDefault();
          apply(draft);
        }}
      >
        <button type="button" className="close" onClick={close}>
          <X size={18} />
        </button>

        <div className="filterModalTitle">
          <div className="filterIcon">
            <SlidersHorizontal size={18} />
          </div>
          <div>
            <p className="eyebrow">CATALOG FILTERS</p>
            <h2>Filter Products</h2>
          </div>
        </div>

        <p className="filterHint">
          Refine the marketplace catalog by price bounds, sales volume thresholds, and review satisfaction.
        </p>

        <div className="filterModalGrid">
          {/* Category */}
          <div className="filterField filterCategoryField">
            <label htmlFor="modal-product-cat">Product Category</label>
            <select
              id="modal-product-cat"
              value={draft.category}
              onChange={(e) => update("category", e.target.value)}
            >
              <option value="">All Categories ({categories?.length || 0})</option>
              {(categories || []).map((cat) => (
                <option key={cat} value={cat}>
                  {cat.replace(/_/g, " ").toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          {/* Min Price */}
          <div className="filterField">
            <label htmlFor="modal-min-price">Min Price (R$)</label>
            <input
              id="modal-min-price"
              type="number"
              min="0"
              step="0.01"
              value={draft.minPrice}
              onChange={(e) => update("minPrice", e.target.value)}
              placeholder="e.g. 50"
            />
          </div>

          {/* Max Price */}
          <div className="filterField">
            <label htmlFor="modal-max-price">Max Price (R$)</label>
            <input
              id="modal-max-price"
              type="number"
              min="0"
              step="0.01"
              value={draft.maxPrice}
              onChange={(e) => update("maxPrice", e.target.value)}
              placeholder="e.g. 500"
            />
          </div>

          {/* Min Units Sold */}
          <div className="filterField">
            <label htmlFor="modal-min-units">Min Units Sold</label>
            <input
              id="modal-min-units"
              type="number"
              min="0"
              step="1"
              value={draft.minUnits}
              onChange={(e) => update("minUnits", e.target.value)}
              placeholder="e.g. 10"
            />
          </div>

          {/* Min Star Rating */}
          <div className="filterField">
            <label htmlFor="modal-min-rating">Minimum Star Rating</label>
            <select
              id="modal-min-rating"
              value={draft.minRating}
              onChange={(e) => update("minRating", e.target.value)}
            >
              <option value="">Any rating</option>
              <option value="4.5">★ 4.5 & above (Top rated)</option>
              <option value="4.0">★ 4.0 & above (Great)</option>
              <option value="3.0">★ 3.0 & above (Average)</option>
              <option value="2.0">★ 2.0 & above</option>
            </select>
          </div>
        </div>

        <div className="actions" style={{ marginTop: 24 }}>
          <button type="button" className="btn secondary" onClick={clear}>
            Reset filters
          </button>
          <button className="btn primary">Apply filters</button>
        </div>
      </form>
    </div>
  );
}
