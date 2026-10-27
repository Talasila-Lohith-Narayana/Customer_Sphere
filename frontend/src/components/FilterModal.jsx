import React, { useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";

export default function FilterModal({
  values,
  states,
  activityOptions,
  close,
  apply,
}) {
  // Local draft state for filters before user clicks "Apply"
  const [draft, setDraft] = useState({
    ...values,
    ratings: values.ratings || [],
    churnRisk: values.churnRisk || [],
  });

  // Helper to update a single draft filter field
  const update = (field, value) =>
    setDraft((current) => ({ ...current, [field]: value }));
const toggleRating = (score) => {
    setDraft((current) => {
      const activeList = current.ratings || [];
      const exists = activeList.includes(score);
      const nextRatings = exists
        ? activeList.filter((s) => s !== score)
        : [...activeList, score];
      return { ...current, ratings: nextRatings };
    });
  };
const toggleChurnRisk = (level) => {
    setDraft((current) => {
      const activeList = current.churnRisk || [];
      const exists = activeList.includes(level);
      const nextList = exists
        ? activeList.filter((l) => l !== level)
        : [...activeList, level];
      return { ...current, churnRisk: nextList };
    });
  };
const clear = () =>
    setDraft({
      state: "",
      activity: "",
      ratings: [],
      churnRisk: [],
      maxRecency: "",
      minSpend: "",
      minOrders: "",
    });

  return (
    <div className="modalBg">
      <form
        className="modal filterModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="filter-modal-title"
        onSubmit={(event) => {
          event.preventDefault();
          apply(draft);
        }}
      >
        <button type="button" className="close" onClick={close} aria-label="Close filters">
          <X size={18} />
        </button>
        <div className="filterModalTitle">
          <div className="filterIcon">
            <SlidersHorizontal size={18} />
          </div>
          <div>
            <p className="eyebrow">CUSTOMER DIRECTORY</p>
            <h2 id="filter-modal-title">Filter customers</h2>
          </div>
        </div>
        <p className="filterHint">
          Choose filters, then apply them to the customer list.
        </p>
        <div className="filterModalGrid">
          <section className="filterSection fullWidth">
            <div className="filterSectionHeading">
              <h3>Customer attributes</h3>
              <p>Location and purchasing behavior</p>
            </div>
            <div className="filterModalFields">
              <div className="filterField">
                <label htmlFor="modal-state-filter">State</label>
                <input
                  id="modal-state-filter"
                  list="filter-states-list"
                  value={draft.state}
                  onChange={(event) => update("state", event.target.value.toUpperCase())}
                  placeholder="e.g. SP, RJ, MG..."
                  maxLength={2}
                  style={{ textTransform: "uppercase" }}
                />
                <datalist id="filter-states-list">
                  <option value="">All states</option>
                  {states.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </datalist>
              </div>
              <div className="filterField">
                <label htmlFor="modal-activity-filter">Activity</label>
                <select
                  id="modal-activity-filter"
                  value={draft.activity}
                  onChange={(event) => update("activity", event.target.value)}
                >
                  {activityOptions.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="filterField">
                <label htmlFor="modal-recency-filter">Recency up to</label>
                <input
                  id="modal-recency-filter"
                  type="number"
                  min="0"
                  value={draft.maxRecency}
                  onChange={(event) => update("maxRecency", event.target.value)}
                  placeholder="Days"
                />
              </div>
              <div className="filterField">
                <label htmlFor="modal-spend-filter">Minimum spend</label>
                <input
                  id="modal-spend-filter"
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.minSpend}
                  onChange={(event) => update("minSpend", event.target.value)}
                  placeholder="R$ amount"
                />
              </div>
              <div className="filterField">
                <label htmlFor="modal-orders-filter">Minimum orders</label>
                <input
                  id="modal-orders-filter"
                  type="number"
                  min="0"
                  step="1"
                  value={draft.minOrders}
                  onChange={(event) => update("minOrders", event.target.value)}
                  placeholder="Order count"
                />
              </div>
            </div>
          </section>
          <section className="filterSection fullWidth">
            <div className="filterSectionHeading">
              <h3>Customer rating</h3>
              <p>Select one or more review scores</p>
            </div>
            <div className="ratingPills">
              {[
                { score: "5", label: "5 stars" },
                { score: "4", label: "4 stars" },
                { score: "3", label: "3 stars" },
                { score: "2", label: "2 stars" },
                { score: "1", label: "1 star" },
              ].map(({ score, label }) => {
                const isSelected = (draft.ratings || []).includes(score);
                return (
                  <button
                    key={score}
                    type="button"
                    className={`ratingPill ${isSelected ? "active" : ""}`}
                    onClick={() => toggleRating(score)}
                  >
                    <span className="ratingStarIcon">★</span>
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </section>
          <section className="filterSection fullWidth">
            <div className="filterSectionHeading">
              <h3>Predicted churn risk</h3>
              <p>Based on model probability: low &lt;30%, medium 30 to &lt;70%, high &gt;=70%.</p>
            </div>
            <div className="ratingPills">
              {[
                { level: "high", label: "High (>=70%)", cls: "high" },
                { level: "medium", label: "Medium (30 to <70%)", cls: "medium" },
                { level: "low", label: "Low (<30%)", cls: "low" },
              ].map(({ level, label, cls }) => {
                const isSelected = (draft.churnRisk || []).includes(level);
                return (
                  <button
                    key={level}
                    type="button"
                    className={`ratingPill ${isSelected ? "active" : ""}`}
                    onClick={() => toggleChurnRisk(level)}
                    style={{
                      borderColor: isSelected
                        ? (cls === "high" ? "#f43f5e" : cls === "medium" ? "#f59e0b" : "#10b981")
                        : undefined,
                    }}
                  >
                    <span className={`churnDot ${cls}`} aria-hidden="true" />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
        <div className="actions filterModalActions">
          <button type="button" className="btn ghost" onClick={clear}>
            Clear all
          </button>
          <span />
          <button type="button" className="btn secondary" onClick={close}>
            Cancel
          </button>
          <button className="btn primary">Apply filters</button>
        </div>
      </form>
    </div>
  );
}
