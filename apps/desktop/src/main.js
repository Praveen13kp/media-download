import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devUrl = process.env.WEB_URL || "http://localhost:5173";

let backendProcess = null;

function startBackend() {
  const serverPath = path.resolve(__dirname, "../../../packages/backend/src/server.js");
  backendProcess = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: "4000" },
    windowsHide: true
  });
  backendProcess.stdout?.on("data", (d) => console.log("[backend]", d.toString().trim()));
  backendProcess.stderr?.on("data", (d) => console.error("[backend]", d.toString().trim()));
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

  if (process.env.NODE_ENV === "production") {
    win.loadFile(path.resolve(__dirname, "../../web/dist/index.html"));
  } else {
    win.loadURL(devUrl);
  }
}

app.whenReady().then(() => {
  if (process.env.NODE_ENV === "production") startBackend();
  createWindow();
});

app.on("window-all-closed", () => {
  backendProcess?.kill();
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

