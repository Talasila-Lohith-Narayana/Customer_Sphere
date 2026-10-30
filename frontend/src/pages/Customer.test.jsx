import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Customer from "./Customer";
import * as ApiModule from "../services/api";
import * as AuthContextModule from "../context/AuthContext";

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
};
vi.mock("../context/ToastContext", () => ({
  useToast: () => mockToast,
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockCustomerDetail = {
  customer_id: "c_123",
  customer_unique_id: "uid_999999",
  customer_zip_code_prefix: 13010,
  customer_city: "Sao Paulo",
  customer_state: "SP",
  segment: "High Risk",
  monetary_total: 1500,
  frequency: 4,
  recency_days: 20,
  avg_review_score: 4.8,
  avg_delivery_days: 9.2,
  customer_lifetime_value: 2100,
};

const mockOrder = {
  order_id: "ord_100",
  order_status: "delivered",
  payment_type: "credit_card",
  installments: 1,
  price: 135.0,
  freight_value: 15.0,
  order_purchase_timestamp: "2018-05-01T12:00:00Z",
  order_delivered_customer_date: "2018-05-06T12:00:00Z",
  order_value: 150.0,
};

const mockReview = {
  review_id: "rev_100",
  order_id: "ord_100",
  review_score: 5,
  review_comment_title: "Great service",
  review_comment_message: "Prompt delivery and great quality!",
  review_creation_date: "2018-05-10T12:00:00Z",
};

const mockInteraction = {
  id: 101,
  interaction_type: "Call",
  title: "Follow up call",
  description: "Customer was satisfied with prompt delivery.",
  created_at: "2018-05-11T12:00:00Z",
};

const mockAuditLog = {
  id: 1,
  action: "UPDATE_CUSTOMER",
  performed_by: "admin",
  details: "Updated segment",
  created_at: "2018-05-12T12:00:00Z",
};

function setupDefaultMocks() {
  vi.spyOn(ApiModule.customerService, "detail").mockResolvedValue(mockCustomerDetail);
  vi.spyOn(ApiModule.customerService, "orders").mockResolvedValue({ items: [mockOrder] });
  vi.spyOn(ApiModule.customerService, "products").mockResolvedValue({ items: [] });
  vi.spyOn(ApiModule.customerService, "reviews").mockResolvedValue({ items: [mockReview] });
  vi.spyOn(ApiModule.customerService, "interactions").mockResolvedValue([mockInteraction]);
  vi.spyOn(ApiModule.customerService, "auditLogs").mockResolvedValue({ items: [mockAuditLog] });
  vi.spyOn(ApiModule.predictionService, "get").mockResolvedValue(null);
}

describe("Customer Page Orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(AuthContextModule, "useAuth").mockReturnValue({
      isAdmin: true,
    });
  });

  it("renders loading state initially", () => {
    vi.spyOn(ApiModule.customerService, "detail").mockReturnValue(new Promise(() => {}));
    vi.spyOn(ApiModule.customerService, "orders").mockReturnValue(new Promise(() => {}));
    vi.spyOn(ApiModule.customerService, "products").mockReturnValue(new Promise(() => {}));
    vi.spyOn(ApiModule.customerService, "reviews").mockReturnValue(new Promise(() => {}));
    vi.spyOn(ApiModule.customerService, "interactions").mockReturnValue(new Promise(() => {}));
    vi.spyOn(ApiModule.customerService, "auditLogs").mockReturnValue(new Promise(() => {}));
    vi.spyOn(ApiModule.predictionService, "get").mockReturnValue(new Promise(() => {}));

    render(
      <MemoryRouter initialEntries={["/customers/c_123"]}>
        <Routes>
          <Route path="/customers/:id" element={<Customer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("Loading customer intelligence...")).toBeInTheDocument();
  });

  it("displays error state and retries on button click", async () => {
    vi.spyOn(ApiModule.customerService, "detail").mockRejectedValueOnce(new Error("Network Error"));
    setupDefaultMocks();

    render(
      <MemoryRouter initialEntries={["/customers/c_123"]}>
        <Routes>
          <Route path="/customers/:id" element={<Customer />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Network Error")).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText("uid_999999")).toBeInTheDocument();
    });
  });

  it("renders customer profile and tabs after data loads", async () => {
    setupDefaultMocks();
    vi.spyOn(ApiModule.predictionService, "get").mockResolvedValue({
      has_ml_data: true,
      segmentation: { segment_label: "High Risk" },
      churn: { risk_level: "high", percentage: 78 },
    });

    render(
      <MemoryRouter initialEntries={["/customers/c_123"]}>
        <Routes>
          <Route path="/customers/:id" element={<Customer />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("uid_999999")).toBeInTheDocument();
      expect(screen.getByText(/Sao Paulo, SP/i)).toBeInTheDocument();
      expect(screen.getByText("CONSUMER PROFILE · High Risk")).toBeInTheDocument();
    });

    // Test all tab buttons exist
    expect(screen.getByRole("button", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Products" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Orders" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reviews" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Audit Log" })).toBeInTheDocument();
  });

  it("shows customer details without waiting for predictions and loads tab data on demand", async () => {
    setupDefaultMocks();
    vi.spyOn(ApiModule.predictionService, "get").mockReturnValue(new Promise(() => {}));

    render(
      <MemoryRouter initialEntries={["/customers/c_123"]}>
        <Routes>
          <Route path="/customers/:id" element={<Customer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("uid_999999")).toBeInTheDocument();
    expect(ApiModule.customerService.orders).not.toHaveBeenCalled();
    expect(ApiModule.customerService.products).not.toHaveBeenCalled();
    expect(ApiModule.customerService.reviews).not.toHaveBeenCalled();
    expect(ApiModule.customerService.interactions).not.toHaveBeenCalled();
    expect(ApiModule.customerService.auditLogs).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Orders" }));
    expect(await screen.findByText("Order history")).toBeInTheDocument();
    expect(ApiModule.customerService.orders).toHaveBeenCalledWith("c_123");
    expect(ApiModule.customerService.products).not.toHaveBeenCalled();
  });

  it("navigates back to /customers when back button is clicked", async () => {
    setupDefaultMocks();

    render(
      <MemoryRouter initialEntries={["/customers/c_123"]}>
        <Routes>
          <Route path="/customers/:id" element={<Customer />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("uid_999999")).toBeInTheDocument();
    });

    const backBtn = screen.getByRole("button", { name: /customers/i });
    fireEvent.click(backBtn);
    expect(mockNavigate).toHaveBeenCalledWith("/customers");
  });

  it("hides admin action buttons when user is not admin", async () => {
    vi.spyOn(AuthContextModule, "useAuth").mockReturnValue({
      isAdmin: false,
    });
    setupDefaultMocks();

    render(
      <MemoryRouter initialEntries={["/customers/c_123"]}>
        <Routes>
          <Route path="/customers/:id" element={<Customer />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("uid_999999")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /edit customer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add activity/i })).not.toBeInTheDocument();
  });

  it("handles customer deletion: cancel, success, and failure", async () => {
    setupDefaultMocks();
    const removeSpy = vi.spyOn(ApiModule.customerService, "remove");

    render(
      <MemoryRouter initialEntries={["/customers/c_123"]}>
        <Routes>
          <Route path="/customers/:id" element={<Customer />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("uid_999999")).toBeInTheDocument();
    });

    const deleteBtn = screen.getByRole("button", { name: /delete/i });

    // Scenario 1: User cancels confirm
    fireEvent.click(deleteBtn);
    expect(screen.getByRole("heading", { name: /delete customer profile\?/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("heading", { name: /delete customer profile\?/i })).not.toBeInTheDocument();
    expect(removeSpy).not.toHaveBeenCalled();

    // Scenario 2: User confirms but API fails
    removeSpy.mockRejectedValueOnce(new Error("Cannot delete customer with active records"));
    fireEvent.click(deleteBtn);
    expect(screen.getByRole("heading", { name: /delete customer profile\?/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete Customer" }));
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("Cannot delete customer with active records");
    });
    expect(screen.queryByRole("heading", { name: /delete customer profile\?/i })).not.toBeInTheDocument();

    // Scenario 3: User confirms and API succeeds
    removeSpy.mockResolvedValueOnce({ ok: true });
    fireEvent.click(deleteBtn);
    expect(screen.getByRole("heading", { name: /delete customer profile\?/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete Customer" }));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/customers");
    });
  });

  it("edits customer via CustomerModal and reloads data", async () => {
    setupDefaultMocks();
    const updateSpy = vi.spyOn(ApiModule.customerService, "update").mockResolvedValue({});

    render(
      <MemoryRouter initialEntries={["/customers/c_123"]}>
        <Routes>
          <Route path="/customers/:id" element={<Customer />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("uid_999999")).toBeInTheDocument();
    });

    // Open edit modal
    fireEvent.click(screen.getByRole("button", { name: /edit customer/i }));
    expect(screen.getByRole("heading", { name: /edit customer/i })).toBeInTheDocument();

    // Submit edit
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith("c_123", expect.objectContaining({
        customer_unique_id: "uid_999999",
      }));
    });
  });

  it("adds and edits activity interaction notes", async () => {
    setupDefaultMocks();
    const addInteractionSpy = vi.spyOn(ApiModule.customerService, "addInteraction").mockResolvedValue({});
    const updateInteractionSpy = vi.spyOn(ApiModule.customerService, "updateInteraction").mockResolvedValue({});

    render(
      <MemoryRouter initialEntries={["/customers/c_123"]}>
        <Routes>
          <Route path="/customers/:id" element={<Customer />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("uid_999999")).toBeInTheDocument();
    });

    // Add activity via header button
    fireEvent.click(screen.getByRole("button", { name: /add activity/i }));
    expect(screen.getByRole("heading", { name: /add interaction/i })).toBeInTheDocument();

    // Fill form and save
    fireEvent.change(screen.getByPlaceholderText(/discussed delivery experience/i), {
      target: { value: "Pricing consultation" },
    });
    fireEvent.change(screen.getByPlaceholderText(/write a useful interaction note/i), {
      target: { value: "Explained enterprise discounts" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save interaction/i }));

    await waitFor(() => {
      expect(addInteractionSpy).toHaveBeenCalledWith("c_123", expect.objectContaining({
        title: "Pricing consultation",
        description: "Explained enterprise discounts",
      }));
    });

    // Switch to Activity tab and edit existing interaction
    fireEvent.click(screen.getByRole("button", { name: "Activity" }));
    await waitFor(() => {
      expect(screen.getByText("Follow up call")).toBeInTheDocument();
    });

    const editBtn = screen.getByTitle("Edit interaction note");
    fireEvent.click(editBtn);

    expect(screen.getByRole("heading", { name: /edit interaction/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save interaction/i }));

    await waitFor(() => {
      expect(updateInteractionSpy).toHaveBeenCalledWith("c_123", 101, expect.objectContaining({
        title: "Follow up call",
      }));
    });
  });

  it("adds, edits, and deletes customer orders", async () => {
    setupDefaultMocks();
    const createOrderSpy = vi.spyOn(ApiModule.customerService, "createOrder").mockResolvedValue({});
    const updateOrderSpy = vi.spyOn(ApiModule.customerService, "updateOrder").mockResolvedValue({});
    const removeOrderSpy = vi.spyOn(ApiModule.customerService, "removeOrder").mockResolvedValue({});
    vi.spyOn(ApiModule.productsService, "byCategory").mockResolvedValue({ products: ["p1"] });

    render(
      <MemoryRouter initialEntries={["/customers/c_123"]}>
        <Routes>
          <Route path="/customers/:id" element={<Customer />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("uid_999999")).toBeInTheDocument();
    });

    // Go to Orders tab
    fireEvent.click(screen.getByRole("button", { name: "Orders" }));
    await waitFor(() => {
      expect(screen.getByText("Order history")).toBeInTheDocument();
    });

    // Add Order
    fireEvent.click(screen.getByRole("button", { name: /add order/i }));
    expect(screen.getByRole("heading", { name: /place new order/i })).toBeInTheDocument();

    // Close Add Order
    const modalForm = document.querySelector("form.modal");
    fireEvent.click(within(modalForm).getByRole("button", { name: "Cancel" }));

    // Reopen Add Order
    fireEvent.click(screen.getByRole("button", { name: /add order/i }));
    const addOrderModal = document.querySelector("form.modal");
    // Fill item price & purchase date
    fireEvent.change(within(addOrderModal).getByPlaceholderText("99.90"), {
      target: { value: "120.00" },
    });
    fireEvent.change(addOrderModal.querySelector('input[type="date"]'), {
      target: { value: "2018-05-01" },
    });
    fireEvent.click(within(addOrderModal).getByRole("button", { name: /add order/i }));

    await waitFor(() => {
      expect(createOrderSpy).toHaveBeenCalledWith("c_123", expect.any(Object));
    });

    // Edit Order
    const editOrderBtn = screen.getByTitle("Edit order details");
    fireEvent.click(editOrderBtn);
    expect(screen.getByRole("heading", { name: /edit order/i })).toBeInTheDocument();

    const editOrderModal = document.querySelector("form.modal");
    fireEvent.click(within(editOrderModal).getByRole("button", { name: /save changes/i }));
    await waitFor(() => {
      expect(updateOrderSpy).toHaveBeenCalledWith("c_123", "ord_100", expect.any(Object));
    });

    // Delete Order via Modal
    fireEvent.click(screen.getByTitle("Edit order details"));
    expect(screen.getByRole("heading", { name: /edit order/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /delete order/i }));
    expect(screen.getByRole("heading", { name: /delete order\?/i })).toBeInTheDocument();
    const confirmModal = screen.getByRole("dialog");
    fireEvent.click(within(confirmModal).getByRole("button", { name: /delete order/i }));
    await waitFor(() => {
      expect(removeOrderSpy).toHaveBeenCalledWith("c_123", "ord_100");
    });
  });

  it("adds and edits customer reviews", async () => {
    // Return an order without review to allow Add Review button to be enabled
    vi.spyOn(ApiModule.customerService, "detail").mockResolvedValue(mockCustomerDetail);
    vi.spyOn(ApiModule.customerService, "orders").mockResolvedValue({
      items: [
        mockOrder,
        {
          order_id: "ord_200",
          order_status: "delivered",
          payment_type: "boleto",
          order_purchase_timestamp: "2018-06-01T10:00:00Z",
          order_value: 80.0,
        },
      ],
    });
    vi.spyOn(ApiModule.customerService, "products").mockResolvedValue({ items: [] });
    vi.spyOn(ApiModule.customerService, "reviews").mockResolvedValue({ items: [mockReview] });
    vi.spyOn(ApiModule.customerService, "interactions").mockResolvedValue([]);
    vi.spyOn(ApiModule.customerService, "auditLogs").mockResolvedValue({ items: [] });

    const createReviewSpy = vi.spyOn(ApiModule.customerService, "createReview").mockResolvedValue({});
    const updateReviewSpy = vi.spyOn(ApiModule.customerService, "updateReview").mockResolvedValue({});

    render(
      <MemoryRouter initialEntries={["/customers/c_123"]}>
        <Routes>
          <Route path="/customers/:id" element={<Customer />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("uid_999999")).toBeInTheDocument();
    });

    // Go to Reviews tab
    fireEvent.click(screen.getByRole("button", { name: "Reviews" }));
    await waitFor(() => {
      expect(screen.getByText("Customer reviews")).toBeInTheDocument();
    });

    // Add review
    const addReviewBtn = screen.getByRole("button", { name: /add review/i });
    expect(addReviewBtn).not.toBeDisabled();
    fireEvent.click(addReviewBtn);
    expect(screen.getByRole("heading", { name: /add customer review/i })).toBeInTheDocument();

    const addReviewModal = document.querySelector("form.reviewModal");
    fireEvent.change(within(addReviewModal).getByPlaceholderText(/ótimo produto/i), {
      target: { value: "Excellent experience" },
    });
    fireEvent.change(within(addReviewModal).getByPlaceholderText(/enter customer feedback/i), {
      target: { value: "Top notch seller!" },
    });
    fireEvent.click(within(addReviewModal).getByRole("button", { name: /submit review/i }));
    await waitFor(() => {
      expect(createReviewSpy).toHaveBeenCalledWith("c_123", expect.any(Object));
    });

    // Edit review
    const editReviewBtn = screen.getByTitle("Edit review");
    fireEvent.click(editReviewBtn);
    expect(screen.getByRole("heading", { name: /edit review/i })).toBeInTheDocument();

    const editReviewModal = document.querySelector("form.reviewModal");
    fireEvent.click(within(editReviewModal).getByRole("button", { name: /save changes/i }));
    await waitFor(() => {
      expect(updateReviewSpy).toHaveBeenCalledWith("c_123", "rev_100", expect.any(Object));
    });
  });

  it("calculates fallback CLV without using a stored customer risk segment", async () => {
    const customerWithoutCLV = {
      ...mockCustomerDetail,
      customer_lifetime_value: null,
      monetary_total: 1000,
      segment: "Medium Risk",
    };

    vi.spyOn(ApiModule.customerService, "detail").mockResolvedValue(customerWithoutCLV);
    vi.spyOn(ApiModule.customerService, "orders").mockResolvedValue({ items: [] });
    vi.spyOn(ApiModule.customerService, "products").mockResolvedValue({ items: [] });
    vi.spyOn(ApiModule.customerService, "reviews").mockResolvedValue({ items: [] });
    vi.spyOn(ApiModule.customerService, "interactions").mockResolvedValue([]);
    vi.spyOn(ApiModule.customerService, "auditLogs").mockResolvedValue({ items: [] });
    vi.spyOn(ApiModule.predictionService, "get").mockResolvedValue({
      has_ml_data: true,
      segmentation: { segment_label: "Medium Risk" },
      churn: { risk_level: "medium", percentage: 42 },
    });

    render(
      <MemoryRouter initialEntries={["/customers/c_123"]}>
        <Routes>
          <Route path="/customers/:id" element={<Customer />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("CONSUMER PROFILE · Medium Risk")).toBeInTheDocument();
    });

    // Medium Risk fallback preserves realized spend.
    expect(screen.getAllByText(/1,000\.00/i).length).toBeGreaterThan(0);
  });
});
