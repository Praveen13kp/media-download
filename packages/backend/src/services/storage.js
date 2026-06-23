import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../../../..");

export function storageDir(outputDir) {
  if (outputDir) return outputDir;
  if (process.env.STORAGE_DIR) return path.resolve(projectRoot, process.env.STORAGE_DIR);
  return path.resolve(__dirname, "../../storage");
}

export async function ensureStorageDir(outputDir) {
  await fs.mkdir(storageDir(outputDir), { recursive: true });
}

export function safeFileName(input) {
  return String(input || "download")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "download";
}
