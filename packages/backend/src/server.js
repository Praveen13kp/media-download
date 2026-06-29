import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mediaRouter } from "./routes/media.js";
import { downloadsRouter } from "./routes/downloads.js";
import { ensureStorageDir } from "./services/storage.js";
import { initDb } from "./services/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../../..");
dotenv.config({ path: path.join(projectRoot, ".env") });
dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);

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
app.use("/storage", express.static(path.resolve(__dirname, "../storage")));

const webDist = path.resolve(projectRoot, "apps/web/dist");
const hasWeb = await fs.promises.stat(path.join(webDist, "index.html")).then(() => true).catch(() => false);

if (hasWeb) {
  console.log(`Serving web UI from ${webDist}`);
  app.use(express.static(webDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
} else {
  console.log(`Web dist not found at ${webDist} — serving API only`);
  app.get("/", (_req, res) => {
    res.send(`<!DOCTYPE html><html><body><h1>Media Download API</h1><p>API is running. Web UI not built.</p><p>Health: <a href="/health">/health</a></p></body></html>`);
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({
    error: status === 500 ? "Internal server error" : err.message
  });
});

app.listen(port, () => {
  console.log(`Media Download API listening on http://localhost:${port}`);
});
