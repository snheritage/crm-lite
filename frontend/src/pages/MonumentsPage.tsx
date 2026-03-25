import React, { useEffect, useState } from "react";

type Monument = {
  id: string;
  cemetery_name: string;
  deceased_name: string | null;
  date_of_birth: string | null;
  date_of_death: string | null;
  notes: string;
  created_at: string;
};

const API_BASE = import.meta.env.VITE_API_URL || "";

export function MonumentsPage() {
  const [monuments, setMonuments] = useState<Monument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = `${API_BASE}/api/monuments`;
    fetch(url)
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Request failed: ${res.status} ${text}`);
        }
        return res.json();
      })
      .then((data) => setMonuments(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading monuments…</div>;
  if (error) return <div>Error loading monuments: {error}</div>;
  if (monuments.length === 0) {
    return <div>No monuments yet. Try uploading a photo first.</div>;
  }

  return (
    <div style={{ padding: "1rem" }}>
      <h1>Monuments</h1>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ borderBottom: "1px solid #ccc", textAlign: "left" }}>Cemetery</th>
            <th style={{ borderBottom: "1px solid #ccc", textAlign: "left" }}>Name</th>
            <th style={{ borderBottom: "1px solid #ccc", textAlign: "left" }}>Born</th>
            <th style={{ borderBottom: "1px solid #ccc", textAlign: "left" }}>Died</th>
            <th style={{ borderBottom: "1px solid #ccc", textAlign: "left" }}>Created at</th>
          </tr>
        </thead>
        <tbody>
          {monuments.map((m) => (
            <tr key={m.id}>
              <td style={{ padding: "0.25rem 0.5rem" }}>{m.cemetery_name}</td>
              <td style={{ padding: "0.25rem 0.5rem" }}>{m.deceased_name ?? "—"}</td>
              <td style={{ padding: "0.25rem 0.5rem" }}>{m.date_of_birth ?? "—"}</td>
              <td style={{ padding: "0.25rem 0.5rem" }}>{m.date_of_death ?? "—"}</td>
              <td style={{ padding: "0.25rem 0.5rem" }}>
                {new Date(m.created_at).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
