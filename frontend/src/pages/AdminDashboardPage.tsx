import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { authFetch } from "../auth";

interface CemeteryCount {
  cemetery_name: string;
  count: number;
}
interface UserMonumentCount {
  user_email: string;
  user_name: string;
  count: number;
}
interface MonthCount {
  month: string;
  count: number;
}
interface RecentMonument {
  id: string;
  cemetery_name: string;
  deceased_name: string | null;
  date_of_birth: string | null;
  date_of_death: string | null;
  created_at: string;
  user_email: string;
  user_name: string;
}
interface Stats {
  total_monuments: number;
  total_users: number;
  total_obits: number;
  monuments_by_cemetery: CemeteryCount[];
  monuments_by_user: UserMonumentCount[];
  monuments_by_month: MonthCount[];
  recent_monuments: RecentMonument[];
}

export function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authFetch("/api/admin/stats")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        return res.json();
      })
      .then((data) => setStats(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleExportCSV = async () => {
    try {
      const res = await authFetch("/api/admin/export/monuments");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "monuments_export.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Export failed");
    }
  };

  const cardStyle: React.CSSProperties = {
    background: "#fff",
    borderRadius: 8,
    padding: "1.25rem",
    boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
    textAlign: "center",
    flex: "1 1 180px",
  };

  const sectionStyle: React.CSSProperties = {
    background: "#fff",
    borderRadius: 8,
    padding: "1.25rem",
    boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
    marginBottom: "1.5rem",
  };

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

  if (loading) return <div style={{ padding: "1rem" }}>Loading dashboard…</div>;
  if (error) return <div style={{ padding: "1rem", color: "#b91c1c" }}>Error: {error}</div>;
  if (!stats) return null;

  return (
    <div style={{ padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Admin Dashboard</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="btn btn-primary" onClick={handleExportCSV}>
            Export CSV
          </button>
          <Link to="/admin/users" className="btn" style={{ padding: "6px 16px", border: "1px solid #ccc", borderRadius: 6, fontSize: "0.85rem", fontWeight: 600, textDecoration: "none", color: "#1a1a2e", background: "#fff" }}>
            Manage Users
          </Link>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <div style={cardStyle}>
          <div style={{ fontSize: "2rem", fontWeight: 700, color: "#4a6cf7" }}>
            {stats.total_monuments}
          </div>
          <div style={{ fontSize: "0.85rem", color: "#666" }}>Monuments</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: "2rem", fontWeight: 700, color: "#4a6cf7" }}>
            {stats.total_users}
          </div>
          <div style={{ fontSize: "0.85rem", color: "#666" }}>Users</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: "2rem", fontWeight: 700, color: "#4a6cf7" }}>
            {stats.total_obits}
          </div>
          <div style={{ fontSize: "0.85rem", color: "#666" }}>Obituaries</div>
        </div>
      </div>

      {/* Monuments by cemetery */}
      <div style={sectionStyle}>
        <h3 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "1rem" }}>Monuments by Cemetery</h3>
        {stats.monuments_by_cemetery.length === 0 ? (
          <p style={{ color: "#888", fontSize: "0.9rem" }}>No data</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Cemetery</th>
                <th style={thStyle}>Count</th>
              </tr>
            </thead>
            <tbody>
              {stats.monuments_by_cemetery.map((c) => (
                <tr key={c.cemetery_name}>
                  <td style={tdStyle}>{c.cemetery_name}</td>
                  <td style={tdStyle}>{c.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Monuments by user */}
      <div style={sectionStyle}>
        <h3 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "1rem" }}>Monuments by User</h3>
        {stats.monuments_by_user.length === 0 ? (
          <p style={{ color: "#888", fontSize: "0.9rem" }}>No data</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Count</th>
              </tr>
            </thead>
            <tbody>
              {stats.monuments_by_user.map((u) => (
                <tr key={u.user_email}>
                  <td style={tdStyle}>{u.user_email}</td>
                  <td style={tdStyle}>{u.user_name}</td>
                  <td style={tdStyle}>{u.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Monuments by month */}
      <div style={sectionStyle}>
        <h3 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "1rem" }}>Monuments by Month</h3>
        {stats.monuments_by_month.length === 0 ? (
          <p style={{ color: "#888", fontSize: "0.9rem" }}>No data</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            {stats.monuments_by_month.map((m) => (
              <div key={m.month} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ minWidth: 80, fontSize: "0.85rem", fontWeight: 600 }}>{m.month}</span>
                <div
                  style={{
                    height: 20,
                    background: "#4a6cf7",
                    borderRadius: 4,
                    width: `${Math.max(20, Math.min(300, m.count * 30))}px`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    paddingRight: 6,
                    color: "#fff",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                  }}
                >
                  {m.count}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent monuments */}
      <div style={sectionStyle}>
        <h3 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "1rem" }}>Recent Monuments</h3>
        {stats.recent_monuments.length === 0 ? (
          <p style={{ color: "#888", fontSize: "0.9rem" }}>No data</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Cemetery</th>
                <th style={thStyle}>Deceased</th>
                <th style={thStyle}>Created</th>
                <th style={thStyle}>User</th>
              </tr>
            </thead>
            <tbody>
              {stats.recent_monuments.map((m) => (
                <tr key={m.id}>
                  <td style={tdStyle}>{m.cemetery_name}</td>
                  <td style={tdStyle}>{m.deceased_name ?? "—"}</td>
                  <td style={tdStyle}>{new Date(m.created_at).toLocaleDateString()}</td>
                  <td style={tdStyle}>{m.user_name} ({m.user_email})</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
