import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DOWNLOAD_STATES } from "@media/shared";
import { safeFileName, storageDir } from "./storage.js";
import { getCookieFilePath, cookiesEnabled } from "./cookies.js";
import { getProxy, getDifferentProxy, hasProxy } from "./proxy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.resolve(__dirname, "../../bin");
const localYtDlp = path.join(binDir, "yt-dlp");

// Add local bin to PATH so spawned processes find yt-dlp and ffmpeg
if (process.env.PATH && !process.env.PATH.includes(binDir)) {
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
}

// Configurable extraction options
const EXTRACTOR_RETRIES = process.env.YT_EXTRACTOR_RETRIES || "3";
const USER_AGENT = process.env.YT_USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
// Use a single, safe default client. mweb/tv_embedded are increasingly rejected
// by YouTube's bot detection (HTTP 429, n-challenge failures). `android` is the
// most reliable default as of late 2025/early 2026; we fall back to `web` if
// android fails. Override via YT_PLAYER_CLIENTS if needed.
const YT_PLAYER_CLIENTS = process.env.YT_PLAYER_CLIENTS || "android";
const YT_FALLBACK_PLAYER_CLIENTS = process.env.YT_FALLBACK_PLAYER_CLIENTS || "web";

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

// Check if ffmpeg is available (degrade gracefully if missing — yt-dlp will
// fall back to a single stream when post-processing is not possible).
let ffmpegAvailable = false;
try {
  execSync("ffmpeg -version 2>&1", { encoding: "utf-8", timeout: 5000 });
  ffmpegAvailable = true;
  console.log("ffmpeg: available");
} catch {
  console.log("ffmpeg: not found in PATH — degraded mode (no merging/post-processing)");
}

const ANALYZE_TIMEOUT_MS = Number(process.env.ANALYZE_TIMEOUT_MS || 60_000);
const DOWNLOAD_TIMEOUT_MS = Number(process.env.DOWNLOAD_TIMEOUT_MS || 600_000);
const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024;

// Sleep between yt-dlp HTTP requests. YouTube rate-limits aggressive
// extractors (HTTP 429) and may fail the n-challenge. Spacing requests out
// keeps the server's IP out of the throttle window.
const SLEEP_INTERVAL = process.env.YT_SLEEP_INTERVAL || "2";
const MAX_SLEEP_INTERVAL = process.env.YT_MAX_SLEEP_INTERVAL || "5";
const SLEEP_REQUESTS = process.env.YT_SLEEP_REQUESTS || "1";

// Server-side personal cookies (YOUTUBE_COOKIES env var) are optional.
// When present, the cookies service materializes a temp cookies file at a
// stable path and we forward it via --cookies to every yt-dlp invocation.
function cookieArgs() {
  if (!cookiesEnabled()) return [];
  const cookieFile = getCookieFilePath();
  if (!existsSync(cookieFile)) return [];
  return ["--cookies", cookieFile];
}

// Returns ["--proxy", "<url>"] when a proxy URL is provided, otherwise [].
// Proxy credentials are never logged.
function proxyArgs(proxy) {
  if (!proxy) return [];
  return ["--proxy", proxy];
}

// YouTube-specific extractor arguments to bypass bot detection and age-gate.
// `mweb` and `tv_embedded` clients are known to bypass the age restriction
// prompt with weaker cookie sets. Using multiple clients gives yt-dlp fallback
// options when one is rejected.
function extractorArgs(clients = YT_PLAYER_CLIENTS) {
  return ["--extractor-args", `youtube:player_client=${clients}`];
}

// Sleep flags — space out HTTP requests so YouTube doesn't rate-limit us
// (HTTP 429) and the n-challenge solver has time to finish.
function sleepArgs() {
  return [
    "--sleep-interval", SLEEP_INTERVAL,
    "--max-sleep-interval", MAX_SLEEP_INTERVAL,
    "--sleep-requests", SLEEP_REQUESTS,
  ];
}

