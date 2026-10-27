import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CustomerModal from "./CustomerModal";

describe("CustomerModal Component", () => {
  const mockCustomer = {
    customer_unique_id: "uid_abcdef12345",
    customer_zip_code_prefix: "13010",
    customer_city: "Campinas",
    customer_state: "SP",
  };

  it("pre-fills form inputs in edit mode", () => {
    render(<CustomerModal customer={mockCustomer} close={vi.fn()} save={vi.fn()} />);

    expect(screen.getByDisplayValue("uid_abcdef12345")).toBeInTheDocument();
    expect(screen.getByDisplayValue("13010")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Campinas")).toBeInTheDocument();
    expect(screen.getByDisplayValue("SP")).toBeInTheDocument();
  });

  it("validates empty customer unique ID", () => {
    render(<CustomerModal customer={null} close={vi.fn()} save={vi.fn()} />);

    const submitBtn = screen.getByRole("button", { name: /add customer/i });
    fireEvent.click(submitBtn);

    expect(
      screen.getByText("Please provide a valid Customer Unique ID (hash).")
    ).toBeInTheDocument();
  });

  it("generates a random ID and retries when it already exists", async () => {
    const checkIdAvailable = vi.fn()
      .mockResolvedValueOnce({ available: false })
      .mockResolvedValueOnce({ available: true });
    let randomByte = 0;
    vi.spyOn(window.crypto, "getRandomValues").mockImplementation((bytes) => {
      bytes.fill(randomByte);
      randomByte += 1;
      return bytes;
    });

    render(
      <CustomerModal
        customer={null}
        close={vi.fn()}
        save={vi.fn()}
        checkIdAvailable={checkIdAvailable}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate random ID" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Customer Unique ID")).toHaveValue("01".repeat(16));
    });
    expect(checkIdAvailable).toHaveBeenNthCalledWith(1, "00".repeat(16));
    expect(checkIdAvailable).toHaveBeenNthCalledWith(2, "01".repeat(16));
  });

  it("shows an error when random ID generation fails", async () => {
    const checkIdAvailable = vi.fn().mockResolvedValue({ available: false });
    vi.spyOn(window.crypto, "getRandomValues").mockImplementation((bytes) => {
      bytes.fill(0);
      return bytes;
    });

    render(
      <CustomerModal
        customer={null}
        close={vi.fn()}
        save={vi.fn()}
        checkIdAvailable={checkIdAvailable}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate random ID" }));

    expect(
      await screen.findByText("Could not generate an unused ID. Please try again.")
    ).toBeInTheDocument();
    expect(checkIdAvailable).toHaveBeenCalledTimes(5);
  });

  it("validates zip code, city, and state code errors", () => {
    const { container } = render(<CustomerModal customer={null} close={vi.fn()} save={vi.fn()} />);

    // Provide UID
    fireEvent.change(screen.getByPlaceholderText(/00172711b30d52eea8b313a7f2cced02/i), {
      target: { value: "uid_new_123" },
    });

    // Empty zip
    const form = container.querySelector("form.modal");

    // Empty zip
    fireEvent.submit(form);
    expect(screen.getByText(/Please enter a valid numeric ZIP code/i)).toBeInTheDocument();

    // Out-of-bounds zip
    fireEvent.change(screen.getByLabelText(/ZIP code/i), { target: { value: "1000000" } });
    fireEvent.submit(form);
    expect(screen.getByText(/Please enter a valid numeric ZIP code/i)).toBeInTheDocument();

    // Valid zip, missing city
    fireEvent.change(screen.getByLabelText(/ZIP code/i), { target: { value: "13010" } });
    fireEvent.submit(form);
    expect(screen.getByText(/Please enter the customer's city name/i)).toBeInTheDocument();

    // Valid city, invalid state
    fireEvent.change(screen.getByLabelText(/City/i), { target: { value: "Campinas" } });
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. SP/i), { target: { value: "XX" } });
    fireEvent.submit(form);
    expect(screen.getByText(/"XX" is not a valid 2-letter Brazilian state code/i)).toBeInTheDocument();
  });

  it("submits valid customer data without a manually assigned risk segment", async () => {
    const mockSave = vi.fn().mockResolvedValue({});
    const mockClose = vi.fn();

    render(<CustomerModal customer={mockCustomer} close={mockClose} save={mockSave} />);

    fireEvent.change(screen.getByLabelText(/ZIP code/i), {
      target: { value: "01000" },
    });

    const submitBtn = screen.getByRole("button", { name: /save changes/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith({
        customer_unique_id: "uid_abcdef12345",
        customer_zip_code_prefix: "01000",
        customer_city: "Campinas",
        customer_state: "SP",
      });
    });
  });

  it("handles save rejection and displays error", async () => {
    const mockSave = vi.fn().mockRejectedValue(new Error("Customer ID already exists"));

    render(<CustomerModal customer={mockCustomer} close={vi.fn()} save={mockSave} />);

    const submitBtn = screen.getByRole("button", { name: /save changes/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText("Customer ID already exists")).toBeInTheDocument();
    });
  });

  it("calls close handler when clicking close icon or cancel button", () => {
    const mockClose = vi.fn();
    const { container, rerender } = render(
      <CustomerModal customer={mockCustomer} close={mockClose} save={vi.fn()} />
    );

    const closeBtn = container.querySelector("button.close");
    fireEvent.click(closeBtn);
    expect(mockClose).toHaveBeenCalledTimes(1);

    rerender(
      <CustomerModal customer={mockCustomer} close={mockClose} save={vi.fn()} />
    );
    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelBtn);
    expect(mockClose).toHaveBeenCalledTimes(2);
  });
});
