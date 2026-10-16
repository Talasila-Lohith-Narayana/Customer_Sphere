import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Users from "./Users";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { userService } from "../services/api";

vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../context/ToastContext", () => ({ useToast: vi.fn() }));
vi.mock("../services/api", () => ({
  userService: { list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
}));

describe("User management page", () => {
  const toast = { success: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ isAdmin: true, user: "admin" });
    useToast.mockReturnValue(toast);
    userService.list.mockResolvedValue([
      { username: "admin", role: "admin" },
      { username: "analyst", role: "viewer" },
    ]);
  });

  it("shows account roles and creates a user", async () => {
    userService.create.mockResolvedValue({
      username: "new_user",
      role: "viewer",
      access_pages: ["dashboard", "customers"],
    });

    render(
      <MemoryRouter>
        <Users />
      </MemoryRouter>
    );

    expect(await screen.findByText("analyst")).toBeInTheDocument();
    expect(screen.getByText("Administrator")).toBeInTheDocument();
    expect(screen.getByText("Viewer")).toBeInTheDocument();
    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Create user" }));
    expect(screen.getByRole("tabpanel", { name: "Create user" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "new_user" },
    });
    fireEvent.change(screen.getByLabelText(/Temporary password/), {
      target: { value: "safe-password" },
    });
    fireEvent.click(screen.getByLabelText("Dashboard"));
    fireEvent.click(screen.getByLabelText("Customers"));
    fireEvent.submit(
      screen.getByRole("button", { name: /create user/i }).closest("form"),
    );

    await waitFor(() => {
      expect(userService.create).toHaveBeenCalledWith({
        username: "new_user",
        password: "safe-password",
        role: "viewer",
        access_pages: ["dashboard", "customers"],
      });
    });
    expect(screen.getByRole("tab", { name: "View & edit users" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByText("new_user")).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('User "new_user" can now sign in.');
  });

  it("lets an administrator create a full-access account", async () => {
    userService.create.mockResolvedValue({
      username: "new_admin",
      role: "admin",
      access_pages: ["dashboard", "customers", "products", "analytics", "campaigns", "model", "audit_logs"],
    });

    render(
      <MemoryRouter>
        <Users />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("tab", { name: "Create user" }));
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "new_admin" } });
    fireEvent.change(screen.getByLabelText(/Temporary password/), {
      target: { value: "safe-password" },
    });
    fireEvent.click(screen.getByLabelText("Administrator — full access to all pages and actions"));
    fireEvent.submit(screen.getByRole("button", { name: /create user/i }).closest("form"));

    await waitFor(() => {
      expect(userService.create).toHaveBeenCalledWith({
        username: "new_admin",
        password: "safe-password",
        role: "admin",
        access_pages: [],
      });
    });
  });

  it("requires at least one page for a viewer account", async () => {
    render(
      <MemoryRouter>
        <Users />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("tab", { name: "Create user" }));
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "no_access" } });
    fireEvent.change(screen.getByLabelText(/Temporary password/), {
      target: { value: "safe-password" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /create user/i }).closest("form"));

    expect(userService.create).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Select at least one page for this user.");
  });

  it("redirects non-admin users away from user management", () => {
    useAuth.mockReturnValue({ isAdmin: false });

    render(
      <MemoryRouter initialEntries={["/users"]}>
        <Users />
      </MemoryRouter>
    );

    expect(screen.queryByText("User management")).not.toBeInTheDocument();
  });

  it("updates an existing account username and optional password", async () => {
    userService.update.mockResolvedValue({
      username: "renamed_analyst",
      role: "viewer",
      access_pages: ["dashboard", "customers", "products", "audit_logs"],
      sessions_revoked: true,
    });
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const logout = vi.fn();
    useAuth.mockReturnValue({
      isAdmin: true,
      user: "admin",
      updateCurrentSession: vi.fn(),
      logout,
    });

    render(
      <MemoryRouter>
        <Users />
      </MemoryRouter>
    );

    await screen.findByText("analyst");
    fireEvent.click(screen.getByRole("button", { name: "Edit analyst" }));
    const editDialog = screen.getByRole("dialog", { name: "Edit analyst" });
    fireEvent.change(within(editDialog).getByLabelText("Username"), {
      target: { value: "renamed_analyst" },
    });
    fireEvent.change(within(editDialog).getByLabelText(/New password/), {
      target: { value: "replacement-password" },
    });
    fireEvent.submit(within(editDialog).getByRole("button", { name: /save changes/i }).closest("form"));

    await waitFor(() => {
      expect(userService.update).toHaveBeenCalledWith("analyst", {
        username: "renamed_analyst",
        password: "replacement-password",
        access_pages: ["dashboard", "customers", "products", "audit_logs"],
      });
    });
    expect(await screen.findByText("renamed_analyst")).toBeInTheDocument();
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "auth-session-revoked",
        detail: expect.objectContaining({ username: "analyst" }),
      }),
    );
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "auth-session-revoked",
        detail: expect.objectContaining({ username: "renamed_analyst" }),
      }),
    );
    expect(logout).not.toHaveBeenCalled();
    dispatchSpy.mockRestore();
    expect(toast.success).toHaveBeenCalledWith('User "renamed_analyst" updated.');
  });

  it("logs out the current administrator when they change their password", async () => {
    userService.list.mockResolvedValue([
      { username: "admin", role: "admin", access_pages: [] },
      {
        username: "analyst",
        role: "viewer",
        access_pages: ["dashboard", "customers", "products", "audit_logs"],
      },
    ]);
    userService.update.mockResolvedValue({
      username: "admin",
      role: "admin",
      access_pages: ["dashboard", "customers", "products", "analytics", "campaigns", "model", "audit_logs"],
      sessions_revoked: true,
    });
    const logout = vi.fn();
    const updateCurrentSession = vi.fn();
    useAuth.mockReturnValue({
      isAdmin: true,
      user: "admin",
      logout,
      updateCurrentSession,
    });

    render(
      <MemoryRouter>
        <Users />
      </MemoryRouter>
    );

    await screen.findByText("admin");
    fireEvent.click(screen.getByRole("button", { name: "Edit admin" }));
    const editDialog = screen.getByRole("dialog", { name: "Edit admin" });
    fireEvent.change(within(editDialog).getByLabelText("Username"), {
      target: { value: "admin" },
    });
    fireEvent.change(within(editDialog).getByLabelText(/New password/), {
      target: { value: "replacement-password" },
    });
    fireEvent.submit(
      within(editDialog).getByRole("button", { name: /save changes/i }).closest("form"),
    );

    await waitFor(() => {
      expect(localStorage.getItem("ci_session_revoked")).toContain('"username":"admin"');
    });
    expect(logout).not.toHaveBeenCalled();
    expect(updateCurrentSession).not.toHaveBeenCalled();
  });

  it("edits a viewer's page permissions", async () => {
    userService.list.mockResolvedValue([
      { username: "admin", role: "admin", access_pages: [] },
      {
        username: "analyst",
        role: "viewer",
        access_pages: ["dashboard", "customers", "products", "audit_logs"],
      },
    ]);
    userService.update.mockResolvedValue({
      username: "analyst",
      role: "viewer",
      access_pages: ["dashboard", "analytics"],
      sessions_revoked: true,
    });
    const updateAccountAccess = vi.fn();
    useAuth.mockReturnValue({
      isAdmin: true,
      user: "admin",
      updateAccountAccess,
    });

    render(
      <MemoryRouter>
        <Users />
      </MemoryRouter>
    );

    await screen.findByText("analyst");
    fireEvent.click(screen.getByRole("button", { name: "Edit analyst" }));
    const editDialog = screen.getByRole("dialog", { name: "Edit analyst" });
    fireEvent.click(within(editDialog).getByLabelText("Analytics"));
    fireEvent.click(within(editDialog).getByLabelText("Customers"));
    fireEvent.click(within(editDialog).getByLabelText("Products"));
    fireEvent.click(within(editDialog).getByLabelText("Admin activity"));
    fireEvent.submit(
      within(editDialog).getByRole("button", { name: /save changes/i }).closest("form"),
    );

    await waitFor(() => {
      expect(userService.update).toHaveBeenCalledWith("analyst", {
        username: "analyst",
        access_pages: ["dashboard", "analytics"],
      });
    });
    expect(localStorage.getItem("ci_session_revoked")).toContain('"username":"analyst"');
    expect(updateAccountAccess).not.toHaveBeenCalled();
    expect(await screen.findByText("Dashboard, Analytics")).toBeInTheDocument();
  });

  it("requires confirmation before deleting an account and refreshes the user list", async () => {
    userService.delete.mockResolvedValue({ username: "analyst", role: "viewer" });

    render(
      <MemoryRouter>
        <Users />
      </MemoryRouter>
    );

    await screen.findByText("analyst");
    fireEvent.click(screen.getByRole("button", { name: "Delete analyst" }));
    expect(screen.getByRole("dialog", { name: "Delete user?" })).toBeInTheDocument();
    expect(screen.queryByText(/password changes do not terminate sessions/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete user" }));

    await waitFor(() => {
      expect(userService.delete).toHaveBeenCalledWith("analyst");
    });
    expect(screen.queryByText("analyst")).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('User "analyst" deleted.');
  });

  it("prevents deleting the active account and the last administrator", async () => {
    userService.list.mockResolvedValue([
      { username: "admin", role: "admin" },
      { username: "analyst", role: "viewer" },
    ]);

    render(
      <MemoryRouter>
        <Users />
      </MemoryRouter>
    );

    await screen.findByText("analyst");

    expect(screen.getByRole("button", { name: "Delete admin" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete analyst" })).toBeEnabled();
  });
});
