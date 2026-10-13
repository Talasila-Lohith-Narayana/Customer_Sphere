import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Customers from "./Customers";
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

const mockCustomersList = {
  items: [
    {
      customer_id: "c_1",
      customer_unique_id: "uid_111111",
      customer_city: "Sao Paulo",
      customer_state: "SP",
      segment: "High Risk",
      monetary_total: 1200,
      frequency: 3,
      avg_review_score: 5,
      recency_days: 10,
    },
    {
      customer_id: "c_2",
      customer_unique_id: "uid_222222",
      customer_city: "Rio de Janeiro",
      customer_state: "RJ",
      segment: "High Risk",
      monetary_total: 450,
      frequency: 2,
      avg_review_score: 4,
      recency_days: 45,
    },
  ],
  total: 2,
  page: 1,
  pages: 2,
  page_size: 12,
};

describe("Customers Directory Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(AuthContextModule, "useAuth").mockReturnValue({
      isAdmin: true,
    });
    window.URL.createObjectURL = vi.fn(() => "blob:mock-url");
    window.URL.revokeObjectURL = vi.fn();
  });

  it("displays loading state initially", () => {
    vi.spyOn(ApiModule.customerService, "list").mockReturnValue(new Promise(() => {}));

    render(
      <MemoryRouter>
        <Customers />
      </MemoryRouter>
    );

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("displays error state when customer fetching fails and retries on click", async () => {
    const listSpy = vi.spyOn(ApiModule.customerService, "list");
    listSpy.mockRejectedValueOnce(new Error("Failed to load customers"));

    render(
      <MemoryRouter>
        <Customers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
      expect(screen.getByText("Failed to load customers")).toBeInTheDocument();
    });

    listSpy.mockResolvedValueOnce(mockCustomersList);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByText("uid_111111")).toBeInTheDocument();
    });
  });

  it("renders empty state message when no customers match filters", async () => {
    vi.spyOn(ApiModule.customerService, "list").mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pages: 1,
    });

    render(
      <MemoryRouter>
        <Customers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("No customers match these filters.")).toBeInTheDocument();
    });
  });

  it("reads URL search parameters and passes them to the list API", async () => {
    const listSpy = vi.spyOn(ApiModule.customerService, "list").mockResolvedValue(mockCustomersList);

    render(
      <MemoryRouter initialEntries={["/customers?state=SP&segment=High%20Risk&activity=active&rating=5&sort=spend-desc"]}>
        <Routes>
          <Route path="/customers" element={<Customers />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({
        state: "SP",
        segment: "High Risk",
        activity: "active",
        rating: "5",
        sort_by: "spend",
        sort_dir: "desc",
        include_churn: false,
      }));
    });
  });

  it("filters search input and triggers list with query on submit", async () => {
    const mockList = vi.spyOn(ApiModule.customerService, "list").mockResolvedValue(mockCustomersList);

    render(
      <MemoryRouter>
        <Customers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("uid_111111")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search unique customer ID or city/i);
    fireEvent.change(searchInput, { target: { value: "Sao Paulo" } });
    const searchButton = screen.getByRole("button", { name: /^search$/i });
    expect(searchButton.parentElement).toBe(searchInput.closest(".customerSearchGroup"));
    fireEvent.click(searchButton);

    await waitFor(() => {
      expect(mockList).toHaveBeenCalledWith(expect.objectContaining({
        q: "Sao Paulo",
      }));
    });
  });

  it("navigates to customer details when a row is clicked", async () => {
    vi.spyOn(ApiModule.customerService, "list").mockResolvedValue(mockCustomersList);

    render(
      <MemoryRouter>
        <Customers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("uid_111111")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("uid_111111"));
    expect(mockNavigate).toHaveBeenCalledWith("/customers/uid_111111");
  });

  it("handles sorting via dropdown and table header column clicks", async () => {
    const mockList = vi.spyOn(ApiModule.customerService, "list").mockResolvedValue(mockCustomersList);

    render(
      <MemoryRouter>
        <Customers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("uid_111111")).toBeInTheDocument();
    });

    // Open sort dropdown
    const sortBtn = screen.getByRole("button", { name: /^Sort/i });
    fireEvent.click(sortBtn);
    expect(screen.getByText("Sort Customers By")).toBeInTheDocument();

    // Select Highest spend
    const dropdownMenu = document.querySelector(".sortDropdownMenu");
    const spendOption = within(dropdownMenu).getByText("Highest spend");
    fireEvent.click(spendOption);

    await waitFor(() => {
      expect(mockList).toHaveBeenCalledWith(expect.objectContaining({
        sort_by: "spend",
        sort_dir: "desc",
      }));
    });

    // Click table header for Location sorting (toggles desc, asc, clear)
    const getLocationHeader = () => screen.getByRole("button", { name: /^Location/i });
    fireEvent.click(getLocationHeader());
    await waitFor(() => {
      expect(mockList).toHaveBeenCalledWith(expect.objectContaining({
        sort_by: "city",
        sort_dir: "desc",
      }));
    });

    fireEvent.click(getLocationHeader());
    await waitFor(() => {
      expect(mockList).toHaveBeenCalledWith(expect.objectContaining({
        sort_by: "city",
        sort_dir: "asc",
      }));
    });

    // Clear sorting via sort dropdown menu
    fireEvent.click(screen.getByRole("button", { name: /Sort:/i }));
    const clearSortBtn = screen.getByText(/Clear sorting \(Default\)/i);
    fireEvent.click(clearSortBtn);
    await waitFor(() => {
      expect(mockList).toHaveBeenCalledWith(expect.objectContaining({
        sort_by: undefined,
        sort_dir: undefined,
      }));
    });
  });

  it("handles pagination: next and previous page controls", async () => {
    const mockList = vi.spyOn(ApiModule.customerService, "list").mockResolvedValue(mockCustomersList);

    render(
      <MemoryRouter>
        <Customers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("uid_111111")).toBeInTheDocument();
    });

    const nextBtn = screen.getByTitle("Next page");
    expect(nextBtn).not.toBeDisabled();
    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(mockList).toHaveBeenCalledWith(expect.objectContaining({
        page: 2,
      }));
    });

    const prevBtn = screen.getByTitle("Previous page");
    expect(prevBtn).not.toBeDisabled();
    fireEvent.click(prevBtn);

    await waitFor(() => {
      expect(mockList).toHaveBeenCalledWith(expect.objectContaining({
        page: 1,
      }));
    });
  });

  it("exports customer data to CSV and handles failure", async () => {
    vi.spyOn(ApiModule.customerService, "list").mockResolvedValue(mockCustomersList);
    const exportSpy = vi.spyOn(ApiModule.customerService, "exportCsv");

    render(
      <MemoryRouter>
        <Customers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("uid_111111")).toBeInTheDocument();
    });

    // Success export
    exportSpy.mockResolvedValueOnce({ data: "customer_id,city\nc_1,Sao Paulo" });
    const exportBtn = screen.getByRole("button", { name: /Export CSV/i });
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(exportSpy).toHaveBeenCalled();
      expect(window.URL.createObjectURL).toHaveBeenCalled();
      expect(window.URL.revokeObjectURL).toHaveBeenCalled();
    });

    // Failed export
    exportSpy.mockRejectedValueOnce(new Error("Disk full"));
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("Export failed: Disk full");
    });
  });

  it("supports selection mode, select all, select single, and bulk actions", async () => {
    vi.spyOn(ApiModule.customerService, "list").mockResolvedValue(mockCustomersList);
    const bulkSegmentSpy = vi.spyOn(ApiModule.customerService, "bulkSegmentUpdate").mockResolvedValue({ updated: 2 });
    const bulkDeleteSpy = vi.spyOn(ApiModule.customerService, "bulkDelete").mockResolvedValue({
      deleted_count: 1,
      skipped_count: 1,
    });

    render(
      <MemoryRouter>
        <Customers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("uid_111111")).toBeInTheDocument();
    });

    // Toggle selection mode on
    const selectModeBtn = screen.getByRole("button", { name: /Select Customers/i });
    fireEvent.click(selectModeBtn);
    expect(screen.getByRole("button", { name: /Done Selecting/i })).toBeInTheDocument();

    // Select all customers on page via header checkbox
    const checkboxes = screen.getAllByRole("checkbox");
    const selectAllCheckbox = checkboxes[0];
    fireEvent.click(selectAllCheckbox);

    expect(screen.getByText("2 customers selected")).toBeInTheDocument();

    // Clear selection
    fireEvent.click(screen.getByRole("button", { name: /Clear selection/i }));
    expect(screen.queryByText(/customers selected/i)).not.toBeInTheDocument();

    // Select single customer via row click in selection mode
    fireEvent.click(screen.getByText("uid_111111"));
    expect(screen.getByText("1 customer selected")).toBeInTheDocument();

    // Open Bulk Segment Modal and update
    fireEvent.click(screen.getByRole("button", { name: /Change Segment/i }));
    expect(screen.getByRole("heading", { name: /Update Segment/i })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Target Segment/i), {
      target: { value: "High Risk" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Apply to Selected/i }));

    await waitFor(() => {
      expect(bulkSegmentSpy).toHaveBeenCalledWith({
        customer_unique_ids: ["uid_111111"],
        segment: "High Risk",
      });
    });

    // Reselect and run Bulk Delete
    fireEvent.click(screen.getByText("uid_222222"));
    expect(screen.getByText("1 customer selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Bulk Delete/i }));
    expect(screen.getByRole("heading", { name: /Delete Selected Customers\?/i })).toBeInTheDocument();
    const confirmModal = screen.getByRole("dialog");
    fireEvent.click(within(confirmModal).getByRole("button", { name: /Bulk Delete/i }));

    await waitFor(() => {
      expect(bulkDeleteSpy).toHaveBeenCalledWith({
        customer_unique_ids: ["uid_222222"],
      });
      expect(mockToast.success).toHaveBeenCalledWith("Bulk delete complete. Deleted: 1, Skipped: 1");
    });
  });

  it("opens CustomerModal, saves a new customer, and refreshes directory", async () => {
    vi.spyOn(ApiModule.customerService, "list").mockResolvedValue(mockCustomersList);
    const createCustomerSpy = vi.spyOn(ApiModule.customerService, "create").mockResolvedValue({});

    render(
      <MemoryRouter>
        <Customers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("uid_111111")).toBeInTheDocument();
    });

    // Open Add Customer
    fireEvent.click(screen.getByRole("button", { name: /Add customer/i }));
    expect(screen.getByRole("heading", { name: "Add customer" })).toBeInTheDocument();

    const addModal = document.querySelector("form.modal");
    fireEvent.change(within(addModal).getByPlaceholderText(/00172711b30d52eea8b313a7f2cced02/i), {
      target: { value: "00172711b30d52eea8b313a7f2cced02" },
    });
    fireEvent.change(within(addModal).getByLabelText(/ZIP code/i), {
      target: { value: "13010" },
    });
    fireEvent.change(within(addModal).getByLabelText(/City/i), {
      target: { value: "Campinas" },
    });
    fireEvent.change(within(addModal).getByPlaceholderText(/e\.g\. SP/i), {
      target: { value: "SP" },
    });
    fireEvent.click(within(addModal).getByRole("button", { name: /Add customer/i }));

    await waitFor(() => {
      expect(createCustomerSpy).toHaveBeenCalledWith(expect.objectContaining({
        customer_unique_id: "00172711b30d52eea8b313a7f2cced02",
        customer_city: "Campinas",
        customer_state: "SP",
      }));
    });
  });

  it("applies and clears advanced filter criteria", async () => {
    const listSpy = vi.spyOn(ApiModule.customerService, "list").mockResolvedValue(mockCustomersList);

    render(
      <MemoryRouter>
        <Customers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("uid_111111")).toBeInTheDocument();
    });

    // Open filters
    fireEvent.click(screen.getByRole("button", { name: /^Filters/i }));
    expect(screen.getByText("Filter customers")).toBeInTheDocument();

    // Apply filters
    fireEvent.click(screen.getByRole("button", { name: /Apply filters/i }));

    await waitFor(() => {
      expect(listSpy).toHaveBeenCalled();
    });

    // Close filters modal
    fireEvent.click(screen.getByRole("button", { name: /^Filters/i }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Filter customers")).not.toBeInTheDocument();
  });

  it("closes CustomerModal and BulkModal on cancel or close button", async () => {
    vi.spyOn(ApiModule.customerService, "list").mockResolvedValue(mockCustomersList);

    render(
      <MemoryRouter>
        <Customers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("uid_111111")).toBeInTheDocument();
    });

    // Open & close CustomerModal
    fireEvent.click(screen.getByRole("button", { name: /Add customer/i }));
    expect(screen.getByRole("heading", { name: "Add customer" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "Add customer" })).not.toBeInTheDocument();

    // Select customer, open bulk modal, close via Cancel
    fireEvent.click(screen.getByRole("button", { name: /Select Customers/i }));
    fireEvent.click(screen.getByText("uid_111111"));
    fireEvent.click(screen.getByRole("button", { name: /Change Segment/i }));
    expect(screen.getByRole("heading", { name: /Update Segment/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: /Update Segment/i })).not.toBeInTheDocument();

    // Reopen bulk modal and close via close icon
    fireEvent.click(screen.getByRole("button", { name: /Change Segment/i }));
    const modalBg = document.querySelector(".modalBg");
    fireEvent.click(modalBg.querySelector("button.close"));
    expect(screen.queryByRole("heading", { name: /Update Segment/i })).not.toBeInTheDocument();
  });

  it("sorts by orders, spend, rating, and recency column headers", async () => {
    const listSpy = vi.spyOn(ApiModule.customerService, "list").mockResolvedValue(mockCustomersList);

    render(
      <MemoryRouter>
        <Customers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("uid_111111")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Orders/i));
    await waitFor(() => {
      expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ sort_by: "orders", sort_dir: "desc" }));
    });

    fireEvent.click(screen.getByText(/Spend/i));
    await waitFor(() => {
      expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ sort_by: "spend", sort_dir: "desc" }));
    });

    fireEvent.click(screen.getByText(/Rating/i));
    await waitFor(() => {
      expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ sort_by: "rating", sort_dir: "desc" }));
    });

    fireEvent.click(screen.getByText(/Recency/i));
    await waitFor(() => {
      expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ sort_by: "recency", sort_dir: "desc" }));
    });
  });

  it("hides admin-only buttons for non-admin viewers", async () => {
    vi.spyOn(AuthContextModule, "useAuth").mockReturnValue({
      isAdmin: false,
    });
    vi.spyOn(ApiModule.customerService, "list").mockResolvedValue(mockCustomersList);

    render(
      <MemoryRouter>
        <Customers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("uid_111111")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /Select Customers/i })).not.toBeInTheDocument();
  });
});
