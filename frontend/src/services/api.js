import axios from "axios";

// Create Axios client pointing to the backend API base URL
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000/api",
});

// Request Interceptor: Attach JWT Bearer token from localStorage to every outgoing request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("ci_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Response Interceptor: Standardize backend error responses into clear, readable Error exceptions
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // 1. Connection / Network errors
    if (!error.response) {
      return Promise.reject(
        new Error("Unable to connect to the server. Please check your network connection or try again later.")
      );
    }

    const { status, data } = error.response;
    const detail = data?.detail;

    if (status === 429) {
      const retryAfterValue =
        error.response.headers?.get?.("retry-after") ??
        error.response.headers?.["retry-after"];
      const retryAfterSeconds = Number(retryAfterValue);
      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        const retryTime = new Date(Date.now() + retryAfterSeconds * 1000)
          .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        return Promise.reject(
          new Error(`Too many failed login attempts. You can try again at ${retryTime}.`)
        );
      }
      if (typeof detail === "string" && detail.trim()) {
        return Promise.reject(new Error(detail));
      }
      return Promise.reject(new Error("Too many failed login attempts. Please try again later."));
    }

    // 2. Handle Pydantic validation error lists with field names
    if (Array.isArray(detail)) {
      const messages = detail.map((err) => {
        const field = err.loc ? err.loc[err.loc.length - 1] : "Field";
        const formattedField = String(field).replace(/_/g, " ");
        return `${formattedField}: ${err.msg}`;
      });
      return Promise.reject(new Error(messages.join(". ")));
    }

    // 3. String detail provided by FastAPI HTTPException
    if (typeof detail === "string" && detail.trim()) {
      return Promise.reject(new Error(detail));
    }

    // 4. Fallback messages by HTTP status code
    if (status === 401) {
      return Promise.reject(new Error("Your session has expired or you are unauthorized. Please sign in again."));
    }
    if (status === 403) {
      return Promise.reject(new Error("Permission denied: Administrator privileges are required to perform this action."));
    }
    if (status === 404) {
      return Promise.reject(new Error("The requested record was not found or has been removed."));
    }
    if (status === 409) {
      return Promise.reject(new Error("A conflicting record with this identifier already exists."));
    }
    if (status === 422) {
      return Promise.reject(new Error("The submitted data contains invalid formatting. Please check all fields."));
    }
    if (status >= 500) {
      return Promise.reject(new Error("Internal server error occurred while processing your request. Please try again."));
    }

    return Promise.reject(new Error(error.message || "An unexpected error occurred."));
  },
);

// Helper to extract data payload directly from axios response promises
const data = (request) => request.then((response) => response.data);

/** Authentication service endpoints */
export const authService = {
  /** Login with username and password, returns JWT access_token */
  login: (credentials) => data(api.post("/auth/login", credentials)),
  /** Fetch account names and roles available in the profile switcher */
  profiles: () => data(api.get("/auth/profiles")),
};

/** Administrator-managed application accounts */
export const userService = {
  list: () => data(api.get("/auth/users")),
  create: (user) => data(api.post("/auth/users", user)),
  update: (username, changes) =>
    data(api.patch(`/auth/users/${encodeURIComponent(username)}`, changes)),
  delete: (username) =>
    data(api.delete(`/auth/users/${encodeURIComponent(username)}`)),
};

/** Executive dashboard analytics endpoints */
export const dashboardService = {
  /** Fetch the initial dashboard KPIs and comparison data */
  summary: (params = {}) => {
    const queryParams = typeof params === "string" ? { timeframe: params } : params;
    return data(api.get("/dashboard/summary", { params: queryParams }));
  },
  /** Fetch a deferred dashboard section when it approaches the viewport */
  section: (section, params = {}) =>
    data(api.get(`/dashboard/sections/${section}`, { params })),
  /** Fetch deep-dive geographic analytics for a specific Brazilian state */
  stateDetail: (stateCode, params = {}) => {
    return data(api.get(`/dashboard/geo/state/${stateCode}`, { params }));
  },
};

