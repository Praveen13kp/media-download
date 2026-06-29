import { execSync, spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { DOWNLOAD_STATES } from "@media/shared";
import { safeFileName, storageDir } from "./storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.resolve(__dirname, "../../bin");
const localYtDlp = path.join(binDir, "yt-dlp");

// Add local bin to PATH so spawned processes find yt-dlp and ffmpeg
if (process.env.PATH && !process.env.PATH.includes(binDir)) {
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
}

// Write YouTube cookies if YOUTUBE_COOKIES env var is set
const cookieFile = path.join(os.tmpdir(), "yt-dlp-cookies.txt");
if (process.env.YOUTUBE_COOKIES) {
  try {
    writeFileSync(cookieFile, process.env.YOUTUBE_COOKIES, "utf-8");
    console.log("YouTube cookies: loaded");
  } catch (err) {
    console.error("Failed to write cookies file:", err.message);
  }
}

function cookieArgs() {
  if (process.env.YOUTUBE_COOKIES && existsSync(cookieFile)) {
    return ["--cookies", cookieFile];
  }
  return [];
}

function resolveYtDlp() {
  if (process.env.YT_DLP_PATH && existsSync(process.env.YT_DLP_PATH)) {
    return process.env.YT_DLP_PATH;
  }
  if (existsSync(localYtDlp)) {
    return localYtDlp;
  }
  return "yt-dlp";
}

const YT_DLP = resolveYtDlp();
console.log(`yt-dlp binary: ${YT_DLP}`);

try {
  const ver = execSync(`"${YT_DLP}" --version 2>&1`, { encoding: "utf-8", timeout: 15000, shell: true }).trim();
  console.log(`yt-dlp version: ${ver}`);
} catch (err) {
  const stderr = (err.stderr || "").toString().slice(0, 500);
  const stdout = (err.stdout || "").toString().slice(0, 200);
  console.error(`yt-dlp version check failed: ${stderr || stdout || err.message}`);
}

// Check if ffmpeg is available
try {
  execSync("ffmpeg -version 2>&1", { encoding: "utf-8", timeout: 5000 });
  console.log("ffmpeg: available");
} catch {
  console.log("ffmpeg: not found in PATH");
}

const ANALYZE_TIMEOUT_MS = Number(process.env.ANALYZE_TIMEOUT_MS || 30_000);
const DOWNLOAD_TIMEOUT_MS = Number(process.env.DOWNLOAD_TIMEOUT_MS || 600_000);
const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024;

export async function analyzeUrl(url) {
  let raw;
  try {
    const args = [...cookieArgs(), "--dump-json", "--no-playlist", url];
    raw = await runCommand(resolveYtDlp(), args, ANALYZE_TIMEOUT_MS);
  } catch (err) {
    console.error("yt-dlp failed:", err.message);
    const msg = err.message.includes("Sign in to confirm")
      ? "YouTube requires authentication. Set the YOUTUBE_COOKIES environment variable."
      : err.message;
    throw Object.assign(new Error(msg), { status: 502 });
  }
  if (!raw || !raw.trim()) {
    throw Object.assign(new Error("yt-dlp produced no output"), { status: 502 });
  }
  let info;
  try {
    info = JSON.parse(raw);
  } catch {
    console.error("=== yt-dlp stdout (first 2000 chars) ===");
    console.error(raw.slice(0, 2000));
    console.error("=== yt-dlp stdout end ===");
    throw Object.assign(new Error(`yt-dlp returned non-JSON: ${raw.slice(0, 200)}`), { status: 502 });
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

  const child = spawn(resolveYtDlp(), args, { windowsHide: true });

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
  const args = [...cookieArgs(), "--newline", "--no-playlist", "--print-json", "-o", outputTemplate];

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
    const cmdStr = `${command} ${args.slice(0, 2).join(" ")} ... [${args.length} args]`;
    console.error(`spawning: ${cmdStr}`);
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
      console.error(`spawn error: ${err.message}`);
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      if (timedOut) return;
      const stderrMsg = stderr.trim();
      const stdoutMsg = stdout.trim();
      console.error(`=== YTDLP RESULT ===`);
      console.error(`exit:    ${code}`);
      console.error(`signal:  ${signal || "none"}`);
      console.error(`stdout length: ${stdout.length}`);
      console.error(`stderr length: ${stderr.length}`);
      if (stderrMsg) console.error(`stderr:\n${stderrMsg}`);
      if (stdoutMsg) console.error(`stdout:\n${stdoutMsg.slice(0, 1000)}`);
      console.error(`====================`);
      if (code === 0 && stdoutMsg) resolve(stdout);
      else if (code === 0 && !stdoutMsg) reject(new Error(stderrMsg || "yt-dlp produced no output"));
      else reject(new Error(stderrMsg || stdoutMsg || `exit code ${code}`));
    });
  });
}

