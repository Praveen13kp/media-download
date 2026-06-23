import dotenv from "dotenv";
import express from "express";
import cors from "cors";
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

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "media-download-api" });
});

app.use("/api/media", mediaRouter);
app.use("/api/downloads", downloadsRouter);
app.use("/storage", express.static(path.resolve(__dirname, "../storage")));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

app.listen(port, () => {
  console.log(`Media Download API listening on http://localhost:${port}`);
});