/** Aggregate customer, value, and cohort analytics endpoints */
export const analyticsService = {
  /** Fetch aggregate customer lifetime value metrics */
  clvSummary: () => data(api.get("/analytics/clv/summary")),
  /** Fetch customer counts and lifetime value by value tier */
  valueTiers: () => data(api.get("/analytics/customers/byvaluetier")),
  /** Fetch one summary row per acquisition cohort */
  cohortSummary: (params = {}) =>
    data(api.get("/analytics/cohort/summary", { params })),
  /** Fetch active campaigns and customer targeting counts */
  activeCampaigns: () => data(api.get("/analytics/campaigns/active")),
  /** Fetch campaign allocation by customer segment */
  campaignsBySegment: () => data(api.get("/analytics/campaigns/by-segment")),
  /** Fetch delivery KPIs and churn comparison by delivery status */
  deliveryPerformance: () => data(api.get("/analytics/delivery/performance")),
  /** Fetch active model version and configured features */
  modelVersion: () => data(api.get("/analytics/model/version")),
  /** Fetch model calibration metrics before and after calibration */
  modelCalibration: () => data(api.get("/analytics/model/calibration")),
  /** Fetch churn definition and retained/churned/censored counts */
  churnDefinition: () => data(api.get("/analytics/churn/definition")),
  /** Fetch CLV, value tier, segment, and churn data for one customer unique ID */
  customerClv: (customerUniqueId) =>
    data(api.get(`/analytics/customers/${customerUniqueId}/clv`)),
  /** Fetch the stored or rules-based campaign recommendation for one customer */
  customerCampaign: (customerUniqueId) =>
    data(api.post("/analytics/campaigns/evaluate", {
      customer_unique_id: customerUniqueId,
    })),
  /** Fetch delivered-order details for one customer unique ID */
  customerDelivery: (customerUniqueId) =>
    data(api.get(`/analytics/customers/${customerUniqueId}/delivery`)),
  /** Fetch customers targeted by one campaign */
  campaignCustomers: (campaignName, params = {}) =>
    data(api.get(
      `/analytics/campaigns/${encodeURIComponent(campaignName)}/customers`,
      { params },
    )),
  /** Fetch model test-set performance metrics */
  modelPerformance: () => data(api.get("/analytics/model/performance-summary")),
  /** Fetch benchmark metrics for champion and baseline models */
  modelComparison: () => data(api.get("/analytics/model/comparison")),
  /** Fetch experiments comparing class-imbalance strategies */
  modelImbalanceExperiments: (params = {}) =>
    data(api.get("/analytics/model/imbalance-experiments", { params })),
  /** Fetch aggregate churn rates and counts from stored model predictions */
  churnSummary: (params = {}) =>
    data(api.get("/analytics/churn/summary", { params })),
  /** Fetch globally aggregated positive SHAP drivers */
  churnTopFeatures: (params = {}) =>
    data(api.get("/analytics/churn/top-features", { params })),
  /** Fetch global mean absolute SHAP importance */
  churnFeatureImportance: (params = {}) =>
    data(api.get("/analytics/churn/feature-importance-global", { params })),
  /** Fetch one customer's stored churn risk-tier record */
  customerRisk: (customerUniqueId) =>
    data(api.get(`/analytics/members/${encodeURIComponent(customerUniqueId)}/risk`)),
  /** Fetch when stored churn predictions were most recently scored */
  churnLastRefresh: () => data(api.get("/analytics/data/last-refresh")),
  /** Fetch the distribution of stored churn probabilities */
  churnProbabilityDistribution: () =>
    data(api.get("/analytics/churn/probability-distribution")),
  /** Fetch counts and definitions for stored churn reason codes */
  churnReasonCodeSummary: () =>
    data(api.get("/analytics/churn/reason-codes/summary")),
  /** Fetch stored SHAP values and human-readable reasons for one customer */
  customerExplanation: (customerUniqueId) =>
    data(api.get(`/analytics/customers/${encodeURIComponent(customerUniqueId)}/explanation`)),
};

