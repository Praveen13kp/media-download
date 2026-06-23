import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../../../..");

export function storageDir() {
  if (process.env.STORAGE_DIR) return path.resolve(projectRoot, process.env.STORAGE_DIR);
  return path.resolve(__dirname, "../../storage");
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
