import { execSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.resolve(__dirname, "../bin");

fs.mkdirSync(binDir, { recursive: true });

function run(cmd) {
  return execSync(cmd, { stdio: "inherit", shell: true, timeout: 60000 });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { "Accept": "application/octet-stream" } }, (res) => {
      const status = res.statusCode;
      if (status >= 300 && status < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (status !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${status} downloading ${url}`));
      }
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    }).on("error", (err) => { file.close(); try { fs.unlinkSync(dest); } catch {} reject(err); });
  });
}

// --- yt-dlp via pip3 (most reliable on Render) ---
const ytDlpBin = path.join(binDir, "yt-dlp");

if (fs.existsSync(ytDlpBin)) {
  try {
    const ver = execSync(`"${ytDlpBin}" --version 2>&1`, { encoding: "utf-8", timeout: 10000 }).trim();
    console.log(`yt-dlp ${ver} (cached)`);
  } catch {
    fs.unlinkSync(ytDlpBin);
    console.log("yt-dlp binary broken, re-downloading...");
  }
}

if (!fs.existsSync(ytDlpBin)) {
  console.log("Installing yt-dlp via pip3...");
  try {
    run("pip3 install --user yt-dlp");
    const pyBin = execSync("python3 -c \"import sysconfig; print(sysconfig.get_path('scripts'))\"", { encoding: "utf-8" }).trim();
    const pyYtDlp = path.join(pyBin, "yt-dlp");
    if (fs.existsSync(pyYtDlp)) {
      const ver = execSync(`"${pyYtDlp}" --version 2>&1`, { encoding: "utf-8" }).trim();
      console.log(`yt-dlp ${ver} installed via pip`);
      fs.copyFileSync(pyYtDlp, ytDlpBin);
      fs.chmodSync(ytDlpBin, 0o755);
    } else {
      throw new Error("yt-dlp not found after pip install");
    }
  } catch (err) {
    console.error("pip3 install failed:", err.message);
    console.log("Falling back to static binary download...");
    const url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";
    console.log("Downloading yt-dlp static binary...");
    await download(url, ytDlpBin);
    fs.chmodSync(ytDlpBin, 0o755);
    try {
      const ver = execSync(`"${ytDlpBin}" --version 2>&1`, { encoding: "utf-8", timeout: 10000 }).trim();
      console.log(`yt-dlp ${ver} (static binary)`);
    } catch (e) {
      console.error("yt-dlp binary still not working:", e.message);
    }
  }
}

// --- ffmpeg static build ---
const ffmpegBin = path.join(binDir, "ffmpeg");

if (fs.existsSync(ffmpegBin)) {
  try {
    const ver = execSync(`"${ffmpegBin}" -version 2>&1`, { encoding: "utf-8", timeout: 5000 }).split("\n")[0];
    console.log(`ffmpeg: ${ver} (cached)`);
  } catch {
    fs.unlinkSync(ffmpegBin);
    console.log("ffmpeg binary broken, re-downloading...");
  }
}

if (!fs.existsSync(ffmpegBin)) {
  console.log("Downloading ffmpeg static build...");
  const ffmpegUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-n7.1-latest-linux64-gpl-7.1.tar.xz";
  const tarball = path.join(binDir, "ffmpeg.tar.xz");
  try {
    await download(ffmpegUrl, tarball);
    run(`tar -xf "${tarball}" -C "${binDir}" --strip-components=2 "*/bin/ffmpeg" 2>/dev/null`);
    fs.unlinkSync(tarball);
    if (fs.existsSync(ffmpegBin)) {
      fs.chmodSync(ffmpegBin, 0o755);
      const ver = execSync(`"${ffmpegBin}" -version 2>&1`, { encoding: "utf-8", timeout: 5000 }).split("\n")[0];
      console.log(`ffmpeg: ${ver}`);
    }
  } catch (err) {
    console.error("ffmpeg download failed:", err.message);
    try { if (fs.existsSync(tarball)) fs.unlinkSync(tarball); } catch {}
  }
}

console.log("Render setup complete");
