import { useEffect, useState } from "react";
import { Routes, Route, Link, Navigate, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth, authFetch } from "./auth";
import { MonumentsPage } from "./pages/MonumentsPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { ScrapingSourcesPage } from "./pages/ScrapingSourcesPage";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Obit {
  id: string;
  deceased_name: string;
  date_of_death: string | null;
  newspaper: string;
  monument_ordered: boolean;
  notes: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Protected Route wrapper
// ---------------------------------------------------------------------------
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: "2rem" }}>Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: "2rem" }}>Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.is_admin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Obits Page (original home content)
// ---------------------------------------------------------------------------
function ObitsPage() {
  const [obits, setObits] = useState<Obit[]>([]);

  // Form state
  const [name, setName] = useState("");
  const [dod, setDod] = useState("");
  const [paper, setPaper] = useState("");
  const [ordered, setOrdered] = useState(false);
  const [notes, setNotes] = useState("");

  const fetchObits = async () => {
    try {
      const res = await authFetch("/api/obits");
      if (res.ok) {
        const data: Obit[] = await res.json();
        setObits(data);
      }
    } catch {
      console.error("Failed to load obits");
    }
  };

  useEffect(() => {
    fetchObits();
  }, []);

  // ------ Create ----------------------------------------------------------
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await authFetch("/api/obits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deceased_name: name,
        date_of_death: dod || null,
        newspaper: paper,
        monument_ordered: ordered,
        notes,
      }),
    });
    setName("");
    setDod("");
    setPaper("");
    setOrdered(false);
    setNotes("");
    fetchObits();
  };

  // ------ Delete ----------------------------------------------------------
  const handleDelete = async (id: string) => {
    await authFetch(`/api/obits/${id}`, { method: "DELETE" });
    fetchObits();
  };

  // ------ Render ----------------------------------------------------------
  return (
    <>
      {/* Quick-add form */}
      <form className="add-form" onSubmit={handleAdd}>
        <input
          placeholder="Deceased name *"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          type="date"
          value={dod}
          onChange={(e) => setDod(e.target.value)}
        />
        <input
          placeholder="Newspaper"
          value={paper}
          onChange={(e) => setPaper(e.target.value)}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input
            type="checkbox"
            checked={ordered}
            onChange={(e) => setOrdered(e.target.checked)}
          />
          Monument ordered
        </label>
        <input
          placeholder="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          style={{ flex: 1, minWidth: 140 }}
        />
        <button type="submit" className="btn btn-primary">
          + Add
        </button>
      </form>

      {/* Obits table */}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Date of Death</th>
            <th>Newspaper</th>
            <th>Monument</th>
            <th>Notes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {obits.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ textAlign: "center", padding: 24 }}>
                No obituaries yet.
              </td>
            </tr>
          ) : (
            obits.map((o) => (
              <tr key={o.id}>
                <td>{o.deceased_name}</td>
                <td>{o.date_of_death ?? "—"}</td>
                <td>{o.newspaper || "—"}</td>
                <td>{o.monument_ordered ? "Yes" : "No"}</td>
                <td>{o.notes || "—"}</td>
                <td>
                  <button
                    className="btn btn-danger"
                    onClick={() => handleDelete(o.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </>
  );
}

// ---------------------------------------------------------------------------
// Nav Bar
// ---------------------------------------------------------------------------
function NavBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <nav
      style={{
        marginBottom: "1rem",
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        flexWrap: "wrap",
      }}
    >
      {user ? (
        <>
          <Link to="/">Obituaries</Link>
          <Link to="/monuments">Monuments</Link>
          <Link to="/scraping">Sources</Link>
          {user.is_admin && <Link to="/admin">Admin</Link>}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ fontSize: "0.85rem", color: "#555" }}>
              {user.full_name || user.email}
            </span>
            <button
              className="btn"
              style={{ fontSize: "0.8rem", padding: "4px 12px" }}
              onClick={handleLogout}
            >
              Logout
            </button>
          </div>
        </>
      ) : (
        <Link to="/login">Login</Link>
      )}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// App with routing
// ---------------------------------------------------------------------------
function AppRoutes() {
  return (
    <div className="container">
      <h1>obit-crm-lite</h1>
      <NavBar />

      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <ObitsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/monuments"
          element={
            <RequireAuth>
              <MonumentsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/scraping"
          element={
            <RequireAuth>
              <ScrapingSourcesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminDashboardPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/users"
          element={
            <RequireAdmin>
              <AdminUsersPage />
            </RequireAdmin>
          }
        />
      </Routes>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