// Extra age-gate bypass flags: force the default fetch to use the age-gate
// aware player, and disable the YouTube "confirm you're not a bot" interstitial
// by requesting a player response directly.
function ageGateArgs() {
  return [
    "--extractor-args", "youtube:skip=translated_subs",
    "--no-check-certificates",
    "--geo-bypass",
    "--geo-bypass-country", "IN"
  ];
}

const THROTTLED_RATE = process.env.YT_THROTTLED_RATE || "100K";

function failure(error, message) {
  return { success: false, error, message };
}

export async function analyzeUrl(url) {
  const cookieFile = cookiesEnabled() ? getCookieFilePath() : null;
  if (cookieFile) {
    console.log(`analyze: using server cookies (file: ${path.basename(cookieFile)}, exists: ${existsSync(cookieFile)})`);
  } else {
    console.log("analyze: anonymous mode (no cookies)");
  }

  const proxyConfigured = hasProxy();
  if (proxyConfigured) {
    console.log("analyze: proxy routing enabled");
  }

  // --skip-download: we only want metadata, not the media itself.
  const baseArgs = [
    "--dump-json", "--no-playlist", "--skip-download",
    "--retries", EXTRACTOR_RETRIES,
    "--extractor-retries", EXTRACTOR_RETRIES,
    "--fragment-retries", EXTRACTOR_RETRIES,
    "--user-agent", USER_AGENT,
    "--throttled-rate", THROTTLED_RATE,
    ...sleepArgs(),
    ...(cookieFile ? ["--cookies", cookieFile] : []),
  ];

  // Build attempt list:
  //   • If proxy is configured: 3 proxy attempts (rotating proxies), using
  //     primary client for all of them.
  //   • If no proxy: 2 client-based attempts (primary → fallback), which is
  //     the existing behaviour.
  let attemptList;
  if (proxyConfigured) {
    // Pick 3 proxies up front (best-effort distinct selection).
    const p1 = getProxy();
    const p2 = getDifferentProxy(p1);
    const p3 = getDifferentProxy(p2);
    attemptList = [
      { clients: YT_PLAYER_CLIENTS, proxy: p1 },
      { clients: YT_PLAYER_CLIENTS, proxy: p2 },
      { clients: YT_PLAYER_CLIENTS, proxy: p3 },
    ];
  } else {
    const clients = [YT_PLAYER_CLIENTS, YT_FALLBACK_PLAYER_CLIENTS].filter(
      (c, i, arr) => c && arr.indexOf(c) === i
    );
    attemptList = clients.map((c) => ({ clients: c, proxy: null }));
  }

  let lastError = null;
  for (let i = 0; i < attemptList.length; i++) {
    const { clients, proxy } = attemptList[i];
    const args = [
      ...baseArgs,
      ...extractorArgs(clients),
      ...ageGateArgs(),
      ...proxyArgs(proxy),
      url,
    ];
    if (i === 0) {
      console.log(`analyze: attempt ${i + 1} — client(s): ${clients}${proxy ? " [proxy]" : ""}`);
    } else {
      console.log(`analyze: attempt ${i + 1} (retry) — client(s): ${clients}${proxy ? " [proxy]" : ""}`);
    }
    try {
      const raw = await runCommand(resolveYtDlp(), args, ANALYZE_TIMEOUT_MS);
      if (raw && raw.trim()) {
        const parsed = parseAnalyzeOutput(url, raw);
        if (parsed.success) return parsed;
        lastError = new Error(parsed.error || "parse failed");
      } else {
        lastError = new Error("yt-dlp produced no output");
      }
    } catch (err) {
      const msg = (err?.message || String(err)).toString();
      lastError = err;
      console.error(`analyze: attempt ${i + 1} failed: ${msg.slice(0, 300)}`);

      if (isYouTubeBlock(msg)) {
        if (proxyConfigured && i < attemptList.length - 1) {
          // With proxy we rotate — try the next proxy instead of giving up.
          console.log("analyze: YouTube block detected — rotating proxy for next attempt");
          continue;
        }
        // No proxy, or all proxy attempts exhausted.
        return failure("youtube-blocked", friendlyYouTubeBlock(msg));
      }
      // Non-block error: if proxy configured keep rotating, otherwise try next client.
    }
  }

  // All attempts exhausted.
  const finalMsg = lastError?.message || "unknown error";
  if (isYouTubeBlock(finalMsg)) {
    return failure("youtube-blocked", friendlyYouTubeBlock(finalMsg));
  }
  return failure(finalMsg, friendlyError(finalMsg, cookiesEnabled()));
}

