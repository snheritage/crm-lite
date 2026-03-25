import { useEffect, useState } from "react";
import { Routes, Route, Link } from "react-router-dom";
import { MonumentsPage } from "./pages/MonumentsPage";

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

// Use relative URLs so the Vite proxy (dev) or same-origin (prod) works.
const API = import.meta.env.VITE_API_URL ?? "";

// ---------------------------------------------------------------------------
// Obits Page (original home content)
// ---------------------------------------------------------------------------
function ObitsPage() {
  const [health, setHealth] = useState<string>("checking…");
  const [obits, setObits] = useState<Obit[]>([]);

  // Form state
  const [name, setName] = useState("");
  const [dod, setDod] = useState("");
  const [paper, setPaper] = useState("");
  const [ordered, setOrdered] = useState(false);
  const [notes, setNotes] = useState("");

  // ------ Fetch helpers ---------------------------------------------------
  const fetchHealth = async () => {
    try {
      const res = await fetch(`${API}/api/health`);
      const data = await res.json();
      setHealth(data.status ?? "unknown");
    } catch {
      setHealth("error");
    }
  };

  const fetchObits = async () => {
    try {
      const res = await fetch(`${API}/api/obits`);
      const data: Obit[] = await res.json();
      setObits(data);
    } catch {
      console.error("Failed to load obits");
    }
  };

  useEffect(() => {
    fetchHealth();
    fetchObits();
  }, []);

  // ------ Create ----------------------------------------------------------
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await fetch(`${API}/api/obits`, {
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
    await fetch(`${API}/api/obits/${id}`, { method: "DELETE" });
    fetchObits();
  };

  // ------ Render ----------------------------------------------------------
  return (
    <>
      <span className={`health-badge ${health === "ok" ? "ok" : "err"}`}>
        API: {health}
      </span>

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
// App with routing
// ---------------------------------------------------------------------------
export default function App() {
  return (
    <div className="container">
      <h1>obit-crm-lite</h1>
      <nav style={{ marginBottom: "1rem" }}>
        <Link to="/" style={{ marginRight: "1rem" }}>Obituaries</Link>
        <Link to="/monuments">Monuments</Link>
      </nav>

      <Routes>
        <Route path="/" element={<ObitsPage />} />
        <Route path="/monuments" element={<MonumentsPage />} />
      </Routes>
    </div>
  );
}
