import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Assistant from "./Assistant";
import { assistantService } from "../services/api";

describe("Analytics assistant page", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(assistantService, "sessions").mockResolvedValue({
      sessions: [{ id: 1, title: "Test conversation" }],
    });
    vi.spyOn(assistantService, "createSession").mockResolvedValue({
      id: 2,
      title: "New chat",
    });
    vi.spyOn(assistantService, "history").mockResolvedValue({ turns: [] });
    vi.spyOn(assistantService, "deleteSession").mockResolvedValue(undefined);
    vi.spyOn(assistantService, "renameSession").mockImplementation(
      async (id, title) => ({
        id,
        title,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      }),
    );
  });

  it("explains how to configure the assistant when no provider key is set", async () => {
    vi.spyOn(assistantService, "status").mockResolvedValue({
      configured: false,
      model: "openrouter/free",
    });

    render(<Assistant />);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Nova is unavailable.",
    );
    expect(screen.getByRole("heading", { name: "Nova" })).toBeInTheDocument();
    expect(screen.getByText("OPENROUTER_API_KEY")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
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

    const messageInput = await screen.findByRole("textbox", { name: "Message" });
    await waitFor(() => expect(messageInput).toBeEnabled());
    fireEvent.change(messageInput, {
      target: { value: "Which campaigns target the most customers?" },
    });
    const sendButton = screen.getByRole("button", { name: "Send message" });
    await waitFor(() => expect(sendButton).toBeEnabled());
    fireEvent.click(sendButton);

    expect(await screen.findByText("Priority Recovery targets 4,936 customers."))
      .toBeInTheDocument();
    expect(await screen.findByRole("region", {
      name: "Active campaigns by customer reach",
    })).toBeInTheDocument();
    expect(askSpy).toHaveBeenCalledWith(
      "Which campaigns target the most customers?",
      1,
    );
  });

  it("shows a proposed chat action and requires confirmation before saving", async () => {
    vi.spyOn(assistantService, "status").mockResolvedValue({
      configured: true,
      model: "openrouter/free",
    });
    const askSpy = vi.spyOn(assistantService, "ask").mockResolvedValue({
      answer: "I prepared this customer change for your review.",
      visualizations: [],
      action_proposal: {
        id: "pending-1",
        summary: "Create customer customer-123 in Campinas, SP.",
        expires_at: "2026-11-12T10:00:00Z",
      },
    });
    const confirmSpy = vi.spyOn(assistantService, "confirmAction").mockResolvedValue({
      message: "Customer created.",
    });

    render(<Assistant />);
    const input = await screen.findByRole("textbox", { name: "Message" });
    fireEvent.change(input, {
      target: { value: "Create a customer in Campinas, SP with postal code 13010" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByRole("group", { name: "Review Nova's proposed action" }))
      .toBeInTheDocument();
    expect(askSpy).toHaveBeenCalledWith(
      "Create a customer in Campinas, SP with postal code 13010",
      1,
    );
    expect(confirmSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm action" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Customer created.");
    expect(confirmSpy).toHaveBeenCalledWith("pending-1");
  });

  it("clears the proposal when confirmed in chat", async () => {
    vi.spyOn(assistantService, "status").mockResolvedValue({
      configured: true,
      model: "openrouter/free",
    });
    const askSpy = vi.spyOn(assistantService, "ask")
      .mockResolvedValueOnce({
        answer: "I prepared this customer change for your review.",
        visualizations: [],
        action_proposal: {
          id: "pending-2",
          summary: "Delete order order-123 for customer customer-123.",
          expires_at: "2026-11-12T10:00:00Z",
        },
      })
      .mockResolvedValueOnce({
        answer: "1 order(s) and associated records deleted.",
        confirmed_action_id: "pending-2",
      });

    render(<Assistant />);
    const input = await screen.findByRole("textbox", { name: "Message" });
    fireEvent.change(input, { target: { value: "Delete order order-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByRole("group", { name: "Review Nova's proposed action" }))
      .toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Proceed" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("1 order(s) and associated records deleted."))
      .toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Review Nova's proposed action" }))
      .not.toBeInTheDocument();
  });

  it("shows a clear provider error when Nova cannot answer", async () => {
    vi.spyOn(assistantService, "status").mockResolvedValue({
      configured: true,
      model: "openrouter/free",
    });
    const askSpy = vi.spyOn(assistantService, "ask").mockRejectedValue(
      new Error(
        "OpenRouter is rate-limiting this request. The free-model daily quota may be used up.",
      ),
    );

    render(<Assistant />);
    const input = await screen.findByRole("textbox", { name: "Message" });
    const sendButton = screen.getByRole("button", { name: "Send message" });
    fireEvent.change(input, { target: { value: "How are sales trending?" } });
    await waitFor(() => expect(sendButton).toBeEnabled());
    fireEvent.submit(sendButton.closest("form"));

    await waitFor(() => expect(askSpy).toHaveBeenCalledWith(
      "How are sales trending?",
      1,
    ));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The free-model daily quota may be used up.",
    );
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
    const input = await screen.findByRole("textbox", { name: "Message" });
    fireEvent.change(input, { target: { value: "How are sales trending?" } });

    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(askSpy).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    expect(await screen.findByText("Revenue is trending upward.")).toBeInTheDocument();
    expect(askSpy).toHaveBeenCalledWith("How are sales trending?", 1);
  });

  it("loads saved turns and deletes the selected conversation", async () => {
    vi.spyOn(assistantService, "status").mockResolvedValue({
      configured: true,
      model: "openrouter/free",
    });
    vi.spyOn(assistantService, "history").mockImplementation(async (sessionId) => ({
      turns: sessionId === 1
        ? [{
          question: "What happened to revenue?",
          answer: "Revenue increased.",
          visualizations: [],
        }]
        : [],
    }));
    const deleteSpy = vi.spyOn(assistantService, "deleteSession");

    render(<Assistant />);

    expect(await screen.findByText("Revenue increased.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {
      name: "Delete Test conversation",
    }));

    expect(deleteSpy).toHaveBeenCalledWith(1);
    expect(await screen.findByRole("button", {
      name: "Which campaigns target the most customers?",
    })).toBeInTheDocument();
    expect(screen.queryByText("Revenue increased.")).not.toBeInTheDocument();
  });

  it("starts a separate chat and switches between conversation histories", async () => {
    vi.spyOn(assistantService, "status").mockResolvedValue({
      configured: true,
      model: "openrouter/free",
    });
    vi.spyOn(assistantService, "sessions").mockResolvedValue({
      sessions: [
        { id: 1, title: "Revenue conversation" },
        { id: 3, title: "Churn conversation" },
      ],
    });
    const historySpy = vi.spyOn(assistantService, "history").mockImplementation(
      async (sessionId) => ({
        turns: sessionId === 3
          ? [{ question: "How is churn?", answer: "Churn is low.", visualizations: [] }]
          : sessionId === 1
            ? [{ question: "How are sales?", answer: "Sales are steady.", visualizations: [] }]
            : [],
      }),
    );
    const createSpy = vi.spyOn(assistantService, "createSession").mockResolvedValue({
      id: 4,
      title: "New chat",
    });

    render(<Assistant />);

    expect(await screen.findByText("Sales are steady.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Churn conversation" }));
    expect(await screen.findByText("Churn is low.")).toBeInTheDocument();
    expect(screen.queryByText("Sales are steady.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));

    expect(createSpy).toHaveBeenCalled();
    expect(await screen.findByText("What can I help with?")).toBeInTheDocument();
    expect(historySpy).toHaveBeenCalledWith(3);
    await waitFor(() => {
      expect(screen.queryByText("Loading conversation…")).not.toBeInTheDocument();
    });
  });

  it("renames a conversation and saves the updated title", async () => {
    vi.spyOn(assistantService, "status").mockResolvedValue({
      configured: true,
      model: "openrouter/free",
    });
    const renameSpy = vi.spyOn(assistantService, "renameSession");

    render(<Assistant />);
    fireEvent.click(await screen.findByRole("button", {
      name: "Rename Test conversation",
    }));

    const titleInput = screen.getByRole("textbox", { name: "Conversation name" });
    fireEvent.change(titleInput, { target: { value: "Monthly revenue" } });
    fireEvent.click(screen.getByRole("button", { name: "Save conversation name" }));

    expect(renameSpy).toHaveBeenCalledWith(1, "Monthly revenue");
    expect(await screen.findByRole("button", {
      name: "Monthly revenue",
    })).toBeInTheDocument();
  });
});
