param(
  [switch]$Build,
  [switch]$Package
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Host.UI.RawUI.WindowTitle = "Media Download Manager"

function Write-Step($Msg) {
  Write-Host ">> $Msg" -ForegroundColor Cyan
}

function Check-Command($Cmd, $Name, $Url) {
  $found = Get-Command $Cmd -ErrorAction SilentlyContinue
  if (-not $found) {
    Write-Host "!! $Name is not installed." -ForegroundColor Yellow
    Write-Host "   Download from: $Url" -ForegroundColor White
    Write-Host "   Install it, restart PowerShell, and run this script again." -ForegroundColor Yellow
    return $false
  }
  Write-Host "   $Name found: $($found.Source)" -ForegroundColor Green
  return $true
}

Write-Step "Media Download Manager - Quick Start"
Write-Host ""

Write-Step "Checking prerequisites..."
$nodeOk = Check-Command "node" "Node.js" "https://nodejs.org/"
$ytOk = Check-Command "yt-dlp" "yt-dlp" "https://github.com/yt-dlp/yt-dlp#installation"
$ffOk = Check-Command "ffmpeg" "ffmpeg" "https://ffmpeg.org/download.html"

if (-not $nodeOk) {
  Write-Host "Node.js is required. Install it from https://nodejs.org/ (LTS version 20+)." -ForegroundColor Red
  exit 1
}

if (-not $ytOk) {
  Write-Host "yt-dlp is required for downloading media." -ForegroundColor Red
  Write-Host "Quick install:  winget install yt-dlp.yt-dlp" -ForegroundColor Gray
  exit 1
}

if (-not $ffOk) {
  Write-Host "ffmpeg is required for merging/converting media." -ForegroundColor Red
  Write-Host "Quick install:  winget install Gyan.FFmpeg" -ForegroundColor Gray
  exit 1
}

Write-Host ""

if (-not (Test-Path "$ProjectRoot\.env")) {
  Write-Step "Creating .env from .env.example..."
  Copy-Item "$ProjectRoot\.env.example" "$ProjectRoot\.env"
}

Write-Step "Installing dependencies..."
Push-Location $ProjectRoot
try {
  npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
} finally {
  Pop-Location
}

if ($Package) {
  Write-Step "Building and packaging desktop app..."
  Push-Location $ProjectRoot
  try {
    npm run package
    if ($LASTEXITCODE -ne 0) { throw "Package failed" }
    Write-Step "Installer created in apps\desktop\release"
  } finally {
    Pop-Location
  }
  return
}

if ($Build) {
  Write-Step "Building web app for production..."
  Push-Location "$ProjectRoot\apps\web"
  try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Web build failed" }
  } finally {
    Pop-Location
  }
}

$env:FORCE_COLOR = 1

Write-Step "Starting backend (http://localhost:4000)..."
$backendJob = Start-Job -ScriptBlock {
  param($dir)  Set-Location $dir; npm run dev:backend
} -ArgumentList $ProjectRoot

Start-Sleep -Seconds 3

Write-Step "Starting web app (http://localhost:5173)..."
$webJob = Start-Job -ScriptBlock {
  param($dir)  Set-Location $dir; npm run dev:web
} -ArgumentList $ProjectRoot

Start-Sleep -Seconds 5

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  App is running!" -ForegroundColor Green
Write-Host "  Open http://localhost:5173 in Chrome" -ForegroundColor White
Write-Host "  Press Ctrl+C in this window to stop" -ForegroundColor Yellow
Write-Host "================================================" -ForegroundColor Green
Write-Host ""

Start-Process "http://localhost:5173"

try {
  while ($true) {
    $backendJob | Receive-Job -ErrorAction SilentlyContinue
    $webJob | Receive-Job -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2

    if ($backendJob.State -eq "Failed") {
      Write-Host "Backend failed:" $backendJob.JobStateInfo.Reason -ForegroundColor Red
      break
    }
    if ($webJob.State -eq "Failed") {
      Write-Host "Web app failed:" $webJob.JobStateInfo.Reason -ForegroundColor Red
      break
    }
  }
} finally {
  Write-Step "Shutting down..."
  $backendJob, $webJob | Stop-Job -PassThru | Remove-Job
}
