import React, { useEffect, useState, useRef, useMemo } from "react";

/**
 * Compress an image file to fit under maxSizeMB using the Canvas API.
 * Returns the original file if already under the limit.
 */
async function compressImage(
  file: File,
  maxSizeMB = 0.95,
  maxDimension = 1920
): Promise<File> {
  const maxBytes = maxSizeMB * 1024 * 1024;

  // Already small enough — return as-is
  if (file.size <= maxBytes) return file;

  // Load image into an HTMLImageElement
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = (_e) => reject(new Error("Failed to load image for compression"));
    image.src = URL.createObjectURL(file);
  });

  // Determine scaled dimensions (fit within maxDimension on longest side)
  let { width, height } = img;
  if (width > maxDimension || height > maxDimension) {
    const scale = maxDimension / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  // Draw onto canvas
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(img, 0, 0, width, height);

  // Revoke the temporary object URL
  URL.revokeObjectURL(img.src);

  // Export as JPEG, iteratively reducing quality until under the limit
  const qualitySteps = [0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2];
  for (const quality of qualitySteps) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );
    if (blob && blob.size <= maxBytes) {
      const compressedName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
      return new File([blob], compressedName, { type: "image/jpeg" });
    }
  }

  // If still too large after lowest quality, scale down further and try once more
  const smallerScale = 0.5;
  canvas.width = Math.round(width * smallerScale);
  canvas.height = Math.round(height * smallerScale);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const finalBlob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.5)
  );
  if (finalBlob) {
    const compressedName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([finalBlob], compressedName, { type: "image/jpeg" });
  }

  // Fallback: return original
  return file;
}

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

const ADD_NEW_SENTINEL = "__ADD_NEW__";

