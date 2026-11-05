import React, { useEffect, useState } from "react";
import { X } from "lucide-react";

// All 27 Brazilian state codes
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
};

export default function CustomerModal({
  customer,
  close,
  save,
  checkIdAvailable,
  loadCities,
  loadZipCodes,
}) {
  // Pre-fill form if editing an existing customer, otherwise use empty template
  const [form, setForm] = useState(
    customer
      ? {
        customer_unique_id: customer.customer_unique_id || "",
        customer_zip_code_prefix: String(customer.customer_zip_code_prefix ?? ""),
        customer_city: customer.customer_city || "",
        customer_state: customer.customer_state || "SP",
      }
      : initialForm,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [generatingId, setGeneratingId] = useState(false);
  const [cities, setCities] = useState([]);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const [citiesError, setCitiesError] = useState("");
  const [cityLoadAttempt, setCityLoadAttempt] = useState(0);
  const [zipCodes, setZipCodes] = useState([]);
  const [zipCodesLoading, setZipCodesLoading] = useState(false);
  const [zipCodesError, setZipCodesError] = useState("");
  const [zipCodeLoadAttempt, setZipCodeLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    if (!loadCities || !form.customer_state) {
      setCities([]);
      setCitiesLoading(false);
      setCitiesError("");
      return () => {
        active = false;
      };
    }

    setCitiesLoading(true);
    setCitiesError("");
    loadCities(form.customer_state)
      .then((result) => {
        if (!Array.isArray(result?.cities)) {
          throw new Error("The server returned an invalid city list.");
        }
        if (active) setCities(result.cities);
      })
      .catch((loadError) => {
        if (active) setCitiesError(loadError.message || "Unable to load cities.");
      })
      .finally(() => {
        if (active) setCitiesLoading(false);
      });

    return () => {
      active = false;
    };
  }, [form.customer_state, loadCities, cityLoadAttempt]);

  useEffect(() => {
    let active = true;
    if (!loadZipCodes || !form.customer_state || !form.customer_city) {
      setZipCodes([]);
      setZipCodesLoading(false);
      setZipCodesError("");
      return () => {
        active = false;
      };
    }

    setZipCodesLoading(true);
    setZipCodesError("");
    loadZipCodes(form.customer_state, form.customer_city)
      .then((result) => {
        if (!Array.isArray(result?.zip_codes)) {
          throw new Error("The server returned an invalid ZIP code list.");
        }
        if (active) {
          const availableZipCodes = result.zip_codes.map(String);
          setZipCodes(availableZipCodes);
          setForm((current) => ({
            ...current,
            customer_zip_code_prefix: availableZipCodes.length === 1
              ? availableZipCodes[0]
              : availableZipCodes.includes(current.customer_zip_code_prefix)
                ? current.customer_zip_code_prefix
                : "",
          }));
        }
      })
      .catch((loadError) => {
        if (active) setZipCodesError(loadError.message || "Unable to load ZIP codes.");
      })
      .finally(() => {
        if (active) setZipCodesLoading(false);
      });

    return () => {
      active = false;
    };
  }, [form.customer_state, form.customer_city, loadZipCodes, zipCodeLoadAttempt]);

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

        <label htmlFor="customer-zip-code">
          ZIP code
          {loadZipCodes ? (
            <select
              id="customer-zip-code"
              value={form.customer_zip_code_prefix}
              onChange={(event) =>
                update("customer_zip_code_prefix", event.target.value)
              }
              disabled={
                !form.customer_state ||
                !form.customer_city ||
                zipCodesLoading ||
                Boolean(zipCodesError) ||
                (!zipCodes.length && !form.customer_zip_code_prefix)
              }
            >
              <option value="">
                {zipCodesLoading
                  ? "Loading ZIP codes..."
                  : zipCodesError
                    ? "ZIP codes unavailable"
                    : !form.customer_city
                      ? "Choose a city first"
                      : zipCodes.length
                        ? "Choose a ZIP code..."
                        : "No ZIP codes available"}
              </option>
              {form.customer_zip_code_prefix &&
                !zipCodes.includes(form.customer_zip_code_prefix) && (
                  <option value={form.customer_zip_code_prefix}>
                    {form.customer_zip_code_prefix}
                  </option>
                )}
              {zipCodes.map((zipCode) => (
                <option key={zipCode} value={zipCode}>{zipCode}</option>
              ))}
            </select>
          ) : (
            <input
              id="customer-zip-code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              pattern="[0-9]{1,6}"
              value={form.customer_zip_code_prefix}
              onChange={(event) =>
                update("customer_zip_code_prefix", event.target.value)
              }
            />
          )}
        </label>
        <label htmlFor="customer-state">
          State
          <select
            id="customer-state"
            value={form.customer_state}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                customer_state: event.target.value,
                customer_city: "",
                customer_zip_code_prefix: "",
              }))
            }
          >
            <option value="">Choose a state...</option>
            {BRAZILIAN_STATES.map((state) => (
              <option key={state} value={state}>{state}</option>
            ))}
          </select>
        </label>
        <label htmlFor="customer-city">
          City
          <select
            id="customer-city"
            value={form.customer_city}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                customer_city: event.target.value,
                customer_zip_code_prefix: "",
              }))
            }
            disabled={citiesLoading || !form.customer_state || Boolean(citiesError)}
          >
            <option value="">
              {citiesLoading
                ? "Loading cities..."
                : citiesError
                  ? "Cities unavailable"
                  : !form.customer_state
                    ? "Choose a state first"
                    : cities.length
                      ? "Choose a city..."
                      : "No cities available"}
            </option>
            {form.customer_city && !cities.includes(form.customer_city) && (
              <option value={form.customer_city}>{form.customer_city}</option>
            )}
            {cities.map((city) => (
              <option key={city} value={city}>{city}</option>
            ))}
          </select>
        </label>
        {citiesError && (
          <div className="apiError">
            {citiesError}
            <button
              type="button"
              className="btn ghost"
              onClick={() => setCityLoadAttempt((attempt) => attempt + 1)}
            >
              Retry
            </button>
          </div>
        )}
        {zipCodesError && (
          <div className="apiError">
            {zipCodesError}
            <button
              type="button"
              className="btn ghost"
              onClick={() => setZipCodeLoadAttempt((attempt) => attempt + 1)}
            >
              Retry ZIP codes
            </button>
          </div>
        )}
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