// Returns true if the error message looks like YouTube is actively blocking
// this server (rate limit, challenge solver, PO token missing, etc.). When
// true, retrying with a different client won't help — the IP is throttled.
function isYouTubeBlock(msg) {
  if (!msg || typeof msg !== "string") return false;
  return (
    msg.includes("HTTP Error 429") ||
    msg.includes("429 Too Many Requests") ||
    msg.includes("n challenge") ||
    msg.includes("n-challenge") ||
    msg.includes("PO Token") ||
    msg.includes("PO token") ||
    msg.includes("Sign in to confirm")
  );
}

/**
 * Returns a specific friendly message for YouTube blocks, distinguishing
 * between 429 rate-limits, PO-token failures, and generic blocks.
 * Proxy-specific messaging is included when a proxy is configured.
 */
function friendlyYouTubeBlock(msg) {
  const proxyNote = hasProxy()
    ? "YouTube temporarily blocked this route. Try another proxy."
    : "YouTube temporarily blocked this server. Try again later.";

  if (
    msg.includes("PO Token") ||
    msg.includes("PO token")
  ) {
    return hasProxy()
      ? "YouTube extraction requires another route. Try a different proxy."
      : "YouTube extraction requires a verified session (PO Token missing). Try again later.";
  }
  return proxyNote;
}

function parseAnalyzeOutput(url, raw) {
  let info;
  try {
    info = JSON.parse(raw);
  } catch {
    console.error("=== yt-dlp returned non-JSON (first 2000 chars) ===");
    console.error(raw.slice(0, 2000));
    console.error("=== end ===");
    return failure("yt-dlp returned non-JSON output", "Video not accessible — please try again.");
  }

  // Only the metadata fields the client actually needs. Do not fail if some
  // are missing (e.g. private/age-gated/region-locked videos may report
  // partial info). In particular, `formats` is often empty or missing when
  // YouTube refuses to hand us a player response — that's fine, the client
  // just shows whatever we have.
  const formats = normalizeFormats(info.formats || []);

  return {
    success: true,
    data: {
      url,
      title: info.title || null,
      thumbnail: info.thumbnail || null,
      duration: info.duration ?? null,
      uploader: info.uploader || null,
      formats,
      videoQualities: [...new Set(formats.filter((format) => format.hasVideo).map((format) => format.qualityLabel))].filter(Boolean),
      audioFormats: [...new Set(formats.filter((format) => format.hasAudio).map((format) => format.ext))].filter(Boolean)
    }
  };
}

