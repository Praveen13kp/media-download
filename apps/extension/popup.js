const apiBase = document.getElementById("apiBase");
const apiToken = document.getElementById("apiToken");
const status = document.getElementById("status");

chrome.runtime.sendMessage({ type: "settings:get" }, (settings) => {
  apiBase.value = settings.apiBase || "http://localhost:4000";
  apiToken.value = settings.apiToken || "";
});

document.getElementById("save").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({
    type: "settings:set",
    settings: {
      apiBase: apiBase.value,
      apiToken: apiToken.value
    }
  });
  status.textContent = "Saved";
});

