import { useEffect, useState } from "react";
import { authFetch } from "../auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ScrapingSource {
  id: string;
  user_id: string;
  name: string;
  url: string;
  source_type: string;
  frontrunner_guid: string | null;
  is_active: boolean;
  last_scraped_at: string | null;
  last_scrape_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface ScrapeResult {
  new_obits: number;
  total_scraped: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ScrapingSourcesPage() {
  const [sources, setSources] = useState<ScrapingSource[]>([]);
  const [loading, setLoading] = useState(true);

  // Add form
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [adding, setAdding] = useState(false);

  // Edit state
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");

  // Scraping state
  const [scrapingId, setScrapingId] = useState<string | null>(null);
  const [scrapingAll, setScrapingAll] = useState(false);

  // Messages
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch sources
  // ---------------------------------------------------------------------------
  const fetchSources = async () => {
    try {
      const res = await authFetch("/api/scraping/sources");
      if (res.ok) {
        const data: ScrapingSource[] = await res.json();
        setSources(data);
      }
    } catch {
      console.error("Failed to load scraping sources");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSources();
  }, []);

  // Clear messages after 5 seconds
  useEffect(() => {
    if (message || error) {
      const timer = setTimeout(() => {
        setMessage(null);
        setError(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [message, error]);

  // ---------------------------------------------------------------------------
  // Add source
  // ---------------------------------------------------------------------------
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newUrl.trim()) return;

    setAdding(true);
    setError(null);
    setMessage(null);

    try {
      const res = await authFetch("/api/scraping/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, url: newUrl }),
      });
      if (res.ok) {
        setNewName("");
        setNewUrl("");
        setMessage("Source added successfully");
        await fetchSources();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || "Failed to add source");
      }
    } catch {
      setError("Failed to add source");
    } finally {
      setAdding(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Edit source
  // ---------------------------------------------------------------------------
  const startEdit = (source: ScrapingSource) => {
    setEditId(source.id);
    setEditName(source.name);
    setEditUrl(source.url);
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditName("");
    setEditUrl("");
  };

  const saveEdit = async (id: string) => {
    setError(null);
    setMessage(null);

    try {
      const res = await authFetch(`/api/scraping/sources/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName, url: editUrl }),
      });
      if (res.ok) {
        setEditId(null);
        setMessage("Source updated");
        await fetchSources();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || "Failed to update source");
      }
    } catch {
      setError("Failed to update source");
    }
  };

  // ---------------------------------------------------------------------------
  // Toggle active
  // ---------------------------------------------------------------------------
  const toggleActive = async (source: ScrapingSource) => {
    try {
      await authFetch(`/api/scraping/sources/${source.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !source.is_active }),
      });
      await fetchSources();
    } catch {
      setError("Failed to toggle source");
    }
  };

  // ---------------------------------------------------------------------------
  // Delete source
  // ---------------------------------------------------------------------------
  const handleDelete = async (id: string) => {
    if (!confirm("Delete this scraping source?")) return;

    try {
      const res = await authFetch(`/api/scraping/sources/${id}`, {
        method: "DELETE",
      });
      if (res.ok || res.status === 204) {
        setMessage("Source deleted");
        await fetchSources();
      } else {
        setError("Failed to delete source");
      }
    } catch {
      setError("Failed to delete source");
    }
  };

  // ---------------------------------------------------------------------------
  // Scrape single
  // ---------------------------------------------------------------------------
  const handleScrape = async (id: string) => {
    setScrapingId(id);
    setError(null);
    setMessage(null);

    try {
      const res = await authFetch(`/api/scraping/sources/${id}/scrape`, {
        method: "POST",
      });
      if (res.ok) {
        const data: ScrapeResult = await res.json();
        setMessage(
          `Scraped ${data.total_scraped} obituaries, ${data.new_obits} new`
        );
        await fetchSources();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || "Scraping failed");
        await fetchSources();
      }
    } catch {
      setError("Scraping failed");
    } finally {
      setScrapingId(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Scrape all
  // ---------------------------------------------------------------------------
  const handleScrapeAll = async () => {
    setScrapingAll(true);
    setError(null);
    setMessage(null);

    try {
      const res = await authFetch("/api/scraping/scrape-all", {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setMessage(
          `Scraped ${data.sources_scraped} sources, ${data.total_new_obits} new obituaries`
        );
        await fetchSources();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || "Scrape all failed");
      }
    } catch {
      setError("Scrape all failed");
    } finally {
      setScrapingAll(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (loading) {
    return <div style={{ padding: "2rem" }}>Loading sources…</div>;
  }

  return (
    <>
      {/* Messages */}
      {message && (
        <div
          style={{
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            background: "#d4edda",
            color: "#155724",
            borderRadius: 4,
            border: "1px solid #c3e6cb",
          }}
        >
          {message}
        </div>
      )}
      {error && (
        <div
          style={{
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            background: "#f8d7da",
            color: "#721c24",
            borderRadius: 4,
            border: "1px solid #f5c6cb",
          }}
        >
          {error}
        </div>
      )}

      {/* Add Source form */}
      <form
        className="add-form"
        onSubmit={handleAdd}
        style={{ marginBottom: "1.5rem" }}
      >
        <input
          placeholder="Source name *"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          required
          style={{ minWidth: 180 }}
        />
        <input
          placeholder="Obituary page URL *"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          required
          type="url"
          style={{ flex: 1, minWidth: 280 }}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={adding}
        >
          {adding ? "Adding…" : "+ Add Source"}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleScrapeAll}
          disabled={scrapingAll || sources.filter((s) => s.is_active).length === 0}
          style={{ marginLeft: 8 }}
        >
          {scrapingAll ? "Scraping…" : "Scrape All"}
        </button>
      </form>

      {/* Sources table */}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>URL</th>
            <th>Type</th>
            <th>Status</th>
            <th>Last Scraped</th>
            <th>Last Count</th>
            <th>Last Error</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sources.length === 0 ? (
            <tr>
              <td colSpan={8} style={{ textAlign: "center", padding: 24 }}>
                No scraping sources configured yet. Add one above.
              </td>
            </tr>
          ) : (
            sources.map((s) => (
              <tr
                key={s.id}
                style={{ opacity: s.is_active ? 1 : 0.6 }}
              >
                <td>
                  {editId === s.id ? (
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      style={{ width: "100%" }}
                    />
                  ) : (
                    s.name
                  )}
                </td>
                <td style={{ maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {editId === s.id ? (
                    <input
                      value={editUrl}
                      onChange={(e) => setEditUrl(e.target.value)}
                      style={{ width: "100%" }}
                    />
                  ) : (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={s.url}
                    >
                      {s.url.length > 40
                        ? s.url.substring(0, 40) + "…"
                        : s.url}
                    </a>
                  )}
                </td>
                <td>{s.source_type}</td>
                <td>{s.is_active ? "Active" : "Paused"}</td>
                <td>
                  {s.last_scraped_at
                    ? new Date(s.last_scraped_at).toLocaleDateString()
                    : "Never"}
                </td>
                <td>{s.last_scrape_count}</td>
                <td
                  style={{
                    maxWidth: 150,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: s.last_error ? "#dc3545" : undefined,
                  }}
                  title={s.last_error || undefined}
                >
                  {s.last_error || "—"}
                </td>
                <td>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {editId === s.id ? (
                      <>
                        <button
                          className="btn btn-primary"
                          onClick={() => saveEdit(s.id)}
                          style={{ fontSize: "0.8rem", padding: "2px 8px" }}
                        >
                          Save
                        </button>
                        <button
                          className="btn"
                          onClick={cancelEdit}
                          style={{ fontSize: "0.8rem", padding: "2px 8px" }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn btn-primary"
                          onClick={() => handleScrape(s.id)}
                          disabled={scrapingId === s.id}
                          style={{ fontSize: "0.8rem", padding: "2px 8px" }}
                        >
                          {scrapingId === s.id ? "Scraping…" : "Scrape Now"}
                        </button>
                        <button
                          className="btn"
                          onClick={() => startEdit(s)}
                          style={{ fontSize: "0.8rem", padding: "2px 8px" }}
                        >
                          Edit
                        </button>
                        <button
                          className="btn"
                          onClick={() => toggleActive(s)}
                          style={{ fontSize: "0.8rem", padding: "2px 8px" }}
                        >
                          {s.is_active ? "Pause" : "Resume"}
                        </button>
                        <button
                          className="btn btn-danger"
                          onClick={() => handleDelete(s.id)}
                          style={{ fontSize: "0.8rem", padding: "2px 8px" }}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </>
  );
}
