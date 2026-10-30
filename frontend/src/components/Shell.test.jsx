import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Shell from "./Shell";
import * as AuthContextModule from "../context/AuthContext";
import * as ThemeContextModule from "../context/ThemeContext";
import { authService } from "../services/api";

vi.mock("../services/api", () => ({
  authService: { profiles: vi.fn() },
}));

describe("Shell Navigation & Layout Component", () => {
  const mockLogout = vi.fn();
  const mockLogoutAll = vi.fn();
  const mockToggleTheme = vi.fn();
  const mockSwitchToAccount = vi.fn();
  const mockLoginAndSwitch = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    authService.profiles.mockResolvedValue([
      { username: "admin", role: "admin" },
      { username: "analyst", role: "viewer" },
      { username: "new_user", role: "viewer" },
    ]);
    vi.spyOn(AuthContextModule, "useAuth").mockReturnValue({
      user: "admin",
      role: "admin",
      accounts: { admin: { username: "admin", role: "admin", access_token: "tok_admin" } },
      isAdmin: true,
      logout: mockLogout,
      logoutAll: mockLogoutAll,
      switchToAccount: mockSwitchToAccount,
      loginAndSwitch: mockLoginAndSwitch,
    });

    vi.spyOn(ThemeContextModule, "useTheme").mockReturnValue({
      theme: "light",
      isDark: false,
      toggleTheme: mockToggleTheme,
    });
  });

  it("renders workspace branding and main navigation links", () => {
    render(
      <MemoryRouter>
        <Shell />
      </MemoryRouter>
    );

    expect(screen.getByTitle("Customer Sphere")).toBeInTheDocument();
    expect(screen.getByText("Customer")).toBeInTheDocument();
    expect(screen.getByText("Sphere")).toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Customers")).toBeInTheDocument();
    expect(screen.getByText("Products")).toBeInTheDocument();
    expect(screen.getByText("Analytics")).toBeInTheDocument();
    expect(screen.getByText("Campaigns")).toBeInTheDocument();
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Users/i })).toHaveAttribute("href", "/users");
  });

  it("hides user management navigation from viewers", () => {
    vi.spyOn(AuthContextModule, "useAuth").mockReturnValue({
      user: "analyst",
      role: "viewer",
      accounts: {},
      isAdmin: false,
      logout: mockLogout,
      logoutAll: mockLogoutAll,
      switchToAccount: mockSwitchToAccount,
      loginAndSwitch: mockLoginAndSwitch,
    });

    render(
      <MemoryRouter>
        <Shell />
      </MemoryRouter>
    );

    expect(screen.queryByRole("link", { name: /Users/i })).not.toBeInTheDocument();
  });

  it("hides analytics, campaigns, and model navigation from viewers", () => {
    vi.spyOn(AuthContextModule, "useAuth").mockReturnValue({
      user: "analyst",
      role: "viewer",
      accounts: {},
      isAdmin: false,
      logout: mockLogout,
      logoutAll: mockLogoutAll,
      switchToAccount: mockSwitchToAccount,
      loginAndSwitch: mockLoginAndSwitch,
    });

    render(
      <MemoryRouter>
        <Shell />
      </MemoryRouter>
    );

    expect(screen.queryByRole("link", { name: "Analytics" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Campaigns" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Model diagnostics" })).not.toBeInTheDocument();
  });

  it("shows only the pages granted to a viewer", () => {
    vi.spyOn(AuthContextModule, "useAuth").mockReturnValue({
      user: "scoped_viewer",
      role: "viewer",
      accounts: {},
      isAdmin: false,
      hasAccess: (page) => ["dashboard", "analytics"].includes(page),
      logout: mockLogout,
      logoutAll: mockLogoutAll,
      switchToAccount: mockSwitchToAccount,
      loginAndSwitch: mockLoginAndSwitch,
    });

    render(
      <MemoryRouter>
        <Shell />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Analytics" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Customers" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Products" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Admin Activity/i })).not.toBeInTheDocument();
  });

  it("displays logged-in user profile badge and role indicator", () => {
    render(
      <MemoryRouter>
        <Shell />
      </MemoryRouter>
    );

    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByText("Administrator")).toBeInTheDocument();
  });

  it("toggles light/dark theme on button click", () => {
    render(
      <MemoryRouter>
        <Shell />
      </MemoryRouter>
    );

    const themeToggleBtn = screen.getByTitle(/switch to dark mode/i);
    fireEvent.click(themeToggleBtn);

    expect(mockToggleTheme).toHaveBeenCalledTimes(1);
  });

  it("keeps the mode button visible and usable when the sidebar is collapsed", () => {
    localStorage.setItem("sidebar_collapsed", "true");

    render(
      <MemoryRouter>
        <Shell />
      </MemoryRouter>
    );

    const themeToggleBtn = screen.getByTitle(/switch to dark mode/i);
    expect(themeToggleBtn.querySelector("svg")).toBeInTheDocument();

    fireEvent.click(themeToggleBtn);
    expect(mockToggleTheme).toHaveBeenCalledTimes(1);
  });

  it("opens and closes AuditLogModal when clicking Activity Logs button", () => {
    render(
      <MemoryRouter>
        <Shell />
      </MemoryRouter>
    );

    const logsBtn = screen.getByRole("button", { name: /admin activity/i });
    fireEvent.click(logsBtn);

    expect(screen.getByText(/Admin Data Activity Log/i)).toBeInTheDocument();

    // Close modal
    const closeBtn = document.querySelector(".modalBg button.close");
    fireEvent.click(closeBtn);
    expect(screen.queryByText(/Admin Data Activity Log/i)).not.toBeInTheDocument();
  });

  it("asks for confirmation before signing out all profiles", () => {
    render(
      <MemoryRouter>
        <Shell />
      </MemoryRouter>
    );

    const logoutBtn = screen.getByTitle("Sign out");
    fireEvent.click(logoutBtn);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("This will sign out all active profiles on this device.")).toBeInTheDocument();
    expect(mockLogoutAll).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockLogoutAll).not.toHaveBeenCalled();

    fireEvent.click(logoutBtn);
    const signOutDialog = screen.getByRole("dialog");
    fireEvent.click(within(signOutDialog).getByRole("button", { name: "Sign out" }));
    expect(mockLogoutAll).toHaveBeenCalledTimes(1);
  });

  it("toggles sidebar minimize and expand state", () => {
    render(
      <MemoryRouter>
        <Shell />
      </MemoryRouter>
    );

    const toggleBtn = screen.getByTitle("Minimize sidebar");
    fireEvent.click(toggleBtn);

    expect(screen.getByTitle("Expand sidebar")).toBeInTheDocument();
    expect(document.querySelector("main")).toHaveClass("expanded");
  });

  it("switches directly to an already authenticated session", async () => {
    vi.spyOn(AuthContextModule, "useAuth").mockReturnValue({
      user: "admin",
      role: "admin",
      accounts: {
        admin: { username: "admin", role: "admin", access_token: "tok_admin" },
        analyst: { username: "analyst", role: "analyst", access_token: "tok_analyst" },
      },
      isAdmin: true,
      logout: mockLogout,
      logoutAll: mockLogoutAll,
      switchToAccount: mockSwitchToAccount,
      loginAndSwitch: mockLoginAndSwitch,
    });

    render(
      <MemoryRouter>
        <Shell />
      </MemoryRouter>
    );

    await screen.findByRole("option", { name: /analyst — Viewer/i });
    fireEvent.change(screen.getByRole("combobox", { name: "Switch profile" }), {
      target: { value: "analyst" },
    });

    expect(mockSwitchToAccount).toHaveBeenCalledWith("analyst");
  });

  it("hides the placeholder option when the sidebar is minimized", async () => {
    localStorage.setItem("sidebar_collapsed", "true");

    render(
      <MemoryRouter>
        <Shell />
      </MemoryRouter>
    );

    await screen.findByRole("option", { name: /analyst — Viewer/i });
    const placeholder = document.querySelector(
      'select[aria-label="Switch profile"] option[value=""]',
    );
    expect(placeholder).not.toBeNull();
    expect(placeholder).toHaveAttribute("hidden");
  });

  it("opens login modal for unauthenticated account and authenticates successfully", async () => {
    mockLoginAndSwitch.mockResolvedValueOnce({});

    render(
      <MemoryRouter>
        <Shell />
      </MemoryRouter>
    );

    await screen.findByRole("option", { name: /analyst — Viewer/i });
    fireEvent.change(screen.getByRole("combobox", { name: "Switch profile" }), {
      target: { value: "analyst" },
    });

    expect(screen.getByRole("heading", { name: /sign in as viewer/i })).toBeInTheDocument();

    const passwordInput = screen.getByPlaceholderText(/Enter password for analyst/i);
    fireEvent.change(passwordInput, { target: { value: "pass123" } });

    fireEvent.submit(document.querySelector("form.modal"));

    await waitFor(() => {
      expect(mockLoginAndSwitch).toHaveBeenCalledWith({
        username: "analyst",
        password: "pass123",
      });
    });
  });

  it("shows login error message when switch authentication fails", async () => {
    mockLoginAndSwitch.mockRejectedValueOnce(new Error("Invalid analyst credentials"));

    render(
      <MemoryRouter>
        <Shell />
      </MemoryRouter>
    );

    await screen.findByRole("option", { name: /analyst — Viewer/i });
    fireEvent.change(screen.getByRole("combobox", { name: "Switch profile" }), {
      target: { value: "analyst" },
    });

    const passwordInput = screen.getByPlaceholderText(/Enter password for analyst/i);
    fireEvent.change(passwordInput, { target: { value: "wrongpass" } });

    fireEvent.submit(document.querySelector("form.modal"));

    await waitFor(() => {
      expect(screen.getByText("Invalid analyst credentials")).toBeInTheDocument();
    });

    // Close modal via Cancel button
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: /sign in as viewer/i })).not.toBeInTheDocument();
  });

  it("keeps the profile selector available when the sidebar is collapsed", async () => {
    render(
      <MemoryRouter>
        <Shell />
      </MemoryRouter>
    );

    // Minimize sidebar
    fireEvent.click(screen.getByTitle("Minimize sidebar"));

    const selector = screen.getByRole("combobox", { name: "Switch profile" });
    expect(selector).toBeInTheDocument();
    await screen.findByRole("option", { name: /new_user — Viewer/i });
    fireEvent.change(selector, { target: { value: "new_user" } });
    expect(screen.getByRole("heading", { name: /sign in as viewer/i })).toBeInTheDocument();
  });

  it("shows all available user accounts in the profile dropdown", async () => {
    render(
      <MemoryRouter>
        <Shell />
      </MemoryRouter>
    );

    expect(await screen.findByRole("option", { name: /new_user — Viewer/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /admin — Administrator/i })).toBeInTheDocument();
  });
});
