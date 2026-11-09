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
      model: "gpt-4o-mini",
    });

    render(<Assistant />);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "The assistant is not configured yet.",
    );
    expect(screen.getByText("OPENAI_API_KEY")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
  });

  it("submits a question and displays the aggregate-data answer", async () => {
    vi.spyOn(assistantService, "status").mockResolvedValue({
      configured: true,
      model: "gpt-4o-mini",
    });
    const askSpy = vi.spyOn(assistantService, "ask").mockResolvedValue({
      answer: "Priority Recovery targets 4,936 customers.",
    });

    render(<Assistant />);

    fireEvent.click(await screen.findByRole("button", {
      name: "Which campaigns target the most customers?",
    }));
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(await screen.findByText("Priority Recovery targets 4,936 customers."))
      .toBeInTheDocument();
    expect(askSpy).toHaveBeenCalledWith("Which campaigns target the most customers?");
  });
});
