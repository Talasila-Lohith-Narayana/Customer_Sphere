import React, { useState } from "react";
import { X } from "lucide-react";

// All 27 Brazilian state codes for autocomplete suggestions
const BRAZILIAN_STATES = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA",
  "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN",
  "RO", "RR", "RS", "SC", "SE", "SP", "TO"
];

// Default empty form state for creating a new customer
const initialForm = {
  customer_unique_id: "",
  customer_zip_code_prefix: "",
  customer_city: "",
  customer_state: "SP",
  segment: "Low Risk",
};

const SEGMENT_OPTIONS = [
  "High Risk",
  "Medium Risk",
  "Low Risk",
];

export default function CustomerModal({ customer, close, save, checkIdAvailable }) {
  // Pre-fill form if editing an existing customer, otherwise use empty template
  const [form, setForm] = useState(
    customer
      ? {
        customer_unique_id: customer.customer_unique_id || "",
        customer_zip_code_prefix: String(customer.customer_zip_code_prefix ?? ""),
        customer_city: customer.customer_city || "",
        customer_state: customer.customer_state || "SP",
        segment: customer.segment || "Low Risk",
      }
      : initialForm,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [generatingId, setGeneratingId] = useState(false);

  // Helper to update specific form field
  const update = (field, value) =>
    setForm((current) => ({ ...current, [field]: value }));

  const generateCustomerId = async () => {
    setGeneratingId(true);
    setError("");
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const bytes = window.crypto.getRandomValues(new Uint8Array(16));
        const candidate = Array.from(bytes, (byte) =>
          byte.toString(16).padStart(2, "0")
        ).join("");
        const { available } = await checkIdAvailable(candidate);
        if (available) {
          update("customer_unique_id", candidate);
          return;
        }
      }
      throw new Error("Could not generate an unused ID. Please try again.");
    } catch (generationError) {
      setError(generationError.message);
    } finally {
      setGeneratingId(false);
    }
  };

  async function submit(event) {
    event.preventDefault();
    const cleanState = form.customer_state.trim().toUpperCase();
    const cleanUid = form.customer_unique_id.trim();
    const cleanCity = form.customer_city.trim();

    if (!cleanUid) {
      setError("Please provide a valid Customer Unique ID (hash).");
      return;
    }
    if (cleanUid.length < 5) {
      setError("Customer Unique ID is too short (minimum 5 characters).");
      return;
    }
    if (!/^[0-9]{1,6}$/.test(form.customer_zip_code_prefix)) {
      setError("Please enter a valid numeric ZIP code (e.g. 01310).");
      return;
    }
    if (!cleanCity) {
      setError("Please enter the customer's city name.");
      return;
    }
    if (cleanState.length !== 2 || !BRAZILIAN_STATES.includes(cleanState)) {
      setError(`"${form.customer_state}" is not a valid 2-letter Brazilian state code (e.g. SP, RJ, MG).`);
      return;
    }

    setBusy(true);
    try {
      await save({
        ...form,
        customer_unique_id: form.customer_unique_id.trim(),
        customer_city: form.customer_city.trim(),
        customer_state: cleanState,
        customer_zip_code_prefix: form.customer_zip_code_prefix,
        segment: form.segment || undefined,
      });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modalBg">
      <form className="modal" onSubmit={submit}>
        <button type="button" className="close" onClick={close}>
          <X size={18} />
        </button>
        <p className="eyebrow">CUSTOMER DIRECTORY</p>
        <h2>{customer ? "Edit customer" : "Add customer"}</h2>
        <div className="customerIdField">
          <label htmlFor="customer-unique-id">Customer Unique ID</label>
          <input
            id="customer-unique-id"
            aria-label="Customer Unique ID"
            maxLength="32"
            value={form.customer_unique_id}
            onChange={(event) =>
              update("customer_unique_id", event.target.value)
            }
            placeholder="e.g. 00172711b30d52eea8b313a7f2cced02"
          />
          {!customer && checkIdAvailable && (
            <button
              type="button"
              className="btn secondary customerIdGenerateButton"
              onClick={generateCustomerId}
              disabled={busy || generatingId}
            >
              {generatingId ? "Checking IDs..." : "Generate random ID"}
            </button>
          )}
        </div>

        {customer && (
          <label>
            ML Customer Segment
            <select
              value={form.segment}
              onChange={(event) => update("segment", event.target.value)}
            >
              {SEGMENT_OPTIONS.map((seg) => (
                <option key={seg} value={seg}>
                  {seg}
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          ZIP code
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            pattern="[0-9]{1,6}"
            value={form.customer_zip_code_prefix}
            onChange={(event) =>
              update("customer_zip_code_prefix", event.target.value)
            }
          />
        </label>
        <label>
          City
          <input
            maxLength="100"
            value={form.customer_city}
            onChange={(event) => update("customer_city", event.target.value)}
          />
        </label>
        <label>
          State (Type or select)
          <input
            maxLength="2"
            list="brazil-states-list"
            value={form.customer_state}
            onChange={(event) =>
              update("customer_state", event.target.value.toUpperCase())
            }
            placeholder="e.g. SP"
            style={{ textTransform: "uppercase" }}
          />
          <datalist id="brazil-states-list">
            {BRAZILIAN_STATES.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </datalist>
        </label>
        {error && <div className="apiError">{error}</div>}
        <div className="actions">
          <button type="button" className="btn secondary" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? "Saving..." : customer ? "Save changes" : "Add customer"}
          </button>
        </div>
      </form>
    </div>
  );
}
