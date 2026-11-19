import React, { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Eye, EyeOff, LoaderCircle, Sparkles } from "lucide-react";
import { authService } from "../services/api";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { isAuthenticated, login } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const errorRef = useRef(null);

  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
    }
  }, [error]);

  // If already logged in, redirect directly to dashboard
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
async function submit(event) {
    event.preventDefault();
    setError("");
    if (!form.username || form.password.length < 6) {
      setError("Enter a username and a password with at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      const session = await authService.login(form);
      login(session);
      navigate("/dashboard");
    } catch (requestError) {
      setError(requestError.message || "Unable to sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      {/* Brand Hero Left Column */}
      <section className="loginHero">
        <div className="brandIcon">
          <Sparkles />
        </div>
        <p>CUSTOMER SPHERE</p>
        <h1>Turn customer data into decisions.</h1>
        <span>
          Explore real Olist customer behavior, RFM features, orders, reviews
          and purchasing patterns.
        </span>
      </section>

      {/* Sign-In Card Right Column */}
      <form className="loginCard" onSubmit={submit} autoComplete="on">
        <div className="brandIcon dark">
          <Sparkles />
        </div>
        <p className="eyebrow">WELCOME BACK</p>
        <h2>Sign in</h2>
        <span className="muted">Access your intelligence workspace.</span>


        <label htmlFor="login-username">
          Username
          <input
            id="login-username"
            name="username"
            autoComplete="username"
            value={form.username}
            onChange={(event) =>
              setForm({ ...form, username: event.target.value })
            }
          />
        </label>
        <label htmlFor="login-password">
          Password
          <span className="passwordInput">
            <input
              id="login-password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={form.password}
              onChange={(event) =>
                setForm({ ...form, password: event.target.value })
              }
            />
            <button
              type="button"
              className="passwordToggle"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              title={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </span>
        </label>
        {error && (
          <div
            id="login-error"
            className="apiError"
            role="alert"
            aria-live="assertive"
            tabIndex="-1"
            ref={errorRef}
          >
            {error}
          </div>
        )}
        <button
          type="submit"
          className="btn primary full"
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? (
            <>
              <LoaderCircle className="loginSpinner" size={16} aria-hidden="true" />
              <span>Signing in...</span>
            </>
          ) : (
            "Sign in"
          )}
        </button>

      </form>
    </div>
  );
}
