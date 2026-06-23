let currentUrl = "";
let panel = null;

function install() {
  if (!location.href.includes("/watch")) return;
  if (currentUrl === location.href && panel) return;
  currentUrl = location.href;
  panel?.remove();
  panel = buildPanel();
  const target = document.querySelector("#secondary-inner") || document.body;
  target.prepend(panel);
}

function buildPanel() {
  const root = document.createElement("section");
  root.className = "amd-panel";
  root.innerHTML = `
    <div class="amd-title">Media Download</div>
    <div class="amd-row">
      <select data-field="type">
        <option value="video">Video + Audio</option>
        <option value="video-only">Video Only</option>
        <option value="audio">Audio Only</option>
      </select>
      <select data-field="quality">
        <option>1080p</option>
        <option>720p</option>
        <option>480p</option>
        <option>360p</option>
        <option>240p</option>
        <option>144p</option>
        <option value="best">Best</option>
      </select>
      <select data-field="format">
        <option value="mp4">MP4</option>
        <option value="webm">WEBM</option>
        <option value="mp3">MP3</option>
      </select>
    </div>
    <button class="amd-button" type="button">Send to downloader</button>
    <p class="amd-status"></p>
  `;

  root.querySelector("[data-field='type']").addEventListener("change", (event) => {
    const format = root.querySelector("[data-field='format']");
    format.value = event.target.value === "audio" ? "mp3" : "mp4";
  });

  root.querySelector("button").addEventListener("click", async () => {
    const status = root.querySelector(".amd-status");
    status.textContent = "Creating download job...";
    const payload = {
      url: location.href,
      type: root.querySelector("[data-field='type']").value,
      quality: root.querySelector("[data-field='quality']").value,
      format: root.querySelector("[data-field='format']").value
    };
    const result = await chrome.runtime.sendMessage({ type: "download:start", payload });
    status.textContent = result.error ? result.error : "Job queued. The browser will ask where to save when ready.";
  });

  return root;
}

install();
setInterval(install, 1000);

