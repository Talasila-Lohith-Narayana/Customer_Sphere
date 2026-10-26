import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Products from "./Products";
import * as ApiModule from "../services/api";

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
};
vi.mock("../context/ToastContext", () => ({
  useToast: () => mockToast,
}));

const mockProductsData = {
  items: [
    {
      product_id: "prod_111",
      category: "health_beauty",
      category_name: "health_beauty",
      photos_qty: 4,
      weight_g: 450,
      total_units_sold: 85,
      total_revenue: 4500,
      avg_price: 52.9,
      avg_freight: 12.5,
      avg_rating: 4.6,
      total_reviews: 32,
    },
    {
      product_id: "prod_222",
      category: "watches_gifts",
      category_name: "watches_gifts",
      photos_qty: 2,
      weight_g: 200,
      total_units_sold: 40,
      total_revenue: 8000,
      avg_price: 200.0,
      avg_freight: 18.0,
      avg_rating: 4.8,
      total_reviews: 15,
    },
  ],
  total: 2,
  page: 1,
  total_pages: 2,
  categories: ["health_beauty", "watches_gifts"],
};

describe("Products Catalog Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.URL.createObjectURL = vi.fn(() => "blob:mock-url");
    window.URL.revokeObjectURL = vi.fn();
  });

  it("displays loading state initially", () => {
    vi.spyOn(ApiModule.productsService, "catalog").mockReturnValue(
      new Promise(() => {})
    );

    render(
      <MemoryRouter>
        <Products />
      </MemoryRouter>
    );

    expect(screen.getByText("Loading marketplace products catalog...")).toBeInTheDocument();
  });

  it("displays error state when products fail to load and retries", async () => {
    const catalogSpy = vi.spyOn(ApiModule.productsService, "catalog");
    catalogSpy.mockRejectedValueOnce(new Error("Catalog service unavailable"));

    render(
      <MemoryRouter>
        <Products />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
      expect(screen.getByText("Catalog service unavailable")).toBeInTheDocument();
    });

    catalogSpy.mockResolvedValueOnce(mockProductsData);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByText("prod_111")).toBeInTheDocument();
    });
  });

  it("displays empty state message when no products match criteria", async () => {
    vi.spyOn(ApiModule.productsService, "catalog").mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      total_pages: 1,
      categories: ["health_beauty"],
    });

    render(
      <MemoryRouter>
        <Products />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/No matching products found in catalog/i)).toBeInTheDocument();
    });
  });

  it("initializes category filter from URL search parameters", async () => {
    const catalogSpy = vi.spyOn(ApiModule.productsService, "catalog").mockResolvedValue(mockProductsData);

    render(
      <MemoryRouter initialEntries={["/products?category=watches_gifts"]}>
        <Routes>
          <Route path="/products" element={<Products />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(catalogSpy).toHaveBeenCalledWith(expect.objectContaining({
        category: "watches_gifts",
      }));
    });
  });

  it("removes a product filter chip and refreshes the catalog", async () => {
    const catalogSpy = vi.spyOn(ApiModule.productsService, "catalog").mockResolvedValue(mockProductsData);

    render(
      <MemoryRouter initialEntries={["/products?category=watches_gifts"]}>
        <Routes>
          <Route path="/products" element={<Products />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("prod_111")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Category: watches gifts filter" }));

    await waitFor(() => {
      expect(catalogSpy).toHaveBeenLastCalledWith(expect.objectContaining({ category: undefined }));
    });
    expect(screen.queryByRole("button", { name: "Remove Category: watches gifts filter" })).not.toBeInTheDocument();
  });

  it("renders product table and catalog items", async () => {
    vi.spyOn(ApiModule.productsService, "catalog").mockResolvedValue(
      mockProductsData
    );

    render(
      <MemoryRouter>
        <Products />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("prod_111")).toBeInTheDocument();
      expect(screen.getByText("health beauty")).toBeInTheDocument();
      expect(screen.getByText("prod_222")).toBeInTheDocument();
      expect(screen.getByText("watches gifts")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /Export CSV/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Filters/i })).toBeInTheDocument();
  });

  it("filters products by category dropdown and search input", async () => {
    const catalogSpy = vi.spyOn(ApiModule.productsService, "catalog").mockResolvedValue(
      mockProductsData
    );

    render(
      <MemoryRouter>
        <Products />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("prod_111")).toBeInTheDocument();
    });

    // Category dropdown
    const categorySelect = screen.getByRole("combobox");
    fireEvent.change(categorySelect, { target: { value: "health_beauty" } });

    await waitFor(() => {
      expect(catalogSpy).toHaveBeenCalledWith(expect.objectContaining({
        category: "health_beauty",
      }));
    });

    // Search input
    const searchInput = screen.getByPlaceholderText(/search product id or category/i);
    fireEvent.change(searchInput, { target: { value: "health" } });

    await waitFor(() => {
      expect(catalogSpy).toHaveBeenCalledWith(expect.objectContaining({
        q: "health",
      }));
    }, { timeout: 1000 });
  });

  it("opens, applies, and resets advanced filters", async () => {
    const catalogSpy = vi.spyOn(ApiModule.productsService, "catalog").mockResolvedValue(
      mockProductsData
    );

    render(
      <MemoryRouter>
        <Products />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("prod_111")).toBeInTheDocument();
    });

    // Open filter modal
    fireEvent.click(screen.getByRole("button", { name: /^Filters/i }));
    expect(screen.getByText(/Filter Products/i)).toBeInTheDocument();

    // Close without applying
    const closeBtn = document.querySelector(".modalBg button.close");
    fireEvent.click(closeBtn);
    expect(screen.queryByText(/Filter Products/i)).not.toBeInTheDocument();

    // Reopen and apply
    fireEvent.click(screen.getByRole("button", { name: /^Filters/i }));
    fireEvent.change(screen.getByPlaceholderText("e.g. 50"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: /apply filters/i }));

    await waitFor(() => {
      expect(catalogSpy).toHaveBeenCalledWith(expect.objectContaining({
        min_price: 30,
      }));
    });

    // Reset button should now be visible
    const resetBtn = screen.getByRole("button", { name: /reset/i });
    expect(resetBtn).toBeInTheDocument();
    fireEvent.click(resetBtn);

    await waitFor(() => {
      expect(catalogSpy).toHaveBeenCalledWith(expect.objectContaining({
        min_price: undefined,
      }));
    });
  });

  it("handles sorting via dropdown and column header clicks", async () => {
    const catalogSpy = vi.spyOn(ApiModule.productsService, "catalog").mockResolvedValue(
      mockProductsData
    );

    render(
      <MemoryRouter>
        <Products />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("prod_111")).toBeInTheDocument();
    });

    // Open sort dropdown and click outside to close
    const sortBtn = screen.getByRole("button", { name: /Sort:/i });
    fireEvent.click(sortBtn);
    expect(screen.getByText("Sort Products By")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("Sort Products By")).not.toBeInTheDocument();

    // Reopen and select Highest revenue
    fireEvent.click(sortBtn);
    fireEvent.click(screen.getByText("Highest revenue"));
    await waitFor(() => {
      expect(catalogSpy).toHaveBeenCalledWith(expect.objectContaining({
        sort: "revenue_desc",
      }));
    });

    // Table header sort clicks (toggling asc and back to default)
    const unitsSoldTh = screen.getByRole("columnheader", { name: /Units Sold/i });
    fireEvent.click(unitsSoldTh);
    fireEvent.click(unitsSoldTh);
    fireEvent.click(unitsSoldTh);
    await waitFor(() => {
      expect(catalogSpy).toHaveBeenCalledWith(expect.objectContaining({
        sort: "items_desc",
      }));
    });

    fireEvent.click(screen.getByText(/Total Revenue/i));
    await waitFor(() => {
      expect(catalogSpy).toHaveBeenCalledWith(expect.objectContaining({
        sort: "revenue_desc",
      }));
    });

    fireEvent.click(screen.getByText(/Avg Price/i));
    await waitFor(() => {
      expect(catalogSpy).toHaveBeenCalledWith(expect.objectContaining({
        sort: "price_desc",
      }));
    });

    fireEvent.click(screen.getByText(/Rating/i));
    await waitFor(() => {
      expect(catalogSpy).toHaveBeenCalledWith(expect.objectContaining({
        sort: "rating_desc",
      }));
    });

    fireEvent.click(screen.getByText(/Category/i));
    await waitFor(() => {
      expect(catalogSpy).toHaveBeenCalledWith(expect.objectContaining({
        sort: "category_desc",
      }));
    });
  });

  it("handles pagination navigation with Prev and Next buttons", async () => {
    const catalogSpy = vi.spyOn(ApiModule.productsService, "catalog").mockResolvedValue(
      mockProductsData
    );

    render(
      <MemoryRouter>
        <Products />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("prod_111")).toBeInTheDocument();
    });

    const nextBtn = screen.getByRole("button", { name: /Next/i });
    expect(nextBtn).not.toBeDisabled();
    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(catalogSpy).toHaveBeenCalledWith(expect.objectContaining({
        page: 2,
      }));
    });

    const prevBtn = screen.getByRole("button", { name: /Prev/i });
    expect(prevBtn).not.toBeDisabled();
    fireEvent.click(prevBtn);

    await waitFor(() => {
      expect(catalogSpy).toHaveBeenCalledWith(expect.objectContaining({
        page: 1,
      }));
    });
  });

  it("jumps to a requested page and clamps invalid page numbers", async () => {
    const catalogSpy = vi.spyOn(ApiModule.productsService, "catalog").mockResolvedValue(
      mockProductsData
    );

    render(
      <MemoryRouter>
        <Products />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("prod_111")).toBeInTheDocument();
    });

    const pageInput = screen.getByRole("textbox", { name: "Page number" });
    fireEvent.change(pageInput, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Go" }));

    await waitFor(() => {
      expect(catalogSpy).toHaveBeenCalledWith(expect.objectContaining({
        page: 2,
      }));
    });

    fireEvent.change(pageInput, { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: "Go" }));

    await waitFor(() => {
      expect(catalogSpy).toHaveBeenCalledWith(expect.objectContaining({
        page: 2,
      }));
    });
  });

  it("exports products catalog to CSV and handles export failures", async () => {
    vi.spyOn(ApiModule.productsService, "catalog").mockResolvedValue(
      mockProductsData
    );
    const exportSpy = vi.spyOn(ApiModule.productsService, "exportCsv");

    render(
      <MemoryRouter>
        <Products />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("prod_111")).toBeInTheDocument();
    });

    // Successful export
    exportSpy.mockResolvedValueOnce({ data: "product_id,category\nprod_111,health_beauty" });
    const exportBtn = screen.getByRole("button", { name: /Export CSV/i });
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(exportSpy).toHaveBeenCalled();
      expect(window.URL.createObjectURL).toHaveBeenCalled();
      expect(window.URL.revokeObjectURL).toHaveBeenCalled();
    });

    // Failed export
    exportSpy.mockRejectedValueOnce(new Error("Network timeout"));
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("Failed to export products: Network timeout");
    });
  });
});
