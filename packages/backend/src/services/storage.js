import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function storageDir() {
  return path.resolve(process.cwd(), process.env.STORAGE_DIR || path.resolve(__dirname, "../../storage"));
}

export async function ensureStorageDir() {
  await fs.mkdir(storageDir(), { recursive: true });
}

export function safeFileName(input) {
  return String(input || "download")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "download";
}

