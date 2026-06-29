import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { DOWNLOAD_STATES } from "@media/shared";
import { startDownload } from "./processor.js";
import { persistJob, loadJobs } from "./db.js";

const jobs = new Map();
const events = new EventEmitter();
const maxConcurrent = Number(process.env.MAX_CONCURRENT_DOWNLOADS || 2);
let activeCount = 0;

// Restore persisted jobs on startup (completed/failed history)
loadJobs().then((rows) => {
  for (const job of rows) {
    if (!jobs.has(job.id)) jobs.set(job.id, job);
  }
}).catch((error) => console.error("Failed to load persisted jobs", error));

export function createJob(request) {
  const job = {
    id: randomUUID(),
    request,
    state: DOWNLOAD_STATES.PENDING,
    progress: 0,
    speed: null,
    eta: null,
    fileName: null,
    outputPath: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  jobs.set(job.id, job);
  saveAndEmit(job);
  pumpQueue();
  return publicJob(job);
}

export function listJobs() {
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicJob);
}

export function getJob(id) {
  const job = jobs.get(id);
  return job ? publicJob(job) : null;
}

export function controlJob(id, action) {
  const job = jobs.get(id);
  if (!job) return null;

  if (action === "pause") {
    job.pauseRequested = true;
    if (job.process) job.process.kill();
    else job.state = DOWNLOAD_STATES.PAUSED;
  }

  if (action === "resume" && job.state === DOWNLOAD_STATES.PAUSED) {
    job.pauseRequested = false;
    job.state = DOWNLOAD_STATES.PENDING;
    job.progress = 0;
    pumpQueue();
  }

  if (action === "cancel") {
    job.cancelRequested = true;
    if (job.process) job.process.kill();
    job.state = DOWNLOAD_STATES.CANCELED;
  }

  saveAndEmit(job);
  return publicJob(job);
}

export function retryJob(id) {
  const job = jobs.get(id);
  if (!job) return null;
  if (![DOWNLOAD_STATES.FAILED, DOWNLOAD_STATES.CANCELED].includes(job.state)) return publicJob(job);
  Object.assign(job, {
    state: DOWNLOAD_STATES.PENDING,
    progress: 0,
    speed: null,
    eta: null,
    error: null,
    outputPath: null,
    fileName: null,
    cancelRequested: false,
    pauseRequested: false
  });
  saveAndEmit(job);
  pumpQueue();
  return publicJob(job);
}

export function jobEvents(id, req, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (job) => {
    if (job.id === id) res.write(`data: ${JSON.stringify(publicJob(job))}\n\n`);
  };

  const job = jobs.get(id);
  if (job) send(job);
  events.on("job", send);
  req.on("close", () => events.off("job", send));
}

function pumpQueue() {
  if (activeCount >= maxConcurrent) return;
  const next = [...jobs.values()].find((job) => job.state === DOWNLOAD_STATES.PENDING);
  if (!next) return;

  activeCount += 1;
  startDownload(next, (job) => {
    saveAndEmit(job);
    if (isTerminal(job.state) || job.state === DOWNLOAD_STATES.PAUSED) {
      activeCount = Math.max(0, activeCount - 1);
      setImmediate(pumpQueue);
    }
  }).catch((error) => {
    console.error("startDownload failed:", error);
    activeCount = Math.max(0, activeCount - 1);
    next.state = DOWNLOAD_STATES.FAILED;
    next.error = error.message;
    saveAndEmit(next);
    setImmediate(pumpQueue);
  });
}

function saveAndEmit(job) {
  persistJob(publicJob(job)).catch((error) => console.error("Failed to persist job", error));
  events.emit("job", job);
}

function isTerminal(state) {
  return [DOWNLOAD_STATES.COMPLETED, DOWNLOAD_STATES.FAILED, DOWNLOAD_STATES.CANCELED].includes(state);
}

function publicJob(job) {
  const { process, request, ...rest } = job;
  const safeRequest = request ? { ...request, cookies: request.cookies ? "[REDACTED]" : null } : request;
  return { ...rest, request: safeRequest };
}

