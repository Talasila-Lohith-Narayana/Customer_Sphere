import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
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
const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => {
      const navigate = actual.useNavigate();
      return (...args) => {
        mockNavigate(...args);
        return navigate(...args);
      };
    },
  };
});

function DashboardSegmentLink() {
  const [, setSearchParams] = useSearchParams();
  return (
    <button type="button" onClick={() => setSearchParams({ churn_risk: "low" })}>
      Filter dashboard segment
    </button>
  );
}

function CurrentSearchParams() {
  const { search } = useLocation();
  return <output data-testid="customer-search-params">{search}</output>;
}

function CustomersWithSearchParams() {
  return (
    <>
      <CurrentSearchParams />
      <Customers />
    </>
  );
}

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
  afterEach(() => {
    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
    } else {
      delete navigator.clipboard;
    }
  });

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

  it("explains an empty filtered result and lets users clear filters", async () => {
    const listSpy = vi.spyOn(ApiModule.customerService, "list").mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pages: 1,
    });

    render(
      <MemoryRouter initialEntries={["/customers?q=missing"]}>
        <Routes>
          <Route path="/customers" element={<CustomersWithSearchParams />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("No customers found")).toBeInTheDocument();
    expect(screen.getByText("Try removing a filter or broadening your search.")).toBeInTheDocument();
    fireEvent.click(
      within(document.querySelector(".customerEmptyState")).getByRole("button", {
        name: "Clear filters",
      })
    );

    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ q: "" }));
      expect(screen.getByTestId("customer-search-params")).not.toHaveTextContent("q=missing");
    });
  });

  it("shows model risk thresholds and keeps customer IDs copyable in the directory", async () => {
    vi.spyOn(ApiModule.customerService, "list").mockResolvedValue(mockCustomersList);

    render(
      <MemoryRouter>
        <Customers />
      </MemoryRouter>
    );

    expect(await screen.findByText("uid_111111")).toBeInTheDocument();
    expect(screen.getByRole("note", { name: "Model-predicted churn risk thresholds" })).toBeInTheDocument();
    expect(screen.getByText("30–<70%")).toBeInTheDocument();
    expect(document.querySelector(".customerDirectoryTable .dataTable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy customer ID uid_111111" })).toBeInTheDocument();
  });

  it("copies the full customer ID without opening the customer row", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.spyOn(ApiModule.customerService, "list").mockResolvedValue(mockCustomersList);

    render(
      <MemoryRouter>
        <Customers />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Copy customer ID uid_111111" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("uid_111111");
      expect(mockToast.success).toHaveBeenCalledWith("Customer ID copied.");
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("shows the customer ID initial in the directory avatar", async () => {
    vi.spyOn(ApiModule.customerService, "list").mockResolvedValue(mockCustomersList);

    render(
      <MemoryRouter>
        <Customers />
      </MemoryRouter>
    );

    const customerId = await screen.findByText("uid_111111");
    const identity = customerId.closest(".customerDirectoryIdentity");
    expect(identity.querySelector(".avatar")).toHaveTextContent("U");
  });

  it("explains unscored risk and links to the profile for scoring options", async () => {
    vi.spyOn(ApiModule.customerService, "list").mockResolvedValue({
      ...mockCustomersList,
      items: [{ ...mockCustomersList.items[0], segment: "Unscored" }],
    });

    render(
      <MemoryRouter>
        <Customers />
      </MemoryRouter>
    );

    expect(await screen.findByText("Unscored")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open profile for scoring options" }));
    expect(mockNavigate).toHaveBeenCalledWith("/customers/uid_111111");
  });

  it("reads legacy risk URLs and maps them to model probability filters", async () => {
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
        churn_risk: "high",
        activity: "active",
        rating: "5",
        sort_by: "spend",
        sort_dir: "desc",
        include_churn: true,
      }));
    });
  });

  it("removes an individual model-risk filter chip without clearing other filters", async () => {
    const listSpy = vi.spyOn(ApiModule.customerService, "list").mockResolvedValue(mockCustomersList);

    render(
      <MemoryRouter initialEntries={["/customers?state=SP&churn_risk=high"]}>
        <Routes>
          <Route path="/customers" element={<Customers />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("uid_111111")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Model churn risk: high filter" }));

    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({
        state: "SP",
        churn_risk: undefined,
      }));
    });
    expect(screen.queryByRole("button", { name: "Remove Model churn risk: high filter" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove State: SP filter" })).toBeInTheDocument();
  });

  it("replaces the selected model-risk band when following a dashboard risk link", async () => {
    const listSpy = vi.spyOn(ApiModule.customerService, "list").mockResolvedValue(mockCustomersList);

    render(
      <MemoryRouter initialEntries={["/customers?state=SP&churn_risk=high"]}>
        <DashboardSegmentLink />
        <Routes>
          <Route path="/customers" element={<Customers />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("uid_111111")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filter dashboard segment" }));
    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({
        churn_risk: "low",
      }));
    });
  });

  it("supports selecting multiple model-risk bands", async () => {
    const listSpy = vi.spyOn(ApiModule.customerService, "list").mockResolvedValue(mockCustomersList);

    render(
      <MemoryRouter initialEntries={["/customers?state=SP"]}>
        <Routes>
          <Route path="/customers" element={<Customers />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("uid_111111")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    fireEvent.click(within(document.querySelector(".filterModal")).getByRole("button", { name: /High \(>=70%\)/ }));
    fireEvent.click(within(document.querySelector(".filterModal")).getByRole("button", { name: /Apply filters/i }));
    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ churn_risk: "high" }));
    });

    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    const filterModal = within(document.querySelector(".filterModal"));
    fireEvent.click(filterModal.getByRole("button", { name: /Low \(<30%\)/ }));
    fireEvent.click(filterModal.getByRole("button", { name: /Apply filters/i }));

    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({
        churn_risk: "high,low",
      }));
    });
  });

  it("shows a single model-prediction risk filter", async () => {
    const listSpy = vi.spyOn(ApiModule.customerService, "list").mockResolvedValue(mockCustomersList);

    render(
      <MemoryRouter initialEntries={["/customers?churn_risk=low"]}>
        <Routes>
          <Route path="/customers" element={<Customers />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("uid_111111")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    const filterModal = within(document.querySelector(".filterModal"));
    expect(filterModal.getByRole("button", { name: /Low \(<30%\)/ })).toHaveClass("active");
    expect(filterModal.getByRole("button", { name: /High \(>=70%\)/ })).toBeEnabled();
    fireEvent.click(filterModal.getByRole("button", { name: /Apply filters/i }));

    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({
        churn_risk: "low",
      }));
    });
  });

  it("writes applied filters to the URL", async () => {
    const listSpy = vi.spyOn(ApiModule.customerService, "list").mockResolvedValue(mockCustomersList);

    render(
      <MemoryRouter initialEntries={["/customers?q="]}>
        <Routes>
          <Route path="/customers" element={<CustomersWithSearchParams />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText("uid_111111");
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    const filterModal = within(document.querySelector(".filterModal"));
    fireEvent.click(filterModal.getByRole("button", { name: /Low \(<30%\)/ }));
    fireEvent.click(filterModal.getByRole("button", { name: /Apply filters/i }));

    await waitFor(() => {
      expect(screen.getByTestId("customer-search-params")).toHaveTextContent("churn_risk=low");
      expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({
        churn_risk: "low",
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
    const pageTwoList = {
      ...mockCustomersList,
      items: [{ ...mockCustomersList.items[0], customer_unique_id: "uid_page_two" }],
    };
    const mockList = vi.spyOn(ApiModule.customerService, "list").mockImplementation(({ page }) =>
      Promise.resolve(page === 2 ? pageTwoList : mockCustomersList)
    );

    render(
      <MemoryRouter>
        <Customers />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("uid_111111")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(mockList).toHaveBeenCalledWith(expect.objectContaining({
        page: 2,
      }));
    });

    const nextBtn = screen.getByTitle("Next page");
    expect(nextBtn).not.toBeDisabled();
    fireEvent.click(nextBtn);

    expect(await screen.findByText("uid_page_two")).toBeInTheDocument();

    const prevBtn = screen.getByTitle("Previous page");
    expect(prevBtn).not.toBeDisabled();
    fireEvent.click(prevBtn);

    expect(await screen.findByText("uid_111111")).toBeInTheDocument();
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

  it("supports selection mode, select all, select single, and bulk deletion", async () => {
    vi.spyOn(ApiModule.customerService, "list").mockResolvedValue(mockCustomersList);
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
    expect(document.querySelector(".churnRiskLabel .churnDot.high")).toBeInTheDocument();
    expect(
      document.querySelector('td[data-label="frequency"] .customerOrderCount')
    ).toHaveTextContent("3");

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

    // Select another customer and run bulk delete
    fireEvent.click(screen.getByText("uid_222222"));
    expect(screen.getByText("2 customers selected")).toBeInTheDocument();
    fireEvent.click(screen.getByText("uid_111111"));
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

  it("closes CustomerModal and does not offer a manual risk override", async () => {
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

    // Select customer; model risk cannot be manually overridden here.
    fireEvent.click(screen.getByRole("button", { name: /Select Customers/i }));
    fireEvent.click(screen.getByText("uid_111111"));
    expect(screen.queryByRole("button", { name: /Change Segment/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Bulk Delete/i })).toBeInTheDocument();
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
