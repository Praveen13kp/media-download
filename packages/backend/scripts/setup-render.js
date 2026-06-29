import { execSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.resolve(__dirname, "../bin");

fs.mkdirSync(binDir, { recursive: true });

const ytDlpPath = path.join(binDir, "yt-dlp");

if (!fs.existsSync(ytDlpPath)) {
  console.log("Downloading yt-dlp...");
  const url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(ytDlpPath);
    https.get(url, (res) => {
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    }).on("error", reject);
  });
  execSync(`chmod +x "${ytDlpPath}"`, { stdio: "inherit" });
  console.log("yt-dlp downloaded");
}

console.log("Render setup complete");
