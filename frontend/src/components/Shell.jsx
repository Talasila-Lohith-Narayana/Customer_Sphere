import React, { useState, useEffect, useCallback } from "react";
import { Activity, BarChart3, ChevronLeft, ChevronRight, History, KeyRound, LayoutDashboard, LogOut, Megaphone, Moon, Package, RefreshCw, Sparkles, Sun, UserPlus, Users, X } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { authService } from "../services/api";
import AuditLogModal from "./AuditLogModal";
import ConfirmModal from "./ConfirmModal";

export default function Shell() {
  const { user, role, accounts, isAdmin, hasAccess, logout, logoutAll, switchToAccount, loginAndSwitch } = useAuth();
  const { theme, isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [switching, setSwitching] = useState(false);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profilesError, setProfilesError] = useState("");
  const [isCompactViewport, setIsCompactViewport] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth <= 850;
  });

  // Sidebar collapse/minimize state with localStorage persistence
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar_collapsed") === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const updateViewportState = () => {
      const compact = window.innerWidth <= 850;
      setIsCompactViewport(compact);
      setCollapsed((prev) => {
        if (compact) {
          try {
            localStorage.setItem("sidebar_collapsed", "true");
          } catch {}
          return true;
        }
        return prev;
      });
    };

    updateViewportState();
    window.addEventListener("resize", updateViewportState);
    return () => window.removeEventListener("resize", updateViewportState);
  }, []);

  const toggleCollapsed = () => {
    if (isCompactViewport) return;

    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("sidebar_collapsed", String(next));
      } catch {}
      return next;
    });
  };

  // Modal state for logging in to a new profile to switch
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [targetUsername, setTargetUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  const loadProfiles = useCallback(async () => {
    setProfilesLoading(true);
    setProfilesError("");
    try {
      const availableProfiles = await authService.profiles();
      if (!Array.isArray(availableProfiles)) {
        throw new Error("The server returned an invalid user list.");
      }
      setProfiles(availableProfiles);
    } catch (error) {
      setProfilesError(error.message || "Unable to load users.");
    } finally {
      setProfilesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles, user]);

  useEffect(() => {
    window.addEventListener("profiles-updated", loadProfiles);
    return () => window.removeEventListener("profiles-updated", loadProfiles);
  }, [loadProfiles]);

  // Handles user sign out and redirection to the login view
  const signOut = () => {
    setShowSignOutConfirm(false);
    logoutAll();
    navigate("/login");
  };

  // Handles clicking a profile switch button
  const handleProfileClick = async (target) => {
    if (!target) return;
    if (target === user) return;
    setLoginError("");

    // Check if the target account already has an active authenticated session
    if (accounts && accounts[target]?.access_token) {
      try {
        switchToAccount(target);
      } catch {
        // Session expired or missing, prompt login
        setTargetUsername(target);
        setPassword("");
        setShowLoginModal(true);
      }
    } else {
      // Must authenticate with password first
      setTargetUsername(target);
      setPassword("");
      setShowLoginModal(true);
    }
  };

  // Handles submitting credentials in the Switch Profile login dialog
  const handleLoginAndSwitch = async (e) => {
    e.preventDefault();
    if (!password) {
      setLoginError("Please enter your password.");
      return;
    }
    setSwitching(true);
    setLoginError("");
    try {
      await loginAndSwitch({ username: targetUsername, password });
      setShowLoginModal(false);
      setPassword("");
    } catch (err) {
      setLoginError(err.message || "Invalid credentials.");
    } finally {
      setSwitching(false);
    }
  };

  // Human-readable role indicator
  const roleLabel = isAdmin ? "Administrator" : (role === "viewer" ? "Analyst" : role || "User");
  const targetRoleLabel =
    profiles.find((profile) => profile.username === targetUsername)?.role === "admin"
      ? "Administrator"
      : "Viewer";
  const canAccess = hasAccess || ((page) =>
    isAdmin || ["dashboard", "customers", "products", "audit_logs"].includes(page));

  const profileSwitcher = (
    <div className={`profileSwitcher ${collapsed ? "compact" : ""}`}>
      {!collapsed && (
        <div className="profileSwitcherHeading">
          <span>Switch Profile</span>
          {switching && (
            <RefreshCw
              size={10}
              className="spin"
              style={{ animation: "spin 1s linear infinite" }}
            />
          )}
        </div>
      )}
      {collapsed && (
        <span className="profileSwitcherIcon" aria-hidden="true">
          <Users size={16} />
        </span>
      )}
      <select
        aria-label="Switch profile"
        title="Switch profile"
        value=""
        disabled={profilesLoading || switching}
        onChange={(event) => {
          const selectedUsername = event.target.value;
          void handleProfileClick(selectedUsername);
        }}
      >
        <option value="" hidden={collapsed}>
          {profilesLoading ? "Loading users..." : "Choose a user..."}
        </option>
        {profiles.map((profile) => (
          <option key={profile.username} value={profile.username}>
            {profile.username} — {profile.role === "admin" ? "Administrator" : "Viewer"}
            {profile.username === user ? " (current)" : ""}
          </option>
        ))}
      </select>
      {profilesError && (
        <button
          type="button"
          className="profileSwitcherError"
          onClick={() => void loadProfiles()}
        >
          Could not load users. Retry.
        </button>
      )}
    </div>
  );

  return (
    <div className={`shell ${collapsed ? "sidebarCollapsed" : ""}`}>
      {/* Sidebar Navigation */}
      <aside className={collapsed ? "collapsed" : ""}>
        {/* Toggle Minimize/Expand Button */}
        <button
          type="button"
          className="sidebarToggleBtn"
          onClick={toggleCollapsed}
          disabled={isCompactViewport}
          title={isCompactViewport ? "Sidebar automatically collapses on narrow screens" : (collapsed ? "Expand sidebar" : "Minimize sidebar")}
          aria-label={isCompactViewport ? "Sidebar automatically collapses on narrow screens" : (collapsed ? "Expand sidebar" : "Minimize sidebar")}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

        <div className="brand" title="Customer Sphere">
          <div className="brandIcon">
            <Sparkles size={18} />
          </div>
          {!collapsed && (
            <>
              <b>Customer</b>
              <b>Sphere</b>
            </>
          )}
        </div>
        {!collapsed && <small>WORKSPACE</small>}
        
        {canAccess("dashboard") && (
          <NavLink to="/" end title="Dashboard">
            <LayoutDashboard size={17} />
            {!collapsed && <span>Dashboard</span>}
          </NavLink>
        )}
        {canAccess("customers") && (
          <NavLink to="/customers" title="Customers">
            <Users size={17} />
            {!collapsed && <span>Customers</span>}
          </NavLink>
        )}
        {canAccess("products") && (
          <NavLink to="/products" title="Products">
            <Package size={17} />
            {!collapsed && <span>Products</span>}
          </NavLink>
        )}
        {canAccess("analytics") && (
          <NavLink to="/analytics" title="Analytics">
            <BarChart3 size={17} />
            {!collapsed && <span>Analytics</span>}
          </NavLink>
        )}
        {canAccess("campaigns") && (
          <NavLink to="/campaigns" title="Campaigns">
            <Megaphone size={17} />
            {!collapsed && <span>Campaigns</span>}
          </NavLink>
        )}
        {canAccess("model") && (
          <NavLink to="/model" title="Model diagnostics">
            <Activity size={17} />
            {!collapsed && <span>Model</span>}
          </NavLink>
        )}
        {isAdmin && (
          <NavLink to="/users" title="User management">
            <UserPlus size={17} />
            {!collapsed && <span>Users</span>}
          </NavLink>
        )}
        
        {/* Workspace Admin Data Changes Button */}
        {canAccess("audit_logs") && (
          <button
            type="button"
            onClick={() => setShowAuditModal(true)}
            className="sideNavBtn"
            title="Admin Activity: View audit trail and history"
          >
            <History size={17} />
            {!collapsed && <span>Admin Activity</span>}
          </button>
        )}
        
        {/* User Session & Logout Controls */}
        <div className="sideBottom">
          {/* Light / Dark Mode Toggle Button */}
          <button
            type="button"
            onClick={toggleTheme}
            className="sideThemeBtn"
            title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {isDark ? <Sun size={15} color="#f59e0b" /> : <Moon size={15} color="#93c5fd" />}
            {!collapsed && <span>{isDark ? "Light Mode" : "Dark Mode"}</span>}
            {!collapsed && (
              <span style={{ fontSize: 10, background: isDark ? "#334155" : "#0f172a", padding: "2px 6px", borderRadius: 4, color: "#94a3b8" }}>
                {theme.toUpperCase()}
              </span>
            )}
          </button>

          <div className="user" title={`${user} (${roleLabel})`}>
            <div className="avatar">{user?.[0]?.toUpperCase()}</div>
            {!collapsed && (
              <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                <b style={{ whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{user}</b>
                <span>{roleLabel}</span>
              </div>
            )}
          </div>

          {profileSwitcher}

          <button onClick={() => setShowSignOutConfirm(true)} title="Sign out" className="sideSignOutBtn">
            <LogOut size={16} />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      {/* Profile Login Modal Dialog */}
      {showLoginModal && (
        <div className="modalBg">
          <form className="modal" style={{ maxWidth: 380 }} onSubmit={handleLoginAndSwitch}>
            <button type="button" className="close" onClick={() => setShowLoginModal(false)}>
              <X size={18} />
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div
                className="switchProfileIcon"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: targetRoleLabel === "Administrator" ? "#dbeafe" : "#e0f2fe",
                  color: targetRoleLabel === "Administrator" ? "#1d4ed8" : "#0369a1",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <KeyRound size={18} />
              </div>
              <div>
                <p className="eyebrow" style={{ margin: 0 }}>SECURITY VERIFICATION</p>
                <h2 style={{ margin: 0, fontSize: 18 }}>
                  Sign in as {targetRoleLabel}
                </h2>
              </div>
            </div>

            <p className="filterHint" style={{ marginBottom: 16 }}>
              Please enter the password for <b>{targetUsername}</b> to switch profiles.
            </p>

            <label>
              Username
              <input
                type="text"
                value={targetUsername}
                disabled
                className="switchProfileDisabledInput"
                style={{ background: "#f1f5f9", cursor: "not-allowed" }}
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setLoginError("");
                }}
                placeholder={`Enter password for ${targetUsername}`}
                autoFocus
                required
              />
            </label>

            {loginError && <div className="apiError">{loginError}</div>}

            <div className="actions" style={{ marginTop: 16 }}>
              <button type="button" className="btn secondary" onClick={() => setShowLoginModal(false)} disabled={switching}>
                Cancel
              </button>
              <button className="btn primary" disabled={switching}>
                {switching ? "Authenticating..." : "Sign In & Switch"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Admin Activity / Audit Trail Modal */}
      {showAuditModal && (
        <AuditLogModal close={() => setShowAuditModal(false)} />
      )}

      {showSignOutConfirm && (
        <ConfirmModal
          title="Sign out?"
          message="This will sign out all active profiles on this device."
          confirmLabel="Sign out"
          onConfirm={signOut}
          onCancel={() => setShowSignOutConfirm(false)}
        />
      )}

      {/* Dynamic Content Viewport */}
      <main className={collapsed ? "expanded" : ""}>
        <Outlet />
      </main>
    </div>
  );
}
