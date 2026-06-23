import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Download, FileAudio, FileVideo, History, Link, Pause, Play, RotateCcw, Search, Square, X } from "lucide-react";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";
const API_TOKEN = import.meta.env.VITE_API_TOKEN || "";

function apiHeaders() {
  return {
    "Content-Type": "application/json",
    ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {})
  };
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...apiHeaders(), ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function App() {
  const [url, setUrl] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [downloads, setDownloads] = useState([]);
  const [selected, setSelected] = useState({ type: "video", quality: "1080p", format: "mp4" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [downloadFolder, setDownloadFolder] = useState(null);

  useEffect(() => {
    refreshDownloads();
    const timer = setInterval(refreshDownloads, 3000);
    return () => clearInterval(timer);
  }, []);

  const qualities = useMemo(() => {
    const values = analysis?.videoQualities?.length ? analysis.videoQualities : ["144p", "240p", "360p", "480p", "720p", "1080p", "best"];
    return [...new Set([...values, "best"])];
  }, [analysis]);

  async function refreshDownloads() {
    try {
      const data = await api("/api/downloads");
      setDownloads(data.downloads || []);
    } catch {
      // The backend may not be running while the UI is being designed.
    }
  }

  async function analyze() {
    setError("");
    setLoading(true);
    try {
      const data = await api("/api/media/analyze", {
        method: "POST",
        body: JSON.stringify({ url })
      });
      setAnalysis(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function startDownload() {
    setError("");
    try {
      const body = { url, ...selected };
      if (downloadFolder) body.outputDir = downloadFolder;
      const job = await api("/api/downloads", {
        method: "POST",
        body: JSON.stringify(body)
      });
      setDownloads((current) => [job, ...current]);
      subscribe(job.id);
    } catch (err) {
      setError(err.message);
    }
  }

  function subscribe(id) {
    const source = new EventSource(`${API_BASE}/api/downloads/${id}/events${API_TOKEN ? `?token=${API_TOKEN}` : ""}`);
    source.onmessage = (event) => {
      const job = JSON.parse(event.data);
      setDownloads((current) => current.map((item) => (item.id === job.id ? job : item)));
      if (["Completed", "Failed", "Canceled"].includes(job.state)) source.close();
    };
    source.onerror = () => source.close();
  }

  async function control(id, action) {
    const job = await api(`/api/downloads/${id}/${action}`, { method: "POST" });
    setDownloads((current) => current.map((item) => (item.id === id ? job : item)));
  }

  return (
    <main className="min-h-screen bg-surface text-ink">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="space-y-6">
          <div className="rounded-lg border border-line bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row">
              <label className="flex min-h-11 flex-1 items-center gap-2 rounded-md border border-line px-3">
                <Link size={18} />
                <input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="Paste a supported video URL"
                  className="w-full bg-transparent text-sm outline-none"
                />
              </label>
              <button onClick={analyze} disabled={!url || loading} className="button primary">
                <Search size={18} />
                Analyze
              </button>
            </div>
            {window.desktop && (
              <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
                <button
                  className="button small"
                  onClick={async () => {
                    const folder = await window.desktop.chooseDownloadFolder();
                    if (folder) setDownloadFolder(folder);
                  }}
                >
                  Choose folder
                </button>
                <span className="truncate">{downloadFolder || "Default storage folder"}</span>
              </div>
            )}
            {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          </div>

          <ResultPanel
            analysis={analysis}
            selected={selected}
            setSelected={setSelected}
            qualities={qualities}
            startDownload={startDownload}
          />
        </section>

        <aside className="space-y-6">
          <DownloadQueue downloads={downloads} control={control} apiBase={API_BASE} token={API_TOKEN} />
          <HistoryPanel downloads={downloads} apiBase={API_BASE} token={API_TOKEN} />
        </aside>
      </div>
    </main>
  );
}

function ResultPanel({ analysis, selected, setSelected, qualities, startDownload }) {
  if (!analysis) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-white p-8 text-center text-sm text-slate-500">
        Analyze a URL to see title, thumbnail, duration, available streams, and estimated sizes.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-white p-5 shadow-sm">
      <div className="grid gap-5 md:grid-cols-[240px_minmax(0,1fr)]">
        <img src={analysis.thumbnail} alt="" className="aspect-video w-full rounded-md bg-slate-100 object-cover" />
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{analysis.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{formatDuration(analysis.duration)}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Selector
              label="Mode"
              value={selected.type}
              onChange={(type) => setSelected((current) => ({ ...current, type, format: type === "audio" ? "mp3" : "mp4" }))}
              options={[
                { value: "video", label: "Video + Audio" },
                { value: "video-only", label: "Video Only" },
                { value: "audio", label: "Audio Only" }
              ]}
            />
            <Selector
              label="Quality"
              value={selected.quality}
              onChange={(quality) => setSelected((current) => ({ ...current, quality }))}
              options={(selected.type === "audio" ? ["best"] : qualities).map((quality) => ({ value: quality, label: quality }))}
            />
            <Selector
              label="Format"
              value={selected.format}
              onChange={(format) => setSelected((current) => ({ ...current, format }))}
              options={(selected.type === "audio" ? ["mp3", "m4a", "opus", "webm"] : ["mp4", "webm", "mkv"]).map((format) => ({
                value: format,
                label: format.toUpperCase()
              }))}
            />
          </div>
          <button onClick={startDownload} className="button primary mt-5">
            <Download size={18} />
            Start Download
          </button>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-md border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2">Quality</th>
              <th className="px-3 py-2">Format</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Size</th>
            </tr>
          </thead>
          <tbody>
            {analysis.formats.slice(0, 12).map((format) => (
              <tr key={format.id} className="border-t border-line">
                <td className="px-3 py-2">{format.qualityLabel}</td>
                <td className="px-3 py-2">{format.ext}</td>
                <td className="px-3 py-2">{format.hasVideo && format.hasAudio ? "Video + Audio" : format.hasVideo ? "Video" : "Audio"}</td>
                <td className="px-3 py-2">{formatBytes(format.size)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Selector({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-line bg-white px-3 text-sm">
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function DownloadQueue({ downloads, control, apiBase, token }) {
  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Download size={18} />
        <h2 className="font-semibold">Download Queue</h2>
      </div>
      <div className="space-y-3">
        {downloads.length === 0 && <p className="text-sm text-slate-500">No downloads yet.</p>}
        {downloads.map((job) => (
          <article key={job.id} className="rounded-md border border-line p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{job.fileName || job.request.url}</p>
                <p className="text-xs text-slate-500">{job.state} {job.speed ? `- ${job.speed}` : ""} {job.eta ? `- ETA ${job.eta}` : ""}</p>
              </div>
              <JobIcon type={job.request.type} />
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full bg-accent" style={{ width: `${Math.min(job.progress || 0, 100)}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {job.state === "Paused" ? (
                <button className="icon-button" onClick={() => control(job.id, "resume")} title="Resume"><Play size={15} /></button>
              ) : ["Pending", "Fetching information", "Processing", "Converting", "Downloading"].includes(job.state) ? (
                <button className="icon-button" onClick={() => control(job.id, "pause")} title="Pause"><Pause size={15} /></button>
              ) : null}
              {!["Completed", "Failed", "Canceled"].includes(job.state) && (
                <button className="icon-button" onClick={() => control(job.id, "cancel")} title="Cancel"><Square size={15} /></button>
              )}
              {["Failed", "Canceled"].includes(job.state) && (
                <button className="icon-button" onClick={() => control(job.id, "retry")} title="Retry"><RotateCcw size={15} /></button>
              )}
              {job.state === "Completed" && (
                <>
                  <a className="button small" href={`${apiBase}/api/downloads/${job.id}/file${token ? `?token=${token}` : ""}`}>
                    <Download size={15} />
                    Save
                  </a>
                  {window.desktop && job.outputPath && (
                    <button className="button small" onClick={() => window.desktop.openPath(job.outputPath)}>
                      Open
                    </button>
                  )}
                </>
              )}
            </div>
            {job.error && <p className="mt-2 text-xs text-red-600">{job.error}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}

function HistoryPanel({ downloads, apiBase, token }) {
  const completed = downloads.filter((job) => job.state === "Completed");
  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <History size={18} />
        <h2 className="font-semibold">History</h2>
      </div>
      <div className="space-y-2">
        {completed.length === 0 && <p className="text-sm text-slate-500">Completed files appear here.</p>}
        {completed.map((job) => (
          <a key={job.id} href={`${apiBase}/api/downloads/${job.id}/file${token ? `?token=${token}` : ""}`} className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm hover:bg-slate-50">
            <JobIcon type={job.request.type} />
            <span className="min-w-0 flex-1 truncate">{job.fileName}</span>
            <Download size={15} />
          </a>
        ))}
      </div>
    </section>
  );
}

function JobIcon({ type }) {
  return type === "audio" ? <FileAudio size={18} className="text-accent" /> : <FileVideo size={18} className="text-accent" />;
}

function formatDuration(seconds) {
  if (!seconds) return "Duration unavailable";
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function formatBytes(bytes) {
  if (!bytes) return "Unknown";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

createRoot(document.getElementById("root")).render(<App />);

