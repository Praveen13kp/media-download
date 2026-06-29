import path from "node:path";
import express from "express";
import rateLimit from "express-rate-limit";
import { createJob, getJob, listJobs, controlJob, retryJob, jobEvents } from "../services/jobs.js";
import { requireAuth, validateDownloadRequest } from "../services/validation.js";
import { storageDir } from "../services/storage.js";

const uuidRegex = /^[a-f0-9-]{36}$/;
const allowedActions = new Set(["pause", "resume", "cancel"]);

export const downloadsRouter = express.Router();

const createLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many download requests, please try again later" }
});

downloadsRouter.get("/", requireAuth, (_req, res) => {
  res.json({ downloads: listJobs() });
});

downloadsRouter.post("/", createLimiter, requireAuth, (req, res, next) => {
  try {
    validateDownloadRequest(req.body);
    const job = createJob(req.body);
    res.status(202).json(job);
  } catch (error) {
    next(error);
  }
});

function validateId(req, res, next) {
  if (!uuidRegex.test(req.params.id)) {
    return res.status(400).json({ error: "Invalid download ID" });
  }
  next();
}

downloadsRouter.get("/:id", requireAuth, validateId, (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Download not found" });
  res.json(job);
});

downloadsRouter.get("/:id/events", requireAuth, validateId, (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).end();
  jobEvents(req.params.id, req, res);
});

for (const action of [...allowedActions]) {
  downloadsRouter.post(`/:id/${action}`, requireAuth, validateId, (req, res) => {
    const job = controlJob(req.params.id, action);
    if (!job) return res.status(404).json({ error: "Download not found" });
    res.json(job);
  });
}

downloadsRouter.post("/:id/retry", requireAuth, validateId, (req, res) => {
  const job = retryJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Download not found" });
  res.status(202).json(job);
});

const MIME_TYPES = {
  mp4: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  opus: "audio/opus",
  wav: "audio/wav",
  flac: "audio/flac",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif"
};

downloadsRouter.get("/:id/file", requireAuth, validateId, (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Download not found" });
  if (!job.outputPath) return res.status(409).json({ error: "File is not ready" });

  const resolved = path.resolve(job.outputPath);
  const allowedDir = path.resolve(storageDir());
  if (!resolved.startsWith(allowedDir)) {
    return res.status(403).json({ error: "Access denied" });
  }

  const ext = path.extname(job.fileName).replace(".", "").toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  res.setHeader("Content-Type", contentType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.download(resolved, job.fileName);
});
