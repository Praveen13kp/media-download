const DEFAULTS = {
  apiBase: "http://localhost:4000",
  apiToken: ""
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((error) => sendResponse({ error: error.message }));
  return true;
});

async function handleMessage(message) {
  if (message.type === "settings:get") {
    return chrome.storage.sync.get(DEFAULTS);
  }
  if (message.type === "settings:set") {
    await chrome.storage.sync.set(message.settings);
    return { ok: true };
  }
  if (message.type === "media:analyze") {
    return request("/api/media/analyze", { method: "POST", body: { url: message.url } });
  }
  if (message.type === "download:start") {
    const job = await request("/api/downloads", { method: "POST", body: message.payload });
    pollUntilReady(job.id);
    return job;
  }
  return { error: "Unknown message type" };
}

async function request(path, options = {}) {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  const response = await fetch(`${settings.apiBase}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(settings.apiToken ? { Authorization: `Bearer ${settings.apiToken}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Backend request failed");
  return data;
}

async function pollUntilReady(id) {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  const timer = setInterval(async () => {
    try {
      const job = await request(`/api/downloads/${id}`);
      if (job.state === "Completed") {
        clearInterval(timer);
        const url = `${settings.apiBase}/api/downloads/${id}/file${settings.apiToken ? `?token=${encodeURIComponent(settings.apiToken)}` : ""}`;
        chrome.downloads.download({ url, filename: job.fileName, saveAs: true });
      }
      if (["Failed", "Canceled"].includes(job.state)) clearInterval(timer);
    } catch {
      clearInterval(timer);
    }
  }, 1500);
}

