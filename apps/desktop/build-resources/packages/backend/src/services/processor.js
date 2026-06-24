import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import { DOWNLOAD_STATES } from "@media/shared";
import { safeFileName, storageDir } from "./storage.js";

const ANALYZE_TIMEOUT_MS = Number(process.env.ANALYZE_TIMEOUT_MS || 30_000);
const DOWNLOAD_TIMEOUT_MS = Number(process.env.DOWNLOAD_TIMEOUT_MS || 600_000);
const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024;

export async function analyzeUrl(url) {
  const raw = await runCommand("yt-dlp", ["--dump-json", "--no-playlist", url], ANALYZE_TIMEOUT_MS);
  let info;
  try {
    info = JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Failed to parse media information"), { status: 502 });
  }
  const formats = normalizeFormats(info.formats || []);

  return {
    url,
    title: info.title,
    thumbnail: info.thumbnail,
    duration: info.duration,
    uploader: info.uploader,
    formats,
    videoQualities: [...new Set(formats.filter((format) => format.hasVideo).map((format) => format.qualityLabel))].filter(Boolean),
    audioFormats: [...new Set(formats.filter((format) => format.hasAudio).map((format) => format.ext))].filter(Boolean)
  };
}

export function startDownload(job, onUpdate) {
  const dir = storageDir(job.request.outputDir);
  const outputTemplate = path.join(dir, `${job.id}-%(title).120s.%(ext)s`);
  const args = buildYtDlpArgs(job.request, outputTemplate);

  // Ensure directory exists (handles custom outputDir)
  fs.mkdir(dir, { recursive: true }).catch(() => null);

  const child = spawn("yt-dlp", args, { windowsHide: true });

  job.process = child;
  update(job, { state: DOWNLOAD_STATES.FETCHING }, onUpdate);

  const timeout = setTimeout(() => {
    if (job.process) {
      job.process.kill();
      update(job, { state: DOWNLOAD_STATES.FAILED, error: "Download timed out", process: null }, onUpdate);
    }
  }, DOWNLOAD_TIMEOUT_MS);

  let fileSizeExceeded = false;

  // Capture title from print-json line emitted early in yt-dlp output
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    if (!job.title) {
      const m = text.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m) job.title = m[1].replace(/\\"/g, '"');
    }
    parseProgress(job, text, onUpdate);
  });
  child.stderr.on("data", (chunk) => parseProgress(job, chunk.toString(), onUpdate));

  child.on("error", (error) => {
    clearTimeout(timeout);
    update(job, { state: DOWNLOAD_STATES.FAILED, error: error.message, process: null }, onUpdate);
  });

  child.on("close", async (code) => {
    clearTimeout(timeout);
    job.process = null;
    if (fileSizeExceeded) return;
    if (job.cancelRequested) {
      update(job, { state: DOWNLOAD_STATES.CANCELED }, onUpdate);
      return;
    }
    if (job.pauseRequested) {
      update(job, { state: DOWNLOAD_STATES.PAUSED }, onUpdate);
      return;
    }
    if (code !== 0) {
      update(job, { state: DOWNLOAD_STATES.FAILED, error: `Processor exited with code ${code}` }, onUpdate);
      return;
    }

    // Verify the expected output file exists; if not, find the actual file yt-dlp created
    const expectedFileName = job.lastFileName || `${safeFileName(job.title || "download")}.${job.request.format}`;
    const expectedPath = job.lastOutputPath || path.join(storageDir(job.request.outputDir), expectedFileName);

    let finalPath = expectedPath;
    let finalName = expectedFileName;

    try {
      await fs.access(expectedPath);
      const stat = await fs.stat(expectedPath).catch(() => null);
      if (stat && stat.size > MAX_FILE_SIZE_BYTES) {
        await fs.unlink(expectedPath).catch(() => null);
        update(job, { state: DOWNLOAD_STATES.FAILED, error: "File exceeds maximum allowed size", process: null }, onUpdate);
        return;
      }
    } catch {
      // Expected file missing — find any file in storage matching the job id prefix
      const dir = storageDir(job.request.outputDir);
      const files = await fs.readdir(dir).catch(() => []);
      const match = files.find((f) => f.startsWith(job.id));
      if (match) {
        finalPath = path.join(dir, match);
        finalName = match.replace(/^[a-f0-9-]{36}-/, "");
        const stat = await fs.stat(finalPath).catch(() => null);
        if (stat && stat.size > MAX_FILE_SIZE_BYTES) {
          await fs.unlink(finalPath).catch(() => null);
          update(job, { state: DOWNLOAD_STATES.FAILED, error: "File exceeds maximum allowed size", process: null }, onUpdate);
          return;
        }
      }
    }

    update(job, {
      state: DOWNLOAD_STATES.COMPLETED,
      progress: 100,
      fileName: finalName,
      outputPath: finalPath
    }, onUpdate);
  });

  return child;
}

