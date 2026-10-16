import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { AuthProvider, useAuth } from "./AuthContext";

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
            access_token: "jwt_123",
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
            access_token: "jwt_456",
            role: "viewer",
          })
        }
      >
        Login Analyst
      </button>
      <button onClick={() => auth.logout()}>Logout Current</button>
      <button onClick={() => auth.logoutAll()}>Logout All</button>
      <button onClick={() => auth.switchToAccount("admin_user")}>
        Switch To Admin
      </button>
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
            access_token: "jwt_renamed",
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

  it("handles corrupted ci_accounts JSON gracefully in initial state", () => {
    localStorage.setItem("ci_accounts", "not-valid-json{{{");
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    expect(screen.getByTestId("user").textContent).toBe("guest");
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

    expect(localStorage.getItem("ci_token")).toBe("jwt_123");
    expect(localStorage.getItem("ci_user")).toBe("admin_user");
    expect(localStorage.getItem("ci_role")).toBe("admin");
  });

  it("updates the active username and refreshed access token", () => {
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
    expect(localStorage.getItem("ci_token")).toBe("jwt_renamed");
    expect(JSON.parse(localStorage.getItem("ci_accounts"))).toEqual({
      renamed_admin: {
        username: "renamed_admin",
        role: "admin",
        access_token: "jwt_renamed",
        access_pages: ["dashboard", "customers", "products", "analytics", "campaigns", "model", "audit_logs"],
      },
    });
    expect(screen.getByTestId("isAdmin").textContent).toBe("yes");
    expect(screen.getByTestId("isAuth").textContent).toBe("yes");
  });

  it("switches to another active account successfully", () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    // Login admin first
    act(() => {
      screen.getByText("Login Admin").click();
    });
    // Then login analyst
    act(() => {
      screen.getByText("Login Analyst").click();
    });

    expect(screen.getByTestId("user").textContent).toBe("analyst_user");
    expect(screen.getByTestId("isAdmin").textContent).toBe("no");

    // Switch back to admin
    act(() => {
      screen.getByText("Switch To Admin").click();
    });

    expect(screen.getByTestId("user").textContent).toBe("admin_user");
    expect(screen.getByTestId("isAdmin").textContent).toBe("yes");
  });

  it("uses updated page permissions when switching to a cached account", () => {
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

    expect(JSON.parse(localStorage.getItem("ci_accounts")).analyst_user.access_pages)
      .toEqual(["dashboard", "analytics"]);
    expect(latestAuth.hasAccess("analytics")).toBe(true);

    act(() => {
      screen.getByText("Login Admin").click();
    });
    act(() => {
      latestAuth.switchToAccount("analyst_user");
    });

    expect(latestAuth.hasAccess("analytics")).toBe(true);
  });

  it("throws an error when switching to an account that is not logged in", () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    expect(() => {
      latestAuth.switchToAccount("nonexistent_user");
    }).toThrow("Account nonexistent_user is not logged in.");
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

  it("removes a specific cached account without disturbing the active session", () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    act(() => {
      screen.getByText("Login Admin").click();
    });
    act(() => {
      screen.getByText("Login Analyst").click();
    });

    act(() => {
      latestAuth.logout("admin_user");
    });

    expect(screen.getByTestId("user").textContent).toBe("analyst_user");
    expect(screen.getByTestId("isAuth").textContent).toBe("yes");
    expect(JSON.parse(localStorage.getItem("ci_accounts")).analyst_user).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("ci_accounts")).admin_user).toBeUndefined();
  });

  it("clears current session on logout", () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    act(() => {
      screen.getByText("Login Admin").click();
    });
    expect(screen.getByTestId("isAuth").textContent).toBe("yes");

    act(() => {
      screen.getByText("Logout Current").click();
    });

    expect(screen.getByTestId("user").textContent).toBe("guest");
    expect(screen.getByTestId("isAuth").textContent).toBe("no");
    expect(localStorage.getItem("ci_token")).toBeNull();
  });

  it("clears all accounts on logoutAll", () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    act(() => {
      screen.getByText("Login Admin").click();
    });
    act(() => {
      screen.getByText("Logout All").click();
    });

    expect(screen.getByTestId("isAuth").textContent).toBe("no");
    expect(localStorage.getItem("ci_accounts")).toBeNull();
  });

  describe("loginAndSwitch", () => {
    it("successfully logs in via API and switches account", async () => {
      const mockSession = {
        username: "api_admin",
        access_token: "api_token_789",
        role: "admin",
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockSession,
      });

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
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ detail: "Invalid password provided" }),
      });

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
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      });

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
