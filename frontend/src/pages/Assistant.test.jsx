import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Assistant from "./Assistant";
import { assistantService } from "../services/api";

describe("Analytics assistant page", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("explains how to configure the assistant when no provider key is set", async () => {
    vi.spyOn(assistantService, "status").mockResolvedValue({
      configured: false,
      model: "openrouter/free",
    });

    render(<Assistant />);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "The assistant is not configured yet.",
    );
    expect(screen.getByText("OPENROUTER_API_KEY")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
  });

  it("submits a question and displays the aggregate-data answer", async () => {
    vi.spyOn(assistantService, "status").mockResolvedValue({
      configured: true,
      model: "openrouter/free",
    });
    const askSpy = vi.spyOn(assistantService, "ask").mockResolvedValue({
      answer: "Priority Recovery targets 4,936 customers.",
      visualizations: [{
        title: "Active campaigns by customer reach",
        format: "number",
        data: [{ label: "Priority Recovery", value: 4936 }],
      }],
    });

    render(<Assistant />);

    fireEvent.click(await screen.findByRole("button", {
      name: "Which campaigns target the most customers?",
    }));
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(await screen.findByText("Priority Recovery targets 4,936 customers."))
      .toBeInTheDocument();
    expect(await screen.findByRole("region", {
      name: "Active campaigns by customer reach",
    })).toBeInTheDocument();
    expect(askSpy).toHaveBeenCalledWith("Which campaigns target the most customers?");
  });

  it("sends on Enter and preserves Shift+Enter for a newline", async () => {
    vi.spyOn(assistantService, "status").mockResolvedValue({
      configured: true,
      model: "openrouter/free",
    });
    const askSpy = vi.spyOn(assistantService, "ask").mockResolvedValue({
      answer: "Revenue is trending upward.",
      visualizations: [],
    });

    render(<Assistant />);
    const input = await screen.findByRole("textbox", { name: "Your question" });
    fireEvent.change(input, { target: { value: "How are sales trending?" } });

    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(askSpy).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    expect(await screen.findByText("Revenue is trending upward.")).toBeInTheDocument();
    expect(askSpy).toHaveBeenCalledWith("How are sales trending?");
  });
});
