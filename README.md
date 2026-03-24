# obit-crm-lite

A minimal full-stack CRM for tracking obituary events — built for monument
manufacturing businesses in Atlantic Canada.

| Layer    | Stack                         | Directory    |
| -------- | ----------------------------- | ------------ |
| Backend  | Python 3.12 · FastAPI · Uvicorn | `backend/`  |
| Frontend | React 18 · TypeScript · Vite  | `frontend/`  |

---

## Quick start (local)

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev          # opens http://localhost:5173
```

The Vite dev server proxies `/api/*` to `http://localhost:8000` automatically.

---

## API endpoints

| Method   | Path               | Description           |
| -------- | ------------------ | --------------------- |
| `GET`    | `/api/health`      | Health check          |
| `GET`    | `/api/obits`       | List all obits        |
| `GET`    | `/api/obits/{id}`  | Get one obit          |
| `POST`   | `/api/obits`       | Create an obit        |
| `PUT`    | `/api/obits/{id}`  | Update an obit        |
| `DELETE` | `/api/obits/{id}`  | Delete an obit        |

---

## Deploy to Railway

This repo is designed for Railway's monorepo support. Create **two services**
from the same repo:

### 1. Backend service

- **Root directory:** `backend`
- Railway will auto-detect the Python buildpack via `requirements.txt`.
- The `Procfile` tells Railway to run Uvicorn on `$PORT`.

### 2. Frontend service

- **Root directory:** `frontend`
- Railway will auto-detect the Node buildpack via `package.json`.
- Set the environment variable:
  ```
  VITE_API_URL=https://<your-backend-service>.up.railway.app
  ```
- Build command (auto-detected): `npm run build`
- Start command: `npx vite preview --host 0.0.0.0 --port $PORT`

> **Tip:** Add a `nixpacks.toml` in `frontend/` if you want to customize the
> start command:
> ```toml
> [start]
> cmd = "npx vite preview --host 0.0.0.0 --port ${PORT:-3000}"
> ```

---

## Environment variables

See `.env.example` for the full list.

| Variable       | Where    | Purpose                                     |
| -------------- | -------- | ------------------------------------------- |
| `PORT`         | Backend  | Set automatically by Railway                |
| `VITE_API_URL` | Frontend | Backend URL (blank for local dev with proxy) |

---

## License

MIT
