import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const projectRoot = path.resolve(desktopDir, "../..");
const buildDir = path.join(desktopDir, "build-resources");

function log(msg) {
  console.log(`[build] ${msg}`);
}

function rmrf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function copy(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      copy(path.join(src, entry.name), path.join(dest, entry.name));
    }
  } else if (stat.isFile()) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest);
  }
}

log("Building web app...");
execSync("npm run build -w @media/web", {
  cwd: projectRoot,
  stdio: "inherit",
  windowsHide: true
});

log("Preparing build resources...");
rmrf(buildDir);

const packagesDest = path.join(buildDir, "packages");
const webDistDest = path.join(buildDir, "apps", "web", "dist");
const backendNmDest = path.join(packagesDest, "backend", "node_modules");

fs.mkdirSync(webDistDest, { recursive: true });

log("Copying backend source...");
copy(path.join(projectRoot, "packages", "backend", "src"), path.join(packagesDest, "backend", "src"));
copy(path.join(projectRoot, "packages", "backend", "package.json"), path.join(packagesDest, "backend", "package.json"));

log("Copying shared package...");
copy(path.join(projectRoot, "packages", "shared", "src"), path.join(backendNmDest, "@media", "shared", "src"));
copy(path.join(projectRoot, "packages", "shared", "package.json"), path.join(backendNmDest, "@media", "shared", "package.json"));

log("Copying backend dependencies...");
const rootNodeModules = path.join(projectRoot, "node_modules");
const backendDeps = ["cors", "dotenv", "express", "express-rate-limit", "helmet", "pg"];

for (const dep of backendDeps) {
  const depPath = path.join(rootNodeModules, dep);
  if (fs.existsSync(depPath)) {
    copy(depPath, path.join(backendNmDest, dep));
    log(`  bundled ${dep}`);
  }
}

log("Copying web dist...");
copy(path.join(projectRoot, "apps", "web", "dist"), webDistDest);

log("Packaging desktop app...");
execSync("npx electron-builder --win", {
  cwd: desktopDir,
  stdio: "inherit",
  windowsHide: true
});

log("Cleaning up build resources...");
rmrf(buildDir);

log("Done! Check apps/desktop/release/ for the installer.");
