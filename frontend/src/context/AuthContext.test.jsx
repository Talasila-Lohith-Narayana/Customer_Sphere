import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { AuthProvider, useAuth } from "./AuthContext";
import { authService } from "../services/api";

vi.mock("../services/api", () => ({
  authService: {
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue({ logged_out: true }),
    validateSession: vi.fn().mockResolvedValue({ valid: true }),
  },
}));

let latestAuth = null;

function TestConsumer() {
  const auth = useAuth();
  latestAuth = auth;
  return (
    <div>
      <span data-testid="user">{auth.user || "guest"}</span>
      <span data-testid="role">{auth.role || "none"}</span>
      <span data-testid="isAdmin">{auth.isAdmin ? "yes" : "no"}</span>
      <span data-testid="isAuth">{auth.isAuthenticated ? "yes" : "no"}</span>
      <button
        onClick={() =>
          auth.login({
            username: "admin_user",
            role: "admin",
          })
        }
      >
        Login Admin
      </button>
      <button
        onClick={() =>
          auth.login({
            username: "analyst_user",
            role: "viewer",
          })
        }
      >
        Login Analyst
      </button>
      <button onClick={() => auth.logout()}>Logout Current</button>
      <button onClick={() => auth.logoutAll()}>Logout All</button>
      <button
        onClick={() =>
          auth.updateAccountAccess("analyst_user", ["dashboard", "analytics"])
        }
      >
        Update Analyst Access
      </button>
      <button
        onClick={() =>
          auth.updateCurrentSession({
            username: "renamed_admin",
            role: "admin",
          })
        }
      >
        Update Current Account
      </button>
    </div>
  );
}

