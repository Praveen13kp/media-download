const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  chooseDownloadFolder: () => ipcRenderer.invoke("choose-download-folder"),
  openPath: (targetPath) => ipcRenderer.invoke("open-path", targetPath)
});