export function startDownload(job, onUpdate) {
  const dir = storageDir(job.request.outputDir);
  const outputTemplate = path.join(dir, `${job.id}-%(title).120s.%(ext)s`);
  const cookiesActive = cookiesEnabled();
  if (cookiesActive && cookieArgs().length) {
    console.log(`download ${job.id}: using server cookies`);
  } else {
    console.log(`download ${job.id}: anonymous mode (no cookies)`);
  }

  // Ensure directory exists (handles custom outputDir)
  fs.mkdir(dir, { recursive: true }).catch(() => null);

  const args = buildYtDlpArgs({ ...job.request, url: job.request.url }, outputTemplate);
  for (const arg of cookieArgs()) args.push(arg);
  args.push("--throttled-rate", THROTTLED_RATE);
  args.push(...sleepArgs());
  args.push(...extractorArgs());

  // Inject proxy if configured. A fresh proxy is chosen per download so that
  // concurrent downloads spread across the proxy pool.
  const proxy = getProxy();
  if (proxy) {
    console.log(`download ${job.id}: proxy routing enabled`);
    args.push(...proxyArgs(proxy));
  }

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
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    // Keep the most recent stderr so the close handler can classify the
    // failure (e.g. HTTP 429, n-challenge) and surface a friendly message.
    // Cap at 16 KB to bound memory per job.
    job.lastStderr = ((job.lastStderr || "") + text).slice(-16 * 1024);
    parseProgress(job, text, onUpdate);
  });

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
      // Look up the last stderr we captured during the run to build a
      // user-friendly failure message. yt-dlp writes the meaningful error
      // (429, n-challenge, PO token) to stderr, not stdout.
      const stderr = (job.lastStderr || "").toString();
      let friendly;
      if (isYouTubeBlock(stderr)) {
        friendly = friendlyYouTubeBlock(stderr);
      } else {
        const hint = cookiesActive
          ? " Your server cookies may have expired — try refreshing them."
          : " YouTube may be blocking the request (server cookies not configured).";
        friendly = `Processor exited with code ${code}.${hint}`;
      }
      update(job, { state: DOWNLOAD_STATES.FAILED, error: friendly, process: null }, onUpdate);
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
      const dir2 = storageDir(job.request.outputDir);
      const files = await fs.readdir(dir2).catch(() => []);
      const match = files.find((f) => f.startsWith(job.id));
      if (match) {
        finalPath = path.join(dir2, match);
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
  const args = [
    "--newline", "--no-playlist", "--print-json", "-o", outputTemplate,
    "--retries", EXTRACTOR_RETRIES,
    "--extractor-retries", EXTRACTOR_RETRIES,
    "--fragment-retries", EXTRACTOR_RETRIES,
    "--user-agent", USER_AGENT,
  ];

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

function friendlyError(msg, hasCookies) {
  if (!msg || typeof msg !== "string") return "Video not accessible — please try again.";

  // YouTube is actively blocking this server. Covers HTTP 429 rate limits,
  // n-challenge solver failures, and missing PO token.
  if (isYouTubeBlock(msg)) {
    return friendlyYouTubeBlock(msg);
  }

  if (msg.includes("Sign in to confirm")) {
    return hasCookies
      ? "YouTube is still blocking this request even with cookies. Your server cookies may be expired or from the wrong account. Try refreshing them."
      : "YouTube is blocking this request (bot detection).";
  }
  if (msg.includes("Video unavailable") || msg.includes("This video is not available")) {
    return "This video is unavailable (private, deleted, or geo-blocked).";
  }
  if (msg.includes("Private video")) {
    return "This is a private video. Only the owner can access it.";
  }
  if (msg.includes("age") || msg.includes("Age") || msg.includes("age-restricted") || msg.includes("age restricted")) {
    return hasCookies
      ? "This video requires a logged-in session. Your server cookies may be missing age-verification — try refreshing them."
      : "This video requires logged-in session.";
  }
  if (msg.includes("No video formats found") || msg.includes("no video formats") || msg.includes("Requested format is not available")) {
    return "Video not accessible.";
  }
  if (msg.includes("Copyright")) {
    return "This video is blocked due to a copyright claim.";
  }
  if (msg.includes("HTTP Error") || msg.includes("Connection") || msg.includes("Network")) {
    return "Network error when contacting the video platform. Try again later.";
  }
  if (msg.includes("Command timed out")) {
    return "The request took too long. Try again.";
  }
  return "Video not accessible — please try again.";
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
    console.log("YT-DLP COMMAND START");
    console.log("  command:", command);
    console.log("  args:", args.join(" "));
    console.log("  timeoutMs:", timeoutMs);
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
      console.error("YT-DLP spawn error:", err.message);
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      if (timedOut) return;
      const stderrMsg = stderr.trim();
      const stdoutMsg = stdout.trim();
      console.log("YT-DLP COMMAND END");
      console.log("  exitCode:", code);
      console.log("  signal:", signal || "none");
      console.log("  stdout:", stdoutMsg || "(empty)");
      console.log("  stderr:", stderrMsg || "(empty)");
      if (code === 0 && stdoutMsg) resolve(stdout);
      else if (code === 0 && !stdoutMsg) reject(new Error(stderrMsg || "yt-dlp produced no output"));
      else reject(new Error(stderrMsg || stdoutMsg || `exit code ${code}`));
    });
  });
}
