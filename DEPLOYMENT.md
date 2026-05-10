# CryptoGuard — Deployment Guide

## Architecture
- **Frontend** (Vercel): Static HTML/CSS/JS dashboard
- **Backend** (Render): FastAPI REST API serving ML pipeline data

---

## Step 1: Push to GitHub

```bash
cd d:\CapstoneProject
git init
git add backend/ frontend/ render.yaml .gitignore DEPLOYMENT.md
git commit -m "CryptoGuard: production deployment"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/cryptoguard.git
git push -u origin main
```

### What gets pushed:
```
backend/          → API code + CSV data
frontend/         → Dashboard files
render.yaml       → Render config
.gitignore        → Exclusion rules
DEPLOYMENT.md     → This file
```

---

## Step 2: Deploy Backend on Render

1. Go to [render.com](https://render.com) → Sign in with GitHub
2. Click **New → Web Service**
3. Connect your `cryptoguard` repository
4. Settings:
   - **Name**: `cryptoguard-api`
   - **Root Directory**: `backend`
   - **Runtime**: Python
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn api_app:app -w 2 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:$PORT --timeout 120`
   - **Plan**: Free
5. Add Environment Variable:
   - `FRONTEND_URL` = `https://your-project.vercel.app` (update after Vercel deploy)
6. Click **Create Web Service**
7. Wait for deploy (~3-5 min). Copy the URL (e.g. `https://cryptoguard-api.onrender.com`)
8. Test: visit `https://cryptoguard-api.onrender.com/health`

---

## Step 3: Deploy Frontend on Vercel

1. Go to [vercel.com](https://vercel.com) → Sign in with GitHub
2. Click **Add New → Project**
3. Import your `cryptoguard` repository
4. Settings:
   - **Framework Preset**: Other
   - **Root Directory**: `frontend`
   - **Build Command**: (leave empty)
   - **Output Directory**: `.`
5. Click **Deploy**
6. Copy your Vercel URL (e.g. `https://cryptoguard.vercel.app`)

---

## Step 4: Connect Frontend ↔ Backend

### Update frontend config:
Edit `frontend/config.js` and set your Render URL:
```javascript
window.__CRYPTOGUARD_API__ = 'https://cryptoguard-api.onrender.com';
```
Commit and push — Vercel auto-redeploys.

### Update backend CORS:
In Render dashboard → Environment → set:
```
FRONTEND_URL = https://cryptoguard.vercel.app
```
Click **Save** — Render auto-redeploys.

---

## Environment Variables Summary

### Render (Backend)
| Variable | Value |
|---|---|
| `FRONTEND_URL` | `https://your-project.vercel.app` |
| `PYTHON_VERSION` | `3.11.6` |

### Vercel (Frontend)
No env vars needed. API URL is in `config.js`.

---

## Local Development

### Run Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn api_app:app --reload --port 8000
```

### Run Frontend
Edit `frontend/config.js`:
```javascript
window.__CRYPTOGUARD_API__ = 'http://localhost:8000';
```
Then open `frontend/index.html` in your browser, or use VS Code Live Server.

---

## Free Tier Notes

- **Render free tier** spins down after 15 min idle. First visit takes ~30-60s (cold start). The frontend has built-in retry logic for this.
- **Vercel free tier** has no sleep — frontend always loads instantly.
- CSV data files are committed to the repo, so they survive Render redeploys.
