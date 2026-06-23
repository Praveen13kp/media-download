import { spawn } from "node:child_process";
import path from "node:path";
import { DOWNLOAD_STATES } from "@media/shared";
import { safeFileName, storageDir } from "./storage.js";

export async function analyzeUrl(url) {
  const raw = await runCommand("yt-dlp", ["--dump-json", "--no-playlist", url]);
  const info = JSON.parse(raw);
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
  const outputTemplate = path.join(storageDir(), `${job.id}-%(title).120s.%(ext)s`);
  const args = buildYtDlpArgs(job.request, outputTemplate);
  const child = spawn("yt-dlp", args, { windowsHide: true });

  job.process = child;
  update(job, { state: DOWNLOAD_STATES.FETCHING }, onUpdate);

  child.stdout.on("data", (chunk) => parseProgress(job, chunk.toString(), onUpdate));
  child.stderr.on("data", (chunk) => parseProgress(job, chunk.toString(), onUpdate));

  child.on("error", (error) => {
    update(job, { state: DOWNLOAD_STATES.FAILED, error: error.message, process: null }, onUpdate);
  });

  child.on("close", (code) => {
    job.process = null;
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
    const fileName = job.lastFileName || `${safeFileName(job.title || "download")}.${job.request.format}`;
    update(job, {
      state: DOWNLOAD_STATES.COMPLETED,
      progress: 100,
      fileName,
      outputPath: job.lastOutputPath || path.join(storageDir(), fileName)
    }, onUpdate);
  });

  return child;
}

function buildYtDlpArgs(request, outputTemplate) {
  const args = ["--newline", "--no-playlist", "-o", outputTemplate];

  if (request.type === "audio") {
    args.push("-x", "--audio-format", request.format || "mp3", "--audio-quality", "0");
  } else if (request.type === "video-only") {
    args.push("-f", `bestvideo[height<=${height(request.quality)}]/bestvideo`);
  } else {
    const maxHeight = height(request.quality);
    const selector = request.quality === "best"
      ? "bestvideo+bestaudio/best"
      : `bestvideo[height<=${maxHeight}]+bestaudio/best[height<=${maxHeight}]`;
    args.push("-f", selector, "--merge-output-format", request.format || "mp4");
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

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `${command} exited with code ${code}`));
    });
  });
}

