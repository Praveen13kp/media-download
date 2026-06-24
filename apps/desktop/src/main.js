import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === "production";
const isDev = !isProd;

let backendProcess = null;

function rootPath(...parts) {
  if (isProd) {
    return path.join(process.resourcesPath, "app", ...parts);
  }
  return path.resolve(__dirname, "../../..", ...parts);
}

function checkCommand(cmd) {
  try {
    execSync(`where ${cmd}`, { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function checkPrerequisites() {
  const missing = [];
  if (!checkCommand("yt-dlp")) missing.push({
    name: "yt-dlp", url: "https://github.com/yt-dlp/yt-dlp#installation", winget: "yt-dlp.yt-dlp"
  });
  if (!checkCommand("ffmpeg")) missing.push({
    name: "ffmpeg", url: "https://ffmpeg.org/download.html", winget: "Gyan.FFmpeg"
  });
  return missing;
}

function showMissingDialog(missing) {
  const detail = missing.map((m) => {
    const cmd = m.winget ? `\n     Quick install: winget install ${m.winget}` : "";
    return `  - ${m.name}\n     Download: ${m.url}${cmd}`;
  }).join("\n\n");

  return dialog.showMessageBoxSync({
    type: "warning",
    title: "Missing Requirements",
    message: "Media Download Manager needs these tools to work:",
    detail,
    buttons: ["Install & Restart", "Exit"],
    defaultId: 0
  });
}

function tryInstallMissing(missing) {
  for (const m of missing) {
    if (m.winget) {
      try {
        execSync(`winget install ${m.winget}`, { stdio: "inherit", windowsHide: true, timeout: 120_000 });
      } catch {
        return false;
      }
    }
  }
  return true;
}

function startBackend() {
  const serverPath = rootPath("packages", "backend", "src", "server.js");
  if (!fs.existsSync(serverPath)) {
    console.error("Backend not found at", serverPath);
    return;
  }

  const storageDir = path.join(app.getPath("userData"), "storage");
  fs.mkdirSync(storageDir, { recursive: true });

  const env = {
    ...process.env,
    PORT: "4000",
    NODE_ENV: "production",
    STORAGE_DIR: storageDir
  };

  if (isDev) env.NODE_OPTIONS = "--watch";

  backendProcess = spawn(process.execPath, [serverPath], {
    cwd: rootPath("packages", "backend"),
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  backendProcess.stdout.on("data", (d) => {
    const msg = d.toString().trim();
    if (msg) console.log("[backend]", msg);
  });

  backendProcess.stderr.on("data", (d) => {
    const msg = d.toString().trim();
    if (msg) console.error("[backend]", msg);
  });

  backendProcess.on("error", (err) => console.error("[backend] failed:", err.message));
  backendProcess.on("exit", (code) => {
    console.log("[backend] exited with code", code);
    backendProcess = null;
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 640,
    title: "Media Download Manager",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isProd) {
    const indexPath = rootPath("apps", "web", "dist", "index.html");
    if (fs.existsSync(indexPath)) {
      win.loadFile(indexPath);
    } else {
      console.error("Web dist not found at", indexPath);
 console.error("Run: npm run build -w @media/web");
      win.loadURL("http://localhost:5173");
    }
  } else {
    win.loadURL(process.env.WEB_URL || "http://localhost:5173");
  }
}

app.whenReady().then(async () => {
  const missing = await checkPrerequisites();
  if (missing.length > 0) {
    const choice = showMissingDialog(missing);
    if (choice === 0) {
      const installed = tryInstallMissing(missing);
      if (!installed) {
        const stillMissing = await checkPrerequisites();
        if (stillMissing.length > 0) {
          dialog.showMessageBoxSync({
            type: "error",
            title: "Setup Incomplete",
            message: "Could not auto-install all requirements.",
            detail: stillMissing.map((m) => `  - ${m.name}: ${m.url}`).join("\n")
          });
          app.quit();
          return;
        }
      }
    } else {
      app.quit();
      return;
    }
  }

  startBackend();
  createWindow();
});

app.on("window-all-closed", () => {
  if (backendProcess) { backendProcess.kill(); backendProcess = null; }
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle("choose-download-folder", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("open-path", async (_event, targetPath) => {
  if (!targetPath) return false;
  await shell.openPath(targetPath);
  return true;
});
