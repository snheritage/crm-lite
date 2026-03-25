import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { authFetch } from "../auth";

interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  is_admin: boolean;
  is_active: boolean;
  monument_count: number;
  obit_count: number;
  created_at: string;
}

export function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authFetch("/api/admin/users")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        return res.json();
      })
      .then((data) => setUsers(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const thStyle: React.CSSProperties = {
    borderBottom: "1px solid #ccc",
    textAlign: "left",
    padding: "8px 12px",
    fontSize: "0.85rem",
  };

  const tdStyle: React.CSSProperties = {
    padding: "8px 12px",
    fontSize: "0.85rem",
    borderBottom: "1px solid #eee",
  };

  const badgeStyle: React.CSSProperties = {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 10,
    fontSize: "0.75rem",
    fontWeight: 600,
    background: "#4a6cf7",
    color: "#fff",
  };

  if (loading) return <div style={{ padding: "1rem" }}>Loading users…</div>;
  if (error) return <div style={{ padding: "1rem", color: "#b91c1c" }}>Error: {error}</div>;

  return (
    <div style={{ padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0 }}>Users</h2>
        <Link to="/admin" style={{ fontSize: "0.9rem" }}>Back to Dashboard</Link>
      </div>

      <div
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: "1rem",
          boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
          overflowX: "auto",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>Email</th>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Monuments</th>
              <th style={thStyle}>Obits</th>
              <th style={thStyle}>Created</th>
              <th style={thStyle}>Role</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td style={tdStyle}>{u.email}</td>
                <td style={tdStyle}>{u.full_name}</td>
                <td style={tdStyle}>{u.monument_count}</td>
                <td style={tdStyle}>{u.obit_count}</td>
                <td style={tdStyle}>{new Date(u.created_at).toLocaleDateString()}</td>
                <td style={tdStyle}>
                  {u.is_admin && <span style={badgeStyle}>Admin</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
