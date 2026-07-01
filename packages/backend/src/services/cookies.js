import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_TMP_DIR = process.env.COOKIE_TMP_DIR || "/tmp";
const COOKIE_FILENAME = "yt-dlp-cookies.txt";
const MAX_BYTES = 256 * 1024; // 256 KB hard cap

let cookieFilePath = null;

function tmpDir() {
  if (existsSync(DEFAULT_TMP_DIR)) return DEFAULT_TMP_DIR;
  return os.tmpdir();
}

export function getCookieFilePath() {
  if (cookieFilePath) return cookieFilePath;
  return path.join(tmpDir(), COOKIE_FILENAME);
}

export const COOKIE_MAX_BYTES = MAX_BYTES;

export function cookiesEnabled() {
  return Boolean(process.env.YOUTUBE_COOKIES);
}

function sanitizeCookieLength(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  return raw.length > MAX_BYTES ? raw.slice(0, MAX_BYTES) : raw;
}

export async function ensureServerCookies() {
  const raw = process.env.YOUTUBE_COOKIES;
  if (!raw) return null;
  const trimmed = sanitizeCookieLength(raw);
  if (!trimmed) return null;
  const dest = getCookieFilePath();
  try {
    await writeFile(dest, trimmed, { encoding: "utf-8", mode: 0o600 });
    cookieFilePath = dest;
    if (trimmed.length !== raw.length) {
      console.warn(`YOUTUBE_COOKIES: truncated to ${MAX_BYTES} bytes (original ${raw.length}).`);
    }
    console.log(`YOUTUBE_COOKIES: loaded (file: ${path.basename(dest)})`);
    return dest;
  } catch (err) {
    console.error(`YOUTUBE_COOKIES: failed to write file - ${err.message}`);
    return null;
  }
}

export function deleteCookieFile() {
  const p = cookieFilePath || getCookieFilePath();
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    // Best-effort cleanup
  } finally {
    cookieFilePath = null;
  }
}

// Validate cookie file content: must be in Netscape format (tab-separated)
// with at least one youtube.com entry (or non-empty).
export function validateCookieContent(raw) {
  if (!raw || typeof raw !== "string") return { valid: false, reason: "No cookie data provided" };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { valid: false, reason: "Cookie data is empty" };
  if (trimmed.length > MAX_BYTES) return { valid: false, reason: `Cookie data exceeds ${MAX_BYTES} bytes` };

  const lines = trimmed.split("\n").filter((l) => {
    const s = l.trim();
    return s && !s.startsWith("#");
  });
  if (lines.length === 0) return { valid: false, reason: "No cookie entries found (all lines are comments or blank)" };

  // Check for typical Netscape format: tab-separated with domain, flag, path, secure, expiry, name, value
  const hasNetscapeFormat = lines.some((l) => {
    const parts = l.split("\t");
    return parts.length >= 7;
  });
  if (!hasNetscapeFormat) {
    return { valid: false, reason: "Cookie data is not in Netscape format (tab-separated). Export cookies as Netscape format (cookies.txt)." };
  }

  const hasYoutube = lines.some((l) => {
    const domain = l.split("\t")[0] || "";
    return domain.includes(".youtube.com") || domain.includes("youtube.com");
  });
  if (!hasYoutube) {
    return { valid: false, reason: "No YouTube.com cookies found in the data. Make sure you're logged into YouTube when exporting." };
  }

  return { valid: true };
}

// Update cookies at runtime (replaces existing cookie file and in-memory path)
export async function updateCookies(raw) {
  const validation = validateCookieContent(raw);
  if (!validation.valid) throw new Error(validation.reason);

  const dest = getCookieFilePath();
  try {
    await writeFile(dest, raw, { encoding: "utf-8", mode: 0o600 });
    cookieFilePath = dest;
    return { path: dest, size: raw.length };
  } catch (err) {
    throw new Error(`Failed to write cookie file: ${err.message}`);
  }
}

// Get cookie status info
export function getCookieStatus() {
  const enabled = cookiesEnabled();
  const filePath = getCookieFilePath();
  const exists = existsSync(filePath);
  let size = 0;
  let sample = "";
  if (exists) {
    try {
      const content = readFileSync(filePath, "utf-8");
      size = content.length;
      // Show first entry domain for validation
      const lines = content.split("\n").filter((l) => {
        const s = l.trim();
        return s && !s.startsWith("#");
      });
      if (lines.length > 0) {
        const first = lines[0].split("\t");
        sample = first[0] || "";
      }
    } catch {}
  }
  return { enabled, fileExists: exists, size, sampleDomain: sample, path: filePath };
}
