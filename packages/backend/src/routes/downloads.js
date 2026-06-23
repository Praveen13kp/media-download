import express from "express";
import { createJob, getJob, listJobs, controlJob, retryJob, jobEvents } from "../services/jobs.js";
import { requireAuth, validateDownloadRequest } from "../services/validation.js";

export const downloadsRouter = express.Router();

downloadsRouter.get("/", requireAuth, (_req, res) => {
  res.json({ downloads: listJobs() });
});

downloadsRouter.post("/", requireAuth, (req, res, next) => {
  try {
    validateDownloadRequest(req.body);
    const job = createJob(req.body);
    res.status(202).json(job);
  } catch (error) {
    next(error);
  }
});

downloadsRouter.get("/:id", requireAuth, (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Download not found" });
  res.json(job);
});

downloadsRouter.get("/:id/events", requireAuth, (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).end();
  jobEvents(req.params.id, req, res);
});

for (const action of ["pause", "resume", "cancel"]) {
  downloadsRouter.post(`/:id/${action}`, requireAuth, (req, res) => {
    const job = controlJob(req.params.id, action);
    if (!job) return res.status(404).json({ error: "Download not found" });
    res.json(job);
  });
}

downloadsRouter.post("/:id/retry", requireAuth, (req, res) => {
  const job = retryJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Download not found" });
  res.status(202).json(job);
});

downloadsRouter.get("/:id/file", requireAuth, (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Download not found" });
  if (!job.outputPath) return res.status(409).json({ error: "File is not ready" });
  res.download(job.outputPath, job.fileName);
});

