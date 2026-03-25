import React, { useEffect, useState, useRef, useMemo } from "react";
import { authFetch } from "../auth";

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
  photo_url: string | null;
  created_at: string;
};

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

  // ---- Manual add form state ----
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualCemetery, setManualCemetery] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualDob, setManualDob] = useState("");
  const [manualDod, setManualDod] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  // ---- Edit state ----
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState({
    cemetery_name: "",
    deceased_name: "",
    date_of_birth: "",
    date_of_death: "",
    notes: "",
  });
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  // ---- Re-OCR state ----
  const [reOcrId, setReOcrId] = useState<string | null>(null);
  const [reOcrSubmitting, setReOcrSubmitting] = useState(false);
  const reOcrInputRef = useRef<HTMLInputElement>(null);

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
      const res = await authFetch("/api/monuments");
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

  // ---- Submit photo upload ----
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

      const res = await authFetch("/api/monuments/from-photo", {
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

  // ---- Manual add submit ----
  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCemetery.trim()) return;
    setManualSubmitting(true);
    setManualError(null);
    try {
      const res = await authFetch("/api/monuments/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cemetery_name: manualCemetery.trim(),
          deceased_name: manualName.trim() || null,
          date_of_birth: manualDob || null,
          date_of_death: manualDod || null,
          notes: manualNotes || null,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed: ${res.status} ${text}`);
      }
      setShowManualForm(false);
      setManualCemetery("");
      setManualName("");
      setManualDob("");
      setManualDod("");
      setManualNotes("");
      setSuccessMsg("Monument added manually!");
      await fetchMonuments();
    } catch (err: unknown) {
      setManualError(err instanceof Error ? err.message : String(err));
    } finally {
      setManualSubmitting(false);
    }
  };

  // ---- Delete ----
  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this monument?")) return;
    try {
      const res = await authFetch(`/api/monuments/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        throw new Error("Delete failed");
      }
      await fetchMonuments();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  };

  // ---- Edit ----
  const startEdit = (m: Monument) => {
    setEditingId(m.id);
    setEditFields({
      cemetery_name: m.cemetery_name,
      deceased_name: m.deceased_name ?? "",
      date_of_birth: m.date_of_birth ?? "",
      date_of_death: m.date_of_death ?? "",
      notes: m.notes ?? "",
    });
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditError(null);
  };

  const handleEditSave = async () => {
    if (!editingId) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await authFetch(`/api/monuments/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cemetery_name: editFields.cemetery_name,
          deceased_name: editFields.deceased_name || null,
          date_of_birth: editFields.date_of_birth || null,
          date_of_death: editFields.date_of_death || null,
          notes: editFields.notes,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Save failed: ${res.status} ${text}`);
      }
      setEditingId(null);
      await fetchMonuments();
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditSaving(false);
    }
  };

  // ---- Re-OCR ----
  const handleReOcrClick = (id: string) => {
    setReOcrId(id);
    // Trigger file picker after state update
    setTimeout(() => reOcrInputRef.current?.click(), 0);
  };

  const handleReOcrFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.files?.[0];
    if (!raw || !reOcrId) return;
    setReOcrSubmitting(true);
    try {
      const file = await compressImage(raw);
      const formData = new FormData();
      formData.append("file", file);
      const res = await authFetch(`/api/monuments/${reOcrId}/re-ocr`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Re-OCR failed: ${res.status} ${text}`);
      }
      setSuccessMsg("Photo re-uploaded and OCR re-processed!");
      await fetchMonuments();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Re-OCR failed");
    } finally {
      setReOcrSubmitting(false);
      setReOcrId(null);
      if (reOcrInputRef.current) reOcrInputRef.current.value = "";
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

  const btnDangerStyle: React.CSSProperties = {
    ...btnStyle,
    color: "#b91c1c",
    borderColor: "#b91c1c",
    fontSize: "0.8rem",
    padding: "0.3rem 0.6rem",
  };

  const editInputStyle: React.CSSProperties = {
    padding: "0.3rem 0.5rem",
    borderRadius: 4,
    border: "1px solid #ccc",
    fontSize: "0.85rem",
    width: "100%",
  };

  const thStyle: React.CSSProperties = {
    borderBottom: "1px solid #ccc",
    textAlign: "left" as const,
  };

  // ---- Render ----
  return (
    <div style={{ padding: "1rem" }}>
      <h1>Monuments</h1>

      {/* Hidden re-OCR file input */}
      <input
        ref={reOcrInputRef}
        type="file"
        accept="image/*"
        onChange={handleReOcrFile}
        style={{ display: "none" }}
      />

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
              Take Photo
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
              Upload Photo
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
              Clear
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

      {/* ==================== Manual Add Button / Form ==================== */}
      {!showManualForm ? (
        <div style={{ marginBottom: "1.5rem" }}>
          <button style={btnStyle} onClick={() => setShowManualForm(true)}>
            + Add Manually (no photo)
          </button>
        </div>
      ) : (
        <form onSubmit={handleManualSubmit} style={formContainerStyle}>
          <h2 style={{ marginTop: 0, marginBottom: "1rem", fontSize: "1.1rem" }}>
            Add Monument Manually
          </h2>
          <div style={fieldGroupStyle}>
            <label style={labelStyle}>Cemetery *</label>
            <input
              type="text"
              value={manualCemetery}
              onChange={(e) => setManualCemetery(e.target.value)}
              required
              style={{ ...inputStyle, marginTop: 0 }}
            />
          </div>
          <div style={fieldGroupStyle}>
            <label style={labelStyle}>Deceased Name</label>
            <input
              type="text"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              style={{ ...inputStyle, marginTop: 0 }}
            />
          </div>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            <div>
              <label style={labelStyle}>Date of Birth</label>
              <input
                type="text"
                placeholder="e.g. 1940"
                value={manualDob}
                onChange={(e) => setManualDob(e.target.value)}
                style={{ ...inputStyle, marginTop: 0, maxWidth: 160 }}
              />
            </div>
            <div>
              <label style={labelStyle}>Date of Death</label>
              <input
                type="text"
                placeholder="e.g. 2020"
                value={manualDod}
                onChange={(e) => setManualDod(e.target.value)}
                style={{ ...inputStyle, marginTop: 0, maxWidth: 160 }}
              />
            </div>
          </div>
          <div style={fieldGroupStyle}>
            <label style={labelStyle}>Notes</label>
            <textarea
              value={manualNotes}
              onChange={(e) => setManualNotes(e.target.value)}
              rows={3}
              style={{ ...inputStyle, marginTop: 0, maxWidth: "100%", resize: "vertical" }}
            />
          </div>
          {manualError && (
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
              {manualError}
            </div>
          )}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="submit" disabled={manualSubmitting} style={btnPrimaryStyle}>
              {manualSubmitting ? "Saving…" : "Save"}
            </button>
            <button type="button" style={btnStyle} onClick={() => setShowManualForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* ==================== Re-OCR loading indicator ==================== */}
      {reOcrSubmitting && (
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
          Re-processing OCR…
        </div>
      )}

      {/* ==================== Monuments Table ==================== */}
      {loading ? (
        <div>Loading monuments…</div>
      ) : error ? (
        <div>Error loading monuments: {error}</div>
      ) : monuments.length === 0 ? (
        <div>No monuments yet. Try uploading a photo or adding manually.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={thStyle}>Photo</th>
                <th style={thStyle}>Cemetery</th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Born</th>
                <th style={thStyle}>Died</th>
                <th style={thStyle}>Notes</th>
                <th style={thStyle}>Created</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {monuments.map((m) =>
                editingId === m.id ? (
                  <tr key={m.id} style={{ background: "#fffbeb" }}>
                    <td style={{ padding: "0.5rem" }}>
                      {m.photo_url && (
                        <img
                          src={`/api/monuments/${m.id}/photo`}
                          alt="Monument"
                          style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 4 }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      )}
                    </td>
                    <td style={{ padding: "0.5rem" }}>
                      <input
                        style={editInputStyle}
                        value={editFields.cemetery_name}
                        onChange={(e) =>
                          setEditFields((f) => ({ ...f, cemetery_name: e.target.value }))
                        }
                      />
                    </td>
                    <td style={{ padding: "0.5rem" }}>
                      <input
                        style={editInputStyle}
                        value={editFields.deceased_name}
                        onChange={(e) =>
                          setEditFields((f) => ({ ...f, deceased_name: e.target.value }))
                        }
                      />
                    </td>
                    <td style={{ padding: "0.5rem" }}>
                      <input
                        style={editInputStyle}
                        value={editFields.date_of_birth}
                        onChange={(e) =>
                          setEditFields((f) => ({ ...f, date_of_birth: e.target.value }))
                        }
                      />
                    </td>
                    <td style={{ padding: "0.5rem" }}>
                      <input
                        style={editInputStyle}
                        value={editFields.date_of_death}
                        onChange={(e) =>
                          setEditFields((f) => ({ ...f, date_of_death: e.target.value }))
                        }
                      />
                    </td>
                    <td style={{ padding: "0.5rem" }}>
                      <textarea
                        style={{ ...editInputStyle, resize: "vertical" }}
                        rows={2}
                        value={editFields.notes}
                        onChange={(e) =>
                          setEditFields((f) => ({ ...f, notes: e.target.value }))
                        }
                      />
                    </td>
                    <td style={{ padding: "0.5rem", fontSize: "0.8rem" }}>
                      {new Date(m.created_at).toLocaleString()}
                    </td>
                    <td style={{ padding: "0.5rem" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                        <button
                          style={{ ...btnPrimaryStyle, fontSize: "0.8rem", padding: "0.3rem 0.6rem" }}
                          onClick={handleEditSave}
                          disabled={editSaving}
                        >
                          {editSaving ? "Saving…" : "Save"}
                        </button>
                        <button
                          style={{ ...btnStyle, fontSize: "0.8rem", padding: "0.3rem 0.6rem" }}
                          onClick={cancelEdit}
                        >
                          Cancel
                        </button>
                        {editError && (
                          <span style={{ color: "#b91c1c", fontSize: "0.75rem" }}>{editError}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={m.id}>
                    <td style={{ padding: "0.25rem 0.5rem" }}>
                      {m.photo_url ? (
                        <img
                          src={`/api/monuments/${m.id}/photo`}
                          alt="Monument"
                          style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 4, display: "block" }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : (
                        <span style={{ color: "#999", fontSize: "0.8rem" }}>No photo</span>
                      )}
                    </td>
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
                    <td style={{ padding: "0.25rem 0.5rem", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.notes || "—"}
                    </td>
                    <td style={{ padding: "0.25rem 0.5rem" }}>
                      {new Date(m.created_at).toLocaleString()}
                    </td>
                    <td style={{ padding: "0.25rem 0.5rem" }}>
                      <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                        <button style={{ ...btnStyle, fontSize: "0.8rem", padding: "0.3rem 0.6rem" }} onClick={() => startEdit(m)}>
                          Edit
                        </button>
                        {m.photo_url && (
                          <button
                            style={{ ...btnStyle, fontSize: "0.8rem", padding: "0.3rem 0.6rem" }}
                            onClick={() => handleReOcrClick(m.id)}
                            disabled={reOcrSubmitting}
                          >
                            Re-upload
                          </button>
                        )}
                        <button style={btnDangerStyle} onClick={() => handleDelete(m.id)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