/** Products catalog service endpoints */
export const productsService = {
  /** Fetch catalog products with filters, sorting and pagination */
  catalog: (params) => data(api.get("/products", { params })),
  /** Fetch available product IDs for a specific category */
  byCategory: (category, limit = 50) =>
    data(api.get("/products/by-category", { params: { category, limit } })),
  /** Export full filtered products catalog to CSV */
  exportCsv: (params) =>
    api.get("/products/export", {
      params,
      responseType: "blob",
    }),
};

/** Customer intelligence & directory CRUD endpoints */
export const customerService = {
  /** List customers with search, filtering, sorting, and pagination */
  list: (params) => data(api.get("/customers", { params })),
  /** Create a new customer profile */
  create: (payload) => data(api.post("/customers", payload)),
  /** Get full customer detail including metrics, behavior signals, and payment preferences */
  detail: (id) => data(api.get(`/customers/${id}`)),
  /** Update customer profile information */
  update: (id, payload) => data(api.patch(`/customers/${id}`, payload)),
  /** Delete a customer (only allowed if customer has no order history) */
  remove: (id) => data(api.delete(`/customers/${id}`)),
  /** Fetch historical orders placed by a customer */
  orders: (id) => data(api.get(`/customers/${id}/orders`)),
  /** Fetch products purchased by a customer */
  products: (id) => data(api.get(`/customers/${id}/products`)),
  /** Fetch order reviews submitted by a customer */
  reviews: (id) => data(api.get(`/customers/${id}/reviews`)),
  /** Add a review for a customer */
  createReview: (id, payload) =>
    data(api.post(`/customers/${id}/reviews`, payload)),
  /** Edit an existing review for a customer */
  updateReview: (id, reviewId, payload) =>
    data(api.patch(`/customers/${id}/reviews/${reviewId}`, payload)),
  /** Fetch recorded CRM team interactions for a customer */
  interactions: (id) => data(api.get(`/customers/${id}/interactions`)),
  /** Record a new CRM interaction note for a customer */
  addInteraction: (id, payload) =>
    data(api.post(`/customers/${id}/interactions`, payload)),
  /** Edit/update an existing CRM interaction note */
  updateInteraction: (id, interactionId, payload) =>
    data(api.patch(`/customers/${id}/interactions/${interactionId}`, payload)),
  /** Place/create a new order for a customer */
  createOrder: (id, payload) =>
    data(api.post(`/customers/${id}/orders`, payload)),
  /** Edit/update an existing order for a customer */
  updateOrder: (id, orderId, payload) =>
    data(api.patch(`/customers/${id}/orders/${orderId}`, payload)),
  /** Delete an order and its associated reviews and items */
  removeOrder: (id, orderId) =>
    data(api.delete(`/customers/${id}/orders/${orderId}`)),
  removeOrders: (id, orderIds) =>
    data(api.post(`/customers/${id}/orders/bulk-delete`, { order_ids: orderIds })),
  /** Bulk update segment for multiple customers */
  bulkSegmentUpdate: (payload) =>
    data(api.post("/customers/bulk-segment", payload)),
  /** Bulk delete multiple customer profiles */
  bulkDelete: (payload) =>
    data(api.post("/customers/bulk-delete", payload)),
  /** Export full CSV dataset matching filter criteria directly from server */
  exportCsv: (params) =>
    api.get("/customers/export", { params, responseType: "blob" }),
  /** Fetch audit log trail of changes made to a customer */
  auditLogs: (id) => data(api.get(`/customers/${id}/audit-logs`)),
  /** Fetch global audit log history of all changes made in the platform */
  globalAuditLogs: (params) => data(api.get("/audit-logs", { params })),
};

/** AI Intelligence & Machine Learning endpoints */
export const predictionService = {
  /** Fetch complete ML insights (Churn, SHAP, CLV, AI Segment, Recommendations) */
  get: (idOrUniqueId) => data(api.get(`/predictions/${idOrUniqueId}`)),
  /** Manually trigger model scoring for a customer */
  rescore: (idOrUniqueId) => data(api.post(`/predictions/${idOrUniqueId}/rescore`)),
};