function buildYtDlpArgs(request, outputTemplate) {
  const args = ["--newline", "--no-playlist", "--print-json", "-o", outputTemplate];

  if (request.type === "audio") {
    args.push("-x", "--audio-format", request.format || "mp3", "--audio-quality", "0");
  } else if (request.type === "video-only") {
    args.push("-f", `bestvideo[height<=${height(request.quality)}]/bestvideo`);
  } else {
    const fmt = request.format || "mp4";
    const maxHeight = height(request.quality);
    if (fmt === "mp4") {
      const selector = request.quality === "best"
        ? "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best"
        : `bestvideo[ext=mp4][vcodec^=avc1][height<=${maxHeight}]+bestaudio[ext=m4a]/bestvideo[ext=mp4][height<=${maxHeight}]+bestaudio[ext=m4a]/best[height<=${maxHeight}]`;
      args.push("-f", selector, "--merge-output-format", "mp4");
    } else {
      const selector = request.quality === "best"
        ? "bestvideo+bestaudio/best"
        : `bestvideo[height<=${maxHeight}]+bestaudio/best[height<=${maxHeight}]`;
      args.push("-f", selector, "--merge-output-format", fmt);
    }
  }

  args.push(request.url);
  return args;
}

function height(quality) {
  if (quality === "best") return 99999;
  const parsed = Number.parseInt(String(quality).replace("p", ""), 10);
  return Number.isFinite(parsed) ? parsed : 1080;
}

function normalizeFormats(formats) {
  return formats.map((format) => ({
    id: format.format_id,
    ext: format.ext,
    qualityLabel: format.height ? `${format.height}p` : format.format_note || "audio",
    width: format.width,
    height: format.height,
    fps: format.fps,
    hasVideo: format.vcodec && format.vcodec !== "none",
    hasAudio: format.acodec && format.acodec !== "none",
    audioCodec: format.acodec,
    videoCodec: format.vcodec,
    size: format.filesize || format.filesize_approx || null,
    bitrate: format.tbr || format.abr || null
  }));
}

function parseProgress(job, text, onUpdate) {
  const destination = text.match(/\[download\] Destination: (.+)/);
  if (destination) {
    job.lastOutputPath = destination[1].trim();
    job.lastFileName = path.basename(job.lastOutputPath);
  }

  const merge = text.match(/\[Merger\] Merging formats into "(.+)"/);
  if (merge) {
    job.lastOutputPath = merge[1].trim();
    job.lastFileName = path.basename(job.lastOutputPath);
    update(job, { state: DOWNLOAD_STATES.CONVERTING }, onUpdate);
  }

  const progress = text.match(/\[download\]\s+([\d.]+)%.*?(?:at\s+([^\s]+\/s))?.*?(?:ETA\s+([^\s]+))?/);
  if (progress) {
    update(job, {
      state: DOWNLOAD_STATES.DOWNLOADING,
      progress: Number(progress[1]),
      speed: progress[2] || job.speed,
      eta: progress[3] || job.eta
    }, onUpdate);
  }
}

function update(job, patch, onUpdate) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  onUpdate(job);
}

function runCommand(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = timeoutMs ? setTimeout(() => {
      timedOut = true;
      child.kill();
      reject(new Error("Command timed out"));
    }, timeoutMs) : null;

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) return;
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `${command} exited with code ${code}`));
    });
  });
}

