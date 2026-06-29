import { existsSync, unlinkSync } from "node:fs";
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
