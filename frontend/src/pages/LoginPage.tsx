import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  const containerStyle: React.CSSProperties = {
    maxWidth: 400,
    margin: "3rem auto",
    padding: "2rem",
    background: "#fff",
    borderRadius: 8,
    boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
  };

  const inputStyle: React.CSSProperties = {
    display: "block",
    width: "100%",
    padding: "0.5rem 0.75rem",
    borderRadius: 6,
    border: "1px solid #ccc",
    fontSize: "0.9rem",
    marginBottom: "1rem",
  };

  return (
    <div style={containerStyle}>
      <h2 style={{ marginBottom: "1.5rem" }}>Login</h2>

      {error && (
        <div
          style={{
            color: "#b91c1c",
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: 4,
            padding: "0.5rem 0.75rem",
            marginBottom: "1rem",
            fontSize: "0.9rem",
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <label style={{ display: "block", fontWeight: 600, marginBottom: 4, fontSize: "0.9rem" }}>
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={inputStyle}
          autoComplete="email"
        />

        <label style={{ display: "block", fontWeight: 600, marginBottom: 4, fontSize: "0.9rem" }}>
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={inputStyle}
          autoComplete="current-password"
        />

        <button
          type="submit"
          disabled={submitting}
          className="btn btn-primary"
          style={{ width: "100%", padding: "0.6rem", fontSize: "0.95rem" }}
        >
          {submitting ? "Logging in…" : "Login"}
        </button>
      </form>

      <p style={{ marginTop: "1rem", fontSize: "0.9rem", textAlign: "center" }}>
        Don't have an account?{" "}
        <Link to="/register">Register</Link>
      </p>
    </div>
  );
}
