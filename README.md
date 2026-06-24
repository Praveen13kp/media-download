# Media Download Manager

Desktop application for downloading media from supported sources.

---

## For Users (Quick Start)

### Option A — Desktop App (Recommended)

1. **Install prerequisites** (one-time):
   - [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation) — `winget install yt-dlp.yt-dlp`
   - [ffmpeg](https://ffmpeg.org/download.html) — `winget install Gyan.FFmpeg`

2. Download the latest **Media Download Manager Setup.exe** from releases.
   Install it (or use the portable version).

3. Open the app, paste a video URL, click Analyze, pick options, click **Start Download**.

> The app handles everything — no browser tabs, no extensions needed.

### Option B — Browser (Dev)

```bash
npm install
npm run dev:backend   # Terminal 1: API server on http://localhost:4000
npm run dev:web       # Terminal 2: Web UI on http://localhost:5173
```

Open `http://localhost:5173` in Chrome.

### Option C — One-click script

Double-click **`start.bat`** (or right-click **`start.ps1`** → Run with PowerShell).
It checks prerequisites, installs deps, and opens the app in your browser.

---

## For Developers

```bash
npm install
npm run dev:backend   # API at http://localhost:4000
npm run dev:web       # UI at http://localhost:5173
npm run dev:desktop   # Electron app (dev mode)
```

### Build desktop installer

```bash
npm run package       # Produces .exe in apps/desktop/release/
```

### Security

Set `API_TOKEN=your-secret` in `.env` to require authentication on all API requests.
See `.env.example` for all config options.

---

## Architecture

| Package | Description |
|---------|-------------|
| `packages/backend` | Node.js + Express API, yt-dlp/ffmpeg processing |
| `apps/web` | React + Tailwind UI for URL analysis and downloads |
| `apps/desktop` | Electron shell packaging the web UI + backend |

Built with a monorepo (npm workspaces).
