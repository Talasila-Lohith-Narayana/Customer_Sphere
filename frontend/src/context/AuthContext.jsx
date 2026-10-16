import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { AlertTriangle } from "lucide-react";
import { ACCESS_PAGES, DEFAULT_VIEWER_ACCESS } from "../accessPages";
import { authService } from "../services/api";
import {
  SESSION_REVOKED_EVENT,
  SESSION_REVOKED_STORAGE_KEY,
} from "../services/sessionEvents";

// Create Context for holding auth state
const AuthContext = createContext(null);

function decodeJwtPayload(token) {
  if (!token || typeof token !== "string") return null;

  try {
    const payload = token.split(".")[1];
    if (!payload) return null;

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = atob(padded)
      .split("")
      .map((char) => `%${(`00${char.charCodeAt(0).toString(16)}`).slice(-2)}`)
      .join("");

    return JSON.parse(decodeURIComponent(decoded));
  } catch {
    return null;
  }
}

function getSessionAccessPages(session) {
  if (Array.isArray(session?.access_pages)) return session.access_pages;
  return session?.role === "admin"
    ? ACCESS_PAGES.map(({ key }) => key)
    : DEFAULT_VIEWER_ACCESS;
}

export function AuthProvider({ children }) {
  // Map of username -> { access_token, username, role } for authenticated profiles
  const [accounts, setAccounts] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("ci_accounts") || "{}");
    } catch {
      return {};
    }
  });

  const [token, setToken] = useState(() => localStorage.getItem("ci_token"));
  const [user, setUser] = useState(() => localStorage.getItem("ci_user"));
  const [role, setRole] = useState(
    () => localStorage.getItem("ci_role") || "viewer",
  );
  const [accessPages, setAccessPages] = useState(() => {
    try {
      const pages = JSON.parse(localStorage.getItem("ci_access_pages") || "null");
      return Array.isArray(pages) ? pages : DEFAULT_VIEWER_ACCESS;
    } catch {
      return DEFAULT_VIEWER_ACCESS;
    }
  });
  const [sessionRevoked, setSessionRevoked] = useState(false);

  const clearCurrentSession = useCallback(() => {
    localStorage.removeItem("ci_token");
    localStorage.removeItem("ci_user");
    localStorage.removeItem("ci_role");
    localStorage.removeItem("ci_access_pages");
    setToken(null);
    setUser(null);
    setRole("viewer");
    setAccessPages(DEFAULT_VIEWER_ACCESS);
  }, []);

  const invalidateUserSession = useCallback((affectedUsername) => {
    if (!affectedUsername) return;
    const updatedAccounts = { ...accounts };
    if (Object.hasOwn(updatedAccounts, affectedUsername)) {
      delete updatedAccounts[affectedUsername];
      if (Object.keys(updatedAccounts).length === 0) {
        localStorage.removeItem("ci_accounts");
      } else {
        localStorage.setItem("ci_accounts", JSON.stringify(updatedAccounts));
      }
      setAccounts(updatedAccounts);
    }

    if (user !== affectedUsername) return;
    clearCurrentSession();
    setSessionRevoked(true);
  }, [accounts, clearCurrentSession, user]);

  useEffect(() => {
    const handleInvalidSession = (event) => {
      if (!token || event.detail?.token !== token) return;
      invalidateUserSession(user);
      if (user) {
        localStorage.setItem(
          SESSION_REVOKED_STORAGE_KEY,
          JSON.stringify({ username: user, nonce: `${Date.now()}-${Math.random()}` }),
        );
      }
    };

    window.addEventListener("auth-session-invalid", handleInvalidSession);
    return () =>
      window.removeEventListener("auth-session-invalid", handleInvalidSession);
  }, [invalidateUserSession, token, user]);

  useEffect(() => {
    const handleRevocation = (event) => {
      invalidateUserSession(event.detail?.username);
    };
    const handleStorage = (event) => {
      if (event.key !== SESSION_REVOKED_STORAGE_KEY || !event.newValue) return;
      try {
        invalidateUserSession(JSON.parse(event.newValue).username);
      } catch (error) {
        console.error("Could not read the session revocation notification.", error);
      }
    };

    window.addEventListener(SESSION_REVOKED_EVENT, handleRevocation);
    window.addEventListener("storage", handleStorage);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && token) {
        authService.validateSession().catch((error) => {
          if (!error.message?.toLowerCase().includes("session has expired")
            && !error.message?.toLowerCase().includes("invalid or expired token")) {
            console.error("Could not verify the current session.", error);
          }
        });
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener(SESSION_REVOKED_EVENT, handleRevocation);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [invalidateUserSession, token]);

  useEffect(() => {
    if (!token) return undefined;

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      authService.validateSession().catch((error) => {
        if (!error.message?.toLowerCase().includes("session has expired")
          && !error.message?.toLowerCase().includes("invalid or expired token")) {
          console.error("Could not verify the current session.", error);
        }
      });
    }, 30_000);

    return () => window.clearInterval(intervalId);
  }, [token]);

  useEffect(() => {
    if (!token) return undefined;

    const payload = decodeJwtPayload(token);
    const expiresAt = payload?.exp ? Number(payload.exp) * 1000 : null;

    if (!expiresAt || !Number.isFinite(expiresAt)) return undefined;

    const timeRemaining = expiresAt - Date.now();
    if (timeRemaining <= 0) {
      clearCurrentSession();
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      clearCurrentSession();
    }, timeRemaining);

    return () => window.clearTimeout(timeoutId);
  }, [token, clearCurrentSession]);

  const login = (session) => {
    const sessionAccessPages = getSessionAccessPages(session);
    const updatedAccounts = {
      ...accounts,
      [session.username]: { ...session, access_pages: sessionAccessPages },
    };
    localStorage.setItem("ci_accounts", JSON.stringify(updatedAccounts));
    localStorage.setItem("ci_token", session.access_token);
    localStorage.setItem("ci_user", session.username);
    localStorage.setItem("ci_role", session.role);
    localStorage.setItem("ci_access_pages", JSON.stringify(sessionAccessPages));
    setAccounts(updatedAccounts);
    setToken(session.access_token);
    setUser(session.username);
    setRole(session.role);
    setAccessPages(sessionAccessPages);
    setSessionRevoked(false);
  };

  const updateCurrentSession = (session) => {
    const sessionAccessPages = getSessionAccessPages(session);
    const updatedAccounts = { ...accounts };
    if (user && user !== session.username) {
      delete updatedAccounts[user];
    }
    const updatedSession = {
      ...(updatedAccounts[session.username] || {}),
      access_token: session.access_token || token,
      username: session.username,
      role: session.role,
      access_pages: sessionAccessPages,
    };
    updatedAccounts[session.username] = updatedSession;
    localStorage.setItem("ci_accounts", JSON.stringify(updatedAccounts));
    localStorage.setItem("ci_user", session.username);
    if (session.access_token) {
      localStorage.setItem("ci_token", session.access_token);
      setToken(session.access_token);
    }
    localStorage.setItem("ci_role", session.role);
    localStorage.setItem("ci_access_pages", JSON.stringify(sessionAccessPages));
    setAccounts(updatedAccounts);
    setUser(session.username);
    setRole(session.role);
    setAccessPages(sessionAccessPages);
  };

  const updateAccountAccess = (username, sessionAccessPages) => {
    const updatedAccounts = {
      ...accounts,
      [username]: {
        ...(accounts[username] || {}),
        username,
        access_pages: sessionAccessPages,
      },
    };
    localStorage.setItem("ci_accounts", JSON.stringify(updatedAccounts));
    setAccounts(updatedAccounts);
    if (user === username) {
      localStorage.setItem("ci_access_pages", JSON.stringify(sessionAccessPages));
      setAccessPages(sessionAccessPages);
    }
  };

  const logout = (usernameToLogout = null) => {
    const targetUsername = usernameToLogout ?? user;

    if (usernameToLogout && usernameToLogout !== user) {
      const updatedAccounts = { ...accounts };
      delete updatedAccounts[usernameToLogout];

      if (Object.keys(updatedAccounts).length === 0) {
        localStorage.removeItem("ci_accounts");
        setAccounts({});
      } else {
        localStorage.setItem("ci_accounts", JSON.stringify(updatedAccounts));
        setAccounts(updatedAccounts);
      }
      return;
    }

    if (!targetUsername) return;

    const updatedAccounts = { ...accounts };
    delete updatedAccounts[targetUsername];

    if (Object.keys(updatedAccounts).length === 0) {
      localStorage.removeItem("ci_accounts");
      setAccounts({});
    } else {
      localStorage.setItem("ci_accounts", JSON.stringify(updatedAccounts));
      setAccounts(updatedAccounts);
    }

    clearCurrentSession();
  };

  const logoutAll = () => {
    localStorage.removeItem("ci_accounts");
    localStorage.removeItem("ci_token");
    localStorage.removeItem("ci_user");
    localStorage.removeItem("ci_role");
    localStorage.removeItem("ci_access_pages");
    setAccounts({});
    setToken(null);
    setUser(null);
    setRole("viewer");
    setAccessPages(DEFAULT_VIEWER_ACCESS);
    setSessionRevoked(false);
  };

  const switchToAccount = (targetUsername) => {
    const targetSession = accounts[targetUsername];
    if (!targetSession || !targetSession.access_token) {
      throw new Error(`Account ${targetUsername} is not logged in.`);
    }
    localStorage.setItem("ci_token", targetSession.access_token);
    localStorage.setItem("ci_user", targetSession.username);
    localStorage.setItem("ci_role", targetSession.role);
    const sessionAccessPages = getSessionAccessPages(targetSession);
    localStorage.setItem("ci_access_pages", JSON.stringify(sessionAccessPages));
    setToken(targetSession.access_token);
    setUser(targetSession.username);
    setRole(targetSession.role);
    setAccessPages(sessionAccessPages);
  };

  const loginAndSwitch = async (credentials) => {
    const res = await fetch(`${import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000/api"}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Authentication failed. Invalid username or password.");
    }
    const session = await res.json();
    login(session);
    return session;
  };

  return (
    <>
      <AuthContext.Provider
        value={{
          token,
          user,
          role,
          accessPages,
          accounts,
          isAdmin: role === "admin",
          hasAccess: (page) => role === "admin" || accessPages.includes(page),
          login,
          updateCurrentSession,
          updateAccountAccess,
          logout,
          logoutAll,
          switchToAccount,
          loginAndSwitch,
          isAuthenticated: Boolean(token),
        }}
      >
        {children}
      </AuthContext.Provider>
      {sessionRevoked && (
        <div
          className="modalBg"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="session-revoked-title"
          aria-describedby="session-revoked-message"
        >
          <div className="modal" style={{ maxWidth: 440 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <AlertTriangle size={20} color="#ef4444" aria-hidden="true" />
              <h2 id="session-revoked-title" style={{ margin: 0, fontSize: 18 }}>
                Please sign in again
              </h2>
            </div>
            <p id="session-revoked-message">
              Your credentials or page access were changed. For your security,
              you have been signed out. Please log in again to continue.
            </p>
            <div className="actions">
              <button
                type="button"
                className="btn primary"
                onClick={() => setSessionRevoked(false)}
                autoFocus
              >
                Sign in again
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
export function useAuth() {
  return useContext(AuthContext);
}
