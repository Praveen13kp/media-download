let currentUrl = "";
let panel = null;

const VIDEO_FORMATS = ["mp4", "webm", "mkv"];
const AUDIO_FORMATS = ["mp3", "m4a", "opus", "webm"];
const VIDEO_QUALITIES = ["1080p", "720p", "480p", "360p", "240p", "144p", "best"];

function install() {
  if (!location.href.includes("/watch")) return;
  if (currentUrl === location.href && panel) return;
  currentUrl = location.href;
  panel?.remove();
  panel = buildPanel();
  const target = document.querySelector("#secondary-inner") || document.body;
  target.prepend(panel);
}

function setOptions(select, values, selected) {
  select.innerHTML = values.map((v) => `<option value="${v}">${v.toUpperCase()}</option>`).join("");
  select.value = selected;
}

function buildPanel() {
  const root = document.createElement("section");
  root.className = "amd-panel";
  root.innerHTML = `
    <div class="amd-title">Media Download</div>
    <div class="amd-info" style="display:none">
      <img class="amd-thumb" src="" alt="" style="width:100%;border-radius:4px;margin-bottom:8px" />
      <div class="amd-video-title" style="font-size:13px;font-weight:600;margin-bottom:4px"></div>
      <div class="amd-duration" style="font-size:12px;color:#536170;margin-bottom:8px"></div>
    </div>
    <div class="amd-row">
      <select data-field="type">
        <option value="video">Video + Audio</option>
        <option value="video-only">Video Only</option>
        <option value="audio">Audio Only</option>
      </select>
      <select data-field="quality"></select>
      <select data-field="format"></select>
    </div>
    <button class="amd-button amd-analyze" type="button">Analyze</button>
    <button class="amd-button" type="button" style="display:none">Download</button>
    <p class="amd-status"></p>
  `;

  const typeEl = root.querySelector("[data-field='type']");
  const qualityEl = root.querySelector("[data-field='quality']");
  const formatEl = root.querySelector("[data-field='format']");
  const analyzeBtn = root.querySelector(".amd-analyze");
  const dlBtn = root.querySelectorAll(".amd-button")[1];
  const status = root.querySelector(".amd-status");
  const infoEl = root.querySelector(".amd-info");

  function syncSelectors() {
    const isAudio = typeEl.value === "audio";
    setOptions(qualityEl, isAudio ? ["best"] : VIDEO_QUALITIES, isAudio ? "best" : "1080p");
    setOptions(formatEl, isAudio ? AUDIO_FORMATS : VIDEO_FORMATS, isAudio ? "mp3" : "mp4");
  }

  syncSelectors();
  typeEl.addEventListener("change", syncSelectors);

  analyzeBtn.addEventListener("click", async () => {
    status.textContent = "Analyzing...";
    analyzeBtn.disabled = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: "media:analyze", url: location.href });
      if (result.error) throw new Error(result.error);

      root.querySelector(".amd-thumb").src = result.thumbnail || "";
      root.querySelector(".amd-video-title").textContent = result.title || "";
      root.querySelector(".amd-duration").textContent = result.duration ? formatDuration(result.duration) : "";
      infoEl.style.display = "block";

      if (result.videoQualities?.length) {
        const currentType = typeEl.value;
        if (currentType !== "audio") {
          setOptions(qualityEl, [...result.videoQualities, "best"], result.videoQualities[0] || "best");
        }
      }

      dlBtn.style.display = "block";
      status.textContent = "";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      analyzeBtn.disabled = false;
    }
  });

  dlBtn.addEventListener("click", async () => {
    status.textContent = "Creating download job...";
    dlBtn.disabled = true;
    const payload = {
      url: location.href,
      type: typeEl.value,
      quality: qualityEl.value,
      format: formatEl.value
    };
    const result = await chrome.runtime.sendMessage({ type: "download:start", payload });
    status.textContent = result.error ? result.error : "Job queued. The browser will ask where to save when ready.";
    dlBtn.disabled = false;
  });

  return root;
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

install();
setInterval(install, 1000);

