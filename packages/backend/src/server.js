import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mediaRouter } from "./routes/media.js";
import { downloadsRouter } from "./routes/downloads.js";
import { cookiesRouter } from "./routes/cookies.js";
import { ensureStorageDir } from "./services/storage.js";
import { initDb } from "./services/db.js";
import { ensureServerCookies, deleteCookieFile } from "./services/cookies.js";

// Global safety nets: log and continue so a stray async rejection (e.g. from a
// yt-dlp spawn that races shutdown) does not tear down the long-lived Node
// process. Without these, Node 20+ will exit on an unhandled promise rejection.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason && reason.message ? reason.message : reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err && err.message ? err.message : err);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../../..");
dotenv.config({ path: path.join(projectRoot, ".env") });
dotenv.config();

const app = express();
app.set("trust proxy", 1);
const port = Number(process.env.PORT || 4000);

// Materialize the server-side personal cookies (YOUTUBE_COOKIES) before any
// analyze/download requests can be served. Without cookies the API stays in
// anonymous mode and yt-dlp will hit YouTube's bot detection.
await ensureServerCookies();

await ensureStorageDir();
await initDb();

const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim())
  : ["http://localhost:5173", "http://localhost:4173"];

app.use(helmet());
app.use(cors({
  origin: corsOrigins,
  methods: ["GET", "POST"],
  maxAge: 86400
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "media-download-api" });
});

app.use("/api/media", mediaRouter);
app.use("/api/downloads", downloadsRouter);
app.use("/api/cookies", cookiesRouter);
app.use("/storage", express.static(path.resolve(__dirname, "../storage")));

const webDist = path.resolve(projectRoot, "apps/web/dist");
let hasWeb = await fs.promises.stat(path.join(webDist, "index.html")).then(() => true).catch(() => false);

if (!hasWeb) {
  console.log("Building web UI...");
  try {
    execSync("npm run build:web", { cwd: projectRoot, stdio: "inherit", shell: true });
    hasWeb = await fs.promises.stat(path.join(webDist, "index.html")).then(() => true).catch(() => false);
    if (hasWeb) console.log("Web UI built successfully");
  } catch (err) {
    console.error("Web UI build failed:", err.message);
  }
}

if (hasWeb) {
  console.log(`Serving web UI from ${webDist}`);
  app.use(express.static(webDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
} else {
  console.log("Web UI not available — serving API only");
}

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  const message = status === 500 ? "Internal server error" : err.message;
  res.status(status).json({
    success: false,
    error: message,
    message
  });
});

const server = app.listen(port, () => {
  console.log(`Media Download API listening on http://localhost:${port}`);
});

function shutdown() {
  deleteCookieFile();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