export function MonumentsPage() {
  // ---- Monument list state ----
  const [monuments, setMonuments] = useState<Monument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- Upload form state ----
  const [cemeterySelect, setCemeterySelect] = useState("");
  const [newCemeteryName, setNewCemeteryName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Derived: unique cemetery names ----
  const cemeteryNames = useMemo(() => {
    const names = new Set<string>();
    monuments.forEach((m) => {
      if (m.cemetery_name) names.add(m.cemetery_name);
    });
    return Array.from(names).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }, [monuments]);

  // ---- Derived: effective cemetery name ----
  const effectiveCemeteryName =
    cemeterySelect === ADD_NEW_SENTINEL
      ? newCemeteryName.trim()
      : cemeterySelect;

  const canSubmit =
    effectiveCemeteryName.length > 0 && selectedFile !== null && !uploading && !compressing;

  // ---- Fetch monuments ----
  const fetchMonuments = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/monuments`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Request failed: ${res.status} ${text}`);
      }
      const data: Monument[] = await res.json();
      setMonuments(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMonuments();
  }, []);

  // ---- File selection handler ----
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.files?.[0] ?? null;
    // Clear success/error when user picks a new file
    setSuccessMsg(null);
    setUploadError(null);

    if (!raw) {
      setSelectedFile(null);
      setPreviewUrl(null);
      return;
    }

    // Compress large images before storing in state
    setCompressing(true);
    try {
      const file = await compressImage(raw);
      setSelectedFile(file);
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } catch {
      // Compression failed — fall back to original file
      setSelectedFile(raw);
      const url = URL.createObjectURL(raw);
      setPreviewUrl(url);
    } finally {
      setCompressing(false);
    }
  };

  const clearFile = () => {
    setSelectedFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    // Reset file inputs so the same file can be re-selected
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ---- Submit ----
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !selectedFile) return;

    setUploading(true);
    setUploadError(null);
    setSuccessMsg(null);

    try {
      const formData = new FormData();
      formData.append("cemetery_name", effectiveCemeteryName);
      formData.append("file", selectedFile);

      const res = await fetch(`${API_BASE}/api/monuments/from-photo`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Upload failed: ${res.status} ${text}`);
      }

      // Success — reset form and refresh list
      clearFile();
      setCemeterySelect("");
      setNewCemeteryName("");
      setSuccessMsg("Monument created successfully!");
      await fetchMonuments();
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  // ---- Auto-dismiss success message ----
  useEffect(() => {
    if (!successMsg) return;
    const timer = setTimeout(() => setSuccessMsg(null), 4000);
    return () => clearTimeout(timer);
  }, [successMsg]);

  // ---- Styles (inline, consistent with existing page) ----
  const formContainerStyle: React.CSSProperties = {
    border: "1px solid #ddd",
    borderRadius: 8,
    padding: "1.25rem",
    marginBottom: "1.5rem",
    background: "#fafafa",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontWeight: 600,
    marginBottom: "0.25rem",
    fontSize: "0.9rem",
  };

  const fieldGroupStyle: React.CSSProperties = {
    marginBottom: "1rem",
  };

  const selectStyle: React.CSSProperties = {
    padding: "0.4rem 0.5rem",
    borderRadius: 4,
    border: "1px solid #ccc",
    fontSize: "0.9rem",
    width: "100%",
    maxWidth: 320,
  };

  const inputStyle: React.CSSProperties = {
    padding: "0.4rem 0.5rem",
    borderRadius: 4,
    border: "1px solid #ccc",
    fontSize: "0.9rem",
    width: "100%",
    maxWidth: 320,
    marginTop: "0.35rem",
  };

  const btnStyle: React.CSSProperties = {
    padding: "0.45rem 1rem",
    borderRadius: 4,
    border: "1px solid #ccc",
    cursor: "pointer",
    fontSize: "0.9rem",
    background: "#fff",
  };

  const btnPrimaryStyle: React.CSSProperties = {
    ...btnStyle,
    background: "#2563eb",
    color: "#fff",
    border: "1px solid #2563eb",
    fontWeight: 600,
  };

  const thStyle: React.CSSProperties = {
    borderBottom: "1px solid #ccc",
    textAlign: "left" as const,
  };

  // ---- Render ----
  return (
    <div style={{ padding: "1rem" }}>
      <h1>Monuments</h1>

      {/* ==================== Upload Form ==================== */}
      <form onSubmit={handleSubmit} style={formContainerStyle}>
        <h2 style={{ marginTop: 0, marginBottom: "1rem", fontSize: "1.1rem" }}>
          Upload Monument Photo
        </h2>

        {/* Cemetery selector */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle} htmlFor="cemetery-select">
            Cemetery
          </label>
          <select
            id="cemetery-select"
            value={cemeterySelect}
            onChange={(e) => {
              setCemeterySelect(e.target.value);
              if (e.target.value !== ADD_NEW_SENTINEL) {
                setNewCemeteryName("");
              }
            }}
            style={selectStyle}
          >
            <option value="" disabled>
              — Select cemetery —
            </option>
            {cemeteryNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            <option value={ADD_NEW_SENTINEL}>Add new…</option>
          </select>

          {cemeterySelect === ADD_NEW_SENTINEL && (
            <input
              type="text"
              placeholder="Enter new cemetery name"
              value={newCemeteryName}
              onChange={(e) => setNewCemeteryName(e.target.value)}
              style={inputStyle}
              autoFocus
            />
          )}
        </div>

        {/* Compressing indicator */}
        {compressing && (
          <div
            style={{
              color: "#1d4ed8",
              background: "#eff6ff",
              border: "1px solid #93c5fd",
              borderRadius: 4,
              padding: "0.5rem 0.75rem",
              marginBottom: "1rem",
              fontSize: "0.9rem",
            }}
          >
            Compressing image…
          </div>
        )}

        {/* Photo input buttons */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Photo</label>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {/* Hidden camera input */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              style={{ display: "none" }}
              id="camera-input"
            />
            <button
              type="button"
              style={btnStyle}
              onClick={() => cameraInputRef.current?.click()}
            >
              📷 Take Photo
            </button>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              style={{ display: "none" }}
              id="file-input"
            />
            <button
              type="button"
              style={btnStyle}
              onClick={() => fileInputRef.current?.click()}
            >
              📁 Upload Photo
            </button>
          </div>
        </div>

        {/* Image preview */}
        {selectedFile && previewUrl && (
          <div
            style={{
              ...fieldGroupStyle,
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
            }}
          >
            <img
              src={previewUrl}
              alt="Preview"
              style={{
                width: 80,
                height: 80,
                objectFit: "cover",
                borderRadius: 4,
                border: "1px solid #ccc",
              }}
            />
            <span style={{ fontSize: "0.85rem", color: "#555" }}>
              {selectedFile.name}
            </span>
            <button
              type="button"
              onClick={clearFile}
              style={{
                ...btnStyle,
                padding: "0.2rem 0.6rem",
                fontSize: "0.8rem",
                color: "#b91c1c",
                borderColor: "#b91c1c",
              }}
            >
              ✕ Clear
            </button>
          </div>
        )}

        {/* Feedback messages */}
        {uploadError && (
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
            {uploadError}
          </div>
        )}
        {successMsg && (
          <div
            style={{
              color: "#166534",
              background: "#f0fdf4",
              border: "1px solid #86efac",
              borderRadius: 4,
              padding: "0.5rem 0.75rem",
              marginBottom: "1rem",
              fontSize: "0.9rem",
            }}
          >
            {successMsg}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            ...btnPrimaryStyle,
            opacity: canSubmit ? 1 : 0.5,
            cursor: canSubmit ? "pointer" : "not-allowed",
          }}
        >
          {uploading ? "Processing…" : "Upload & Process"}
        </button>
      </form>

      {/* ==================== Monuments Table ==================== */}
      {loading ? (
        <div>Loading monuments…</div>
      ) : error ? (
        <div>Error loading monuments: {error}</div>
      ) : monuments.length === 0 ? (
        <div>No monuments yet. Try uploading a photo first.</div>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={thStyle}>Cemetery</th>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Born</th>
              <th style={thStyle}>Died</th>
              <th style={thStyle}>Created at</th>
            </tr>
          </thead>
          <tbody>
            {monuments.map((m) => (
              <tr key={m.id}>
                <td style={{ padding: "0.25rem 0.5rem" }}>{m.cemetery_name}</td>
                <td style={{ padding: "0.25rem 0.5rem" }}>
                  {m.deceased_name ?? "—"}
                </td>
                <td style={{ padding: "0.25rem 0.5rem" }}>
                  {m.date_of_birth ?? "—"}
                </td>
                <td style={{ padding: "0.25rem 0.5rem" }}>
                  {m.date_of_death ?? "—"}
                </td>
                <td style={{ padding: "0.25rem 0.5rem" }}>
                  {new Date(m.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
