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

function getSessionAccessPages(session) {
  if (Array.isArray(session?.access_pages)) return session.access_pages;
  return session?.role === "admin"
    ? ACCESS_PAGES.map(({ key }) => key)
    : DEFAULT_VIEWER_ACCESS;
}

export function AuthProvider({ children }) {
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

  useEffect(() => {
    localStorage.removeItem("ci_token");
    localStorage.removeItem("ci_accounts");
  }, []);

  const clearCurrentSession = useCallback(() => {
    localStorage.removeItem("ci_token");
    localStorage.removeItem("ci_user");
    localStorage.removeItem("ci_role");
    localStorage.removeItem("ci_access_pages");
    setUser(null);
    setRole("viewer");
    setAccessPages(DEFAULT_VIEWER_ACCESS);
  }, []);

  const invalidateUserSession = useCallback((affectedUsername) => {
    if (!affectedUsername) return;
    if (user !== affectedUsername) return;
    clearCurrentSession();
    setSessionRevoked(true);
  }, [clearCurrentSession, user]);

  useEffect(() => {
    const handleInvalidSession = (event) => {
      if (!user || (event.detail?.username && event.detail.username !== user)) return;
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
  }, [invalidateUserSession, user]);

  useEffect(() => {
    if (!user) return undefined;
    authService.validateSession().catch((error) => {
      if (!error.message?.toLowerCase().includes("session has expired")
        && !error.message?.toLowerCase().includes("invalid or expired token")) {
        console.error("Could not verify the current session.", error);
      }
    });
    return undefined;
  }, [user]);

  useEffect(() => {
    const handleRevocation = (event) => {
      invalidateUserSession(event.detail?.username);
    };
    const handleStorage = (event) => {
      if (event.key === "ci_user" && event.newValue !== user) {
        clearCurrentSession();
        return;
      }
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
      if (document.visibilityState === "visible" && user) {
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
  }, [clearCurrentSession, invalidateUserSession, user]);

  useEffect(() => {
    if (!user) return undefined;

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
  }, [user]);

  const login = (session) => {
    const sessionAccessPages = getSessionAccessPages(session);
    localStorage.removeItem("ci_token");
    localStorage.setItem("ci_user", session.username);
    localStorage.setItem("ci_role", session.role);
    localStorage.setItem("ci_access_pages", JSON.stringify(sessionAccessPages));
    setUser(session.username);
    setRole(session.role);
    setAccessPages(sessionAccessPages);
    setSessionRevoked(false);
  };

  const updateCurrentSession = (session) => {
    const sessionAccessPages = getSessionAccessPages(session);
    localStorage.setItem("ci_user", session.username);
    localStorage.setItem("ci_role", session.role);
    localStorage.setItem("ci_access_pages", JSON.stringify(sessionAccessPages));
    setUser(session.username);
    setRole(session.role);
    setAccessPages(sessionAccessPages);
  };

  const updateAccountAccess = (username, sessionAccessPages) => {
    if (user === username) {
      localStorage.setItem("ci_access_pages", JSON.stringify(sessionAccessPages));
      setAccessPages(sessionAccessPages);
    }
  };

  const logout = async (usernameToLogout = null) => {
    const targetUsername = usernameToLogout ?? user;

    if (usernameToLogout && usernameToLogout !== user) {
      return;
    }

    if (!targetUsername) return;

    await authService.logout();
    clearCurrentSession();
  };

  const logoutAll = async () => {
    await authService.logout();
    localStorage.removeItem("ci_accounts");
    localStorage.removeItem("ci_token");
    localStorage.removeItem("ci_user");
    localStorage.removeItem("ci_role");
    localStorage.removeItem("ci_access_pages");
    setUser(null);
    setRole("viewer");
    setAccessPages(DEFAULT_VIEWER_ACCESS);
    setSessionRevoked(false);
  };

  const loginAndSwitch = async (credentials) => {
    const session = await authService.login(credentials);
    login(session);
    return session;
  };

  return (
    <>
      <AuthContext.Provider
        value={{
          user,
          role,
          accessPages,
          isAdmin: role === "admin",
          hasAccess: (page) => role === "admin" || accessPages.includes(page),
          login,
          updateCurrentSession,
          updateAccountAccess,
          logout,
          logoutAll,
          loginAndSwitch,
          isAuthenticated: Boolean(user),
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
