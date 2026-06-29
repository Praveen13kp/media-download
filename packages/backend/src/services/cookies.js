import { randomBytes } from "node:crypto";
import { promises as fs, unlinkSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_DIR = process.env.COOKIE_TMP_DIR || os.tmpdir();
const PREFIX = "yt-cookies-";
const MAX_BYTES = 256 * 1024;

export const COOKIE_MAX_BYTES = MAX_BYTES;

export function getCookieTmpDir() {
  return TMP_DIR;
}

export function buildCookiePath(id) {
  return path.join(TMP_DIR, `${PREFIX}${id}.txt`);
}

export function newCookieId() {
  return randomBytes(16).toString("hex");
}

export function validateCookieContent(content) {
  if (typeof content !== "string") {
    const err = new Error("cookies must be a string");
    err.status = 400;
    throw err;
  }
  const trimmed = content.trim();
  if (!trimmed) {
    const err = new Error("cookies are empty");
    err.status = 400;
    throw err;
  }
  if (Buffer.byteLength(trimmed, "utf-8") > MAX_BYTES) {
    const err = new Error(`cookies exceed maximum size of ${MAX_BYTES} bytes`);
    err.status = 413;
    throw err;
  }
  const looksLikeNetscape = /^#\s*HttpOnly_/i.test(trimmed.split(/\r?\n/, 1)[0]) ||
    /youtube\.com|youtube-nocookie|googlevideo\.com|google\.com/i.test(trimmed);
  if (!looksLikeNetscape) {
    const err = new Error("cookies do not look like a valid Netscape cookies file (expected a cookies.txt export)");
    err.status = 400;
    throw err;
  }
  return trimmed;
}

export async function writeCookieFile(content) {
  const id = newCookieId();
  const filePath = buildCookiePath(id);
  await fs.writeFile(filePath, content, { encoding: "utf-8", mode: 0o600 });
  return { id, filePath };
}

export function deleteCookieFile(filePath) {
  if (!filePath) return;
  try {
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch {
    // Best-effort cleanup; never throw to callers
  }
}

export async function deleteCookieFileAsync(filePath) {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err && err.code !== "ENOENT") {
      // Best-effort cleanup; never throw to callers
    }
  }
}
