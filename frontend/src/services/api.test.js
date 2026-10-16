import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import {
  authService,
  userService,
  dashboardService,
  analyticsService,
  productsService,
  customerService,
} from "./api";

// Mock axios module methods
vi.mock("axios", async () => {
  globalThis.__api_handlers = {};
  const actual = await vi.importActual("axios");
  const mockAxiosInstance = {
    get: vi.fn(() => Promise.resolve({ data: { success: true } })),
    post: vi.fn(() => Promise.resolve({ data: { success: true } })),
    patch: vi.fn(() => Promise.resolve({ data: { success: true } })),
    delete: vi.fn(() => Promise.resolve({ data: { success: true } })),
    interceptors: {
      request: {
        use: vi.fn((handler) => {
          globalThis.__api_handlers.request = handler;
        }),
      },
      response: {
        use: vi.fn((success, error) => {
          globalThis.__api_handlers.responseSuccess = success;
          globalThis.__api_handlers.responseError = error;
        }),
      },
    },
  };
  return {
    default: {
      ...actual,
      create: vi.fn(() => mockAxiosInstance),
    },
  };
});

describe("API Service Layer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the local retry time for rate-limited requests", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T10:00:00.000Z"));
    const error = {
      response: {
        status: 429,
        data: { detail: "Too many failed login attempts. Try again later." },
        headers: { "retry-after": "120" },
      },
    };
    const expectedTime = new Date(Date.now() + 120_000).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });

    try {
      await expect(globalThis.__api_handlers.responseError(error)).rejects.toThrow(
        `Too many failed login attempts. You can try again at ${expectedTime}.`
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("notifies auth context when the active bearer token is rejected", async () => {
    const token = "test-token";
    localStorage.setItem("ci_token", token);
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const error = {
      config: { headers: { Authorization: `Bearer ${token}` } },
      response: {
        status: 401,
        data: { detail: "Invalid or expired token. Please log in again." },
      },
    };

    await expect(
      globalThis.__api_handlers.responseError(error),
    ).rejects.toThrow("Invalid or expired token.");

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "auth-session-invalid",
        detail: { token },
      }),
    );
    dispatchSpy.mockRestore();
    localStorage.clear();
  });

  describe("authService", () => {
    it("calls /auth/login with credentials", async () => {
      const creds = { username: "admin", password: "password123" };
      const res = await authService.login(creds);
      expect(res).toEqual({ success: true });
    });

    it("fetches the available profile directory", async () => {
      await authService.profiles();
      expect(axios.create().get).toHaveBeenCalledWith("/auth/profiles");
    });

    it("validates the current session", async () => {
      await authService.validateSession();
      expect(axios.create().get).toHaveBeenCalledWith("/auth/session");
    });
  });

  describe("userService", () => {
    it("lists users and creates a user", async () => {
      const user = { username: "new_viewer", password: "password123", role: "viewer" };
      await userService.list();
      await userService.create(user);
      await userService.update("old_username", {
        username: "new_username",
        password: "updated-password",
      });
      await userService.delete("new_username");

      expect(axios.create().get).toHaveBeenCalledWith("/auth/users");
      expect(axios.create().post).toHaveBeenCalledWith("/auth/users", user);
      expect(axios.create().patch).toHaveBeenCalledWith(
        "/auth/users/old_username",
        { username: "new_username", password: "updated-password" },
      );
      expect(axios.create().delete).toHaveBeenCalledWith(
        "/auth/users/new_username",
      );
    });
  });

  describe("dashboardService", () => {
    it("calls /dashboard/summary with params", async () => {
      const res = await dashboardService.summary({ timeframe: "2018" });
      expect(res).toEqual({ success: true });
    });

    it("handles string timeframe argument", async () => {
      const res = await dashboardService.summary("2018");
      expect(res).toEqual({ success: true });
    });

    it("calls the deferred dashboard section endpoint with params", async () => {
      const res = await dashboardService.section("trends", { timeframe: "2018" });
      expect(res).toEqual({ success: true });
    });
  });

  describe("analyticsService", () => {
    it("calls analytics reporting endpoints", async () => {
      await analyticsService.clvSummary();
      await analyticsService.valueTiers();
      await analyticsService.cohortSummary();
      await analyticsService.activeCampaigns();
      await analyticsService.campaignsBySegment();
      await analyticsService.deliveryPerformance();
      await analyticsService.modelVersion();
      await analyticsService.modelCalibration();
      await analyticsService.churnDefinition();
      await analyticsService.customerClv("unique_123");
      await analyticsService.customerCampaign("unique_123");
      await analyticsService.customerDelivery("unique_123");
      await analyticsService.campaignCustomers("Retention Offer", { page: 2, page_size: 25 });
      await analyticsService.modelPerformance();
      await analyticsService.modelComparison();
      await analyticsService.modelImbalanceExperiments();
      await analyticsService.churnSummary({ threshold: 0.6 });
      await analyticsService.churnTopFeatures({ limit: 5 });
      await analyticsService.churnFeatureImportance({ limit: 15 });
      await analyticsService.customerRisk("unique_123");
      await analyticsService.churnLastRefresh();
      await analyticsService.churnProbabilityDistribution();
      await analyticsService.churnReasonCodeSummary();
      await analyticsService.customerExplanation("unique_123");

      expect(axios.create().get).toHaveBeenCalledWith("/analytics/clv/summary");
      expect(axios.create().get).toHaveBeenCalledWith("/analytics/customers/byvaluetier");
      expect(axios.create().get).toHaveBeenCalledWith(
        "/analytics/cohort/summary",
        { params: {} },
      );
      expect(axios.create().get).toHaveBeenCalledWith("/analytics/campaigns/active");
      expect(axios.create().get).toHaveBeenCalledWith("/analytics/campaigns/by-segment");
      expect(axios.create().get).toHaveBeenCalledWith("/analytics/delivery/performance");
      expect(axios.create().get).toHaveBeenCalledWith("/analytics/model/version");
      expect(axios.create().get).toHaveBeenCalledWith("/analytics/model/calibration");
      expect(axios.create().get).toHaveBeenCalledWith("/analytics/churn/definition");
      expect(axios.create().get).toHaveBeenCalledWith(
        "/analytics/customers/unique_123/clv",
      );
      expect(axios.create().get).toHaveBeenCalledWith(
        "/analytics/customers/unique_123/delivery",
      );
      expect(axios.create().get).toHaveBeenCalledWith(
        "/analytics/campaigns/Retention%20Offer/customers",
        { params: { page: 2, page_size: 25 } },
      );
      expect(axios.create().get).toHaveBeenCalledWith("/analytics/model/performance-summary");
      expect(axios.create().get).toHaveBeenCalledWith("/analytics/model/comparison");
      expect(axios.create().get).toHaveBeenCalledWith(
        "/analytics/model/imbalance-experiments",
        { params: {} },
      );
      expect(axios.create().get).toHaveBeenCalledWith(
        "/analytics/churn/summary",
        { params: { threshold: 0.6 } },
      );
      expect(axios.create().get).toHaveBeenCalledWith(
        "/analytics/churn/top-features",
        { params: { limit: 5 } },
      );
      expect(axios.create().get).toHaveBeenCalledWith(
        "/analytics/churn/feature-importance-global",
        { params: { limit: 15 } },
      );
      expect(axios.create().get).toHaveBeenCalledWith(
        "/analytics/members/unique_123/risk",
      );
      expect(axios.create().get).toHaveBeenCalledWith("/analytics/data/last-refresh");
      expect(axios.create().get).toHaveBeenCalledWith(
        "/analytics/churn/probability-distribution",
      );
      expect(axios.create().get).toHaveBeenCalledWith(
        "/analytics/churn/reason-codes/summary",
      );
      expect(axios.create().get).toHaveBeenCalledWith(
        "/analytics/customers/unique_123/explanation",
      );
      expect(axios.create().post).toHaveBeenCalledWith(
        "/analytics/campaigns/evaluate",
        { customer_unique_id: "unique_123" },
      );
    });
  });

  describe("productsService", () => {
    it("calls catalog with params", async () => {
      const res = await productsService.catalog({ page: 1 });
      expect(res).toEqual({ success: true });
    });

    it("calls byCategory endpoint", async () => {
      const res = await productsService.byCategory("health_beauty");
      expect(res).toEqual({ success: true });
    });

    it("calls exportCsv endpoint", async () => {
      const res = await productsService.exportCsv({ category: "books" });
      expect(res).toBeDefined();
    });
  });

  describe("customerService", () => {
    it("lists customers with params", async () => {
      const res = await customerService.list({ page: 1 });
      expect(res).toEqual({ success: true });
    });

    it("creates a customer profile", async () => {
      const res = await customerService.create({ name: "John Doe" });
      expect(res).toEqual({ success: true });
    });

    it("fetches customer detail by id", async () => {
      const res = await customerService.detail("cust_123");
      expect(res).toEqual({ success: true });
    });

    it("updates customer profile", async () => {
      const res = await customerService.update("cust_123", { city: "Rio" });
      expect(res).toEqual({ success: true });
    });

    it("removes customer profile", async () => {
      const res = await customerService.remove("cust_123");
      expect(res).toEqual({ success: true });
    });

    it("fetches customer orders", async () => {
      const res = await customerService.orders("cust_123");
      expect(res).toEqual({ success: true });
    });

    it("creates an order for a customer", async () => {
      const res = await customerService.createOrder("cust_123", { value: 100 });
      expect(res).toEqual({ success: true });
    });

    it("updates an existing order", async () => {
      const res = await customerService.updateOrder("cust_123", "ord_1", { status: "shipped" });
      expect(res).toEqual({ success: true });
    });

    it("deletes an order", async () => {
      const res = await customerService.removeOrder("cust_123", "ord_1");
      expect(res).toEqual({ success: true });
    });

    it("fetches customer reviews", async () => {
      const res = await customerService.reviews("cust_123");
      expect(res).toEqual({ success: true });
    });

    it("creates a review", async () => {
      const res = await customerService.createReview("cust_123", { score: 5 });
      expect(res).toEqual({ success: true });
    });

    it("updates a review", async () => {
      const res = await customerService.updateReview("cust_123", "rev_1", { score: 4 });
      expect(res).toEqual({ success: true });
    });

    it("fetches interactions", async () => {
      const res = await customerService.interactions("cust_123");
      expect(res).toEqual({ success: true });
    });

    it("adds an interaction", async () => {
      const res = await customerService.addInteraction("cust_123", { title: "Call" });
      expect(res).toEqual({ success: true });
    });

    it("updates an interaction", async () => {
      const res = await customerService.updateInteraction("cust_123", "act_1", { title: "Updated" });
      expect(res).toEqual({ success: true });
    });

    it("handles bulkSegmentUpdate and bulkDelete", async () => {
      const res1 = await customerService.bulkSegmentUpdate({ customer_ids: ["c1"], segment: "High Risk" });
      const res2 = await customerService.bulkDelete({ customer_ids: ["c1"] });
      expect(res1).toEqual({ success: true });
      expect(res2).toEqual({ success: true });
    });

    it("fetches audit logs and global audit logs", async () => {
      const res1 = await customerService.auditLogs("cust_123");
      const res2 = await customerService.globalAuditLogs();
      expect(res1).toEqual({ success: true });
      expect(res2).toEqual({ success: true });
    });

    it("exports customer csv", async () => {
      const res = await customerService.exportCsv({ state: "SP" });
      expect(res).toBeDefined();
    });

    it("fetches customer products", async () => {
      const res = await customerService.products("cust_123");
      expect(res).toEqual({ success: true });
    });
  });

  describe("Axios Interceptors", () => {
    it("attaches Authorization header if session exists in localStorage", () => {
      localStorage.setItem("ci_token", "xyz_token");
      const config = { headers: {} };
      const result = globalThis.__api_handlers.request(config);
      expect(result.headers.Authorization).toBe("Bearer xyz_token");
      localStorage.removeItem("ci_token");
    });

    it("passes response through on success", () => {
      const mockResponse = { data: { message: "ok" } };
      const result = globalThis.__api_handlers.responseSuccess(mockResponse);
      expect(result).toBe(mockResponse);
    });

    it("handles network connection error without response", async () => {
      const error = { response: null };
      await expect(globalThis.__api_handlers.responseError(error)).rejects.toThrow(
        /Unable to connect to the server/i
      );
    });

    it("handles Pydantic validation error lists with field names", async () => {
      const error = {
        response: {
          status: 422,
          data: {
            detail: [
              { loc: ["body", "user_name"], msg: "field required" },
              { loc: ["body", "password"], msg: "too short" },
            ],
          },
        },
      };
      await expect(globalThis.__api_handlers.responseError(error)).rejects.toThrow(
        /user name: field required/i
      );
    });

    it("handles string detail from FastAPI HTTPException", async () => {
      const error = {
        response: {
          status: 400,
          data: { detail: "Custom bad request error" },
        },
      };
      await expect(globalThis.__api_handlers.responseError(error)).rejects.toThrow(
        "Custom bad request error"
      );
    });

    it("handles HTTP status code fallback messages", async () => {
      const err = (status) => ({ response: { status, data: {} } });

      await expect(globalThis.__api_handlers.responseError(err(401))).rejects.toThrow(/session has expired/i);
      await expect(globalThis.__api_handlers.responseError(err(403))).rejects.toThrow(/Permission denied/i);
      await expect(globalThis.__api_handlers.responseError(err(404))).rejects.toThrow(/record was not found/i);
      await expect(globalThis.__api_handlers.responseError(err(409))).rejects.toThrow(/conflicting record/i);
      await expect(globalThis.__api_handlers.responseError(err(422))).rejects.toThrow(/invalid formatting/i);
      await expect(globalThis.__api_handlers.responseError(err(500))).rejects.toThrow(/Internal server error/i);
      await expect(globalThis.__api_handlers.responseError({ response: { status: 418, data: {} }, message: "I'm a teapot" })).rejects.toThrow("I'm a teapot");
    });
  });
});