describe("AuthContext and AuthProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    latestAuth = null;
  });

  it("provides initial default unauthenticated state", () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    expect(screen.getByTestId("user").textContent).toBe("guest");
    expect(screen.getByTestId("role").textContent).toBe("viewer");
    expect(screen.getByTestId("isAdmin").textContent).toBe("no");
    expect(screen.getByTestId("isAuth").textContent).toBe("no");
  });

  it("removes legacy cached credentials and profile data on startup", () => {
    localStorage.setItem("ci_token", "legacy-token");
    localStorage.setItem("ci_accounts", "not-valid-json{{{");
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    expect(screen.getByTestId("user").textContent).toBe("guest");
    expect(localStorage.getItem("ci_token")).toBeNull();
    expect(localStorage.getItem("ci_accounts")).toBeNull();
  });

  it("stores user session on login and calculates isAdmin correctly", () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    act(() => {
      screen.getByText("Login Admin").click();
    });

    expect(screen.getByTestId("user").textContent).toBe("admin_user");
    expect(screen.getByTestId("role").textContent).toBe("admin");
    expect(screen.getByTestId("isAdmin").textContent).toBe("yes");
    expect(screen.getByTestId("isAuth").textContent).toBe("yes");

    expect(localStorage.getItem("ci_token")).toBeNull();
    expect(localStorage.getItem("ci_user")).toBe("admin_user");
    expect(localStorage.getItem("ci_role")).toBe("admin");
  });

  it("updates the active username without persisting credentials", () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    act(() => {
      screen.getByText("Login Admin").click();
    });
    act(() => {
      screen.getByText("Update Current Account").click();
    });

    expect(screen.getByTestId("user").textContent).toBe("renamed_admin");
    expect(localStorage.getItem("ci_user")).toBe("renamed_admin");
    expect(localStorage.getItem("ci_token")).toBeNull();
    expect(localStorage.getItem("ci_accounts")).toBeNull();
    expect(screen.getByTestId("isAdmin").textContent).toBe("yes");
    expect(screen.getByTestId("isAuth").textContent).toBe("yes");
  });

  it("updates the active account permissions without caching credentials", () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    act(() => {
      screen.getByText("Login Analyst").click();
    });
    act(() => {
      screen.getByText("Update Analyst Access").click();
    });

    expect(JSON.parse(localStorage.getItem("ci_access_pages")))
      .toEqual(["dashboard", "analytics"]);
    expect(latestAuth.hasAccess("analytics")).toBe(true);
  });

  it("does not logout when usernameToLogout does not match current user", () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    act(() => {
      screen.getByText("Login Admin").click();
    });

    act(() => {
      latestAuth.logout("other_user");
    });

    // Session remains intact
    expect(screen.getByTestId("user").textContent).toBe("admin_user");
    expect(screen.getByTestId("isAuth").textContent).toBe("yes");
  });

  it("clears current session on logout", async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    act(() => {
      screen.getByText("Login Admin").click();
    });
    expect(screen.getByTestId("isAuth").textContent).toBe("yes");

    await act(async () => {
      await latestAuth.logout();
    });

    expect(screen.getByTestId("user").textContent).toBe("guest");
    expect(screen.getByTestId("isAuth").textContent).toBe("no");
    expect(localStorage.getItem("ci_token")).toBeNull();
  });

  it("clears a session when the API reports that its cookie was rejected", () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    act(() => {
      screen.getByText("Login Admin").click();
    });
    act(() => {
      window.dispatchEvent(
        new CustomEvent("auth-session-invalid", {
          detail: { username: "admin_user" },
        }),
      );
    });

    expect(screen.getByTestId("user").textContent).toBe("guest");
    expect(screen.getByTestId("isAuth").textContent).toBe("no");
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "Your credentials or page access were changed",
    );
    expect(localStorage.getItem("ci_token")).toBeNull();
    expect(localStorage.getItem("ci_accounts")).toBeNull();
  });

  it("clears and notifies the active session when another tab revokes it", () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    act(() => {
      screen.getByText("Login Admin").click();
    });

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "ci_session_revoked",
          newValue: JSON.stringify({ username: "admin_user", nonce: "test" }),
        }),
      );
    });

    expect(screen.getByTestId("user").textContent).toBe("guest");
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Please sign in again");
    expect(localStorage.getItem("ci_token")).toBeNull();
  });

  it("periodically validates an authenticated session while the tab is visible", async () => {
    vi.useFakeTimers();
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    act(() => {
      screen.getByText("Login Admin").click();
    });
    authService.validateSession.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });

    expect(authService.validateSession).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("clears the browser session on logoutAll", async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    act(() => {
      screen.getByText("Login Admin").click();
    });
    await act(async () => {
      await latestAuth.logoutAll();
    });

    expect(screen.getByTestId("isAuth").textContent).toBe("no");
    expect(localStorage.getItem("ci_accounts")).toBeNull();
  });

  describe("loginAndSwitch", () => {
    it("successfully logs in via API and switches account", async () => {
      const mockSession = {
        username: "api_admin",
        role: "admin",
      };

      authService.login.mockResolvedValue(mockSession);

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );

      let returnedSession;
      await act(async () => {
        returnedSession = await latestAuth.loginAndSwitch({
          username: "api_admin",
          password: "password123",
        });
      });

      expect(returnedSession).toEqual(mockSession);
      expect(screen.getByTestId("user").textContent).toBe("api_admin");
      expect(screen.getByTestId("isAdmin").textContent).toBe("yes");
    });

    it("throws detailed error when login fails with error response detail", async () => {
      authService.login.mockRejectedValue(new Error("Invalid password provided"));

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );

      await expect(
        latestAuth.loginAndSwitch({
          username: "api_admin",
          password: "wrong_password",
        })
      ).rejects.toThrow("Invalid password provided");
    });

    it("throws default error message when login fails without error detail", async () => {
      authService.login.mockRejectedValue(new Error("Authentication failed. Invalid username or password."));

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );

      await expect(
        latestAuth.loginAndSwitch({
          username: "api_admin",
          password: "wrong_password",
        })
      ).rejects.toThrow("Authentication failed. Invalid username or password.");
    });
  });
});
