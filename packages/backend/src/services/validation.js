import { isIP } from "node:net";

const supportedProtocols = new Set(["http:", "https:"]);

const blockedHosts = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal"
]);

const blockedRanges = [
  { start: [10, 0, 0, 0], end: [10, 255, 255, 255] },
  { start: [172, 16, 0, 0], end: [172, 31, 255, 255] },
  { start: [192, 168, 0, 0], end: [192, 168, 255, 255] }
];

function ipToOctets(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  return parts.map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isFinite(n) && n >= 0 && n <= 255 ? n : null;
  });
}

function isPrivateIP(ip) {
  const octets = ipToOctets(ip);
  if (!octets) return false;
  return blockedRanges.some(
    ({ start, end }) =>
      octets.every((o, i) => o >= start[i] && o <= end[i])
  );
}

function isBlockedHost(hostname) {
  const lower = hostname.toLowerCase();
  if (blockedHosts.has(lower)) return true;
  if (isIP(lower)) {
    return isPrivateIP(lower) || lower.startsWith("127.") || lower === "0.0.0.0" || lower === "::1";
  }
  return false;
}

export function requireAuth(req, res, next) {
  const token = process.env.API_TOKEN;
  if (!token) return next();

  const header = req.get("authorization") || "";
  if (header === `Bearer ${token}` || req.query.token === token) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

export function validateMediaUrl(url) {
  if (!url || typeof url !== "string") {
    const error = new Error("A URL is required");
    error.status = 400;
    throw error;
  }

  if (url.length > 2048) {
    const error = new Error("URL is too long");
    error.status = 400;
    throw error;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    const error = new Error("Invalid URL");
    error.status = 400;
    throw error;
  }

  if (!supportedProtocols.has(parsed.protocol)) {
    const error = new Error("Only http and https URLs are supported");
    error.status = 400;
    throw error;
  }

  if (isBlockedHost(parsed.hostname)) {
    const error = new Error("Access to this URL is not allowed");
    error.status = 400;
    throw error;
  }
}

const allowedTypes = new Set(["video", "video-only", "audio"]);
const allowedFormats = new Set(["mp4", "webm", "mkv", "mp3", "m4a", "opus", "wav", "flac"]);

export function validateDownloadRequest(body) {
  validateMediaUrl(body.url);

  if (!body.type || !allowedTypes.has(body.type)) {
    const error = new Error("type must be video, video-only, or audio");
    error.status = 400;
    throw error;
  }

  if (!body.quality || typeof body.quality !== "string") {
    const error = new Error("quality is required");
    error.status = 400;
    throw error;
  }

  if (!body.format || typeof body.format !== "string") {
    const error = new Error("format is required");
    error.status = 400;
    throw error;
  }

  if (!allowedFormats.has(body.format)) {
    const error = new Error(`format must be one of: ${[...allowedFormats].join(", ")}`);
    error.status = 400;
    throw error;
  }

  if (body.outputDir !== undefined) {
    if (typeof body.outputDir !== "string" || body.outputDir.includes("..")) {
      const error = new Error("Invalid output directory");
      error.status = 400;
      throw error;
    }
  }
}

export function extractCookies(body) {
  if (!body || body.cookies === undefined || body.cookies === null || body.cookies === "") {
    return null;
  }
  return body.cookies;
}
