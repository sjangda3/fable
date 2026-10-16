import { contextBridge, ipcRenderer } from "electron";
import type { AppEvent, FableAPI } from "../../../packages/contracts/index.ts";

const api: FableAPI = {
  platform: process.platform,
  async request(operation, args) {
    const response = await ipcRenderer.invoke("fable:request", operation, args);
    if (response.error)
      throw Object.assign(new Error(response.error), { code: response.code });
    return response.result;
  },
  subscribe(listener) {
    const handle = (_event: Electron.IpcRendererEvent, value: AppEvent) =>
      listener(value);
    ipcRenderer.on("fable:event", handle);
    return () => ipcRenderer.removeListener("fable:event", handle);
  },
  beforeClose(save) {
    const handle = async () => {
      let saved = false;
      try {
        saved = await save();
      } finally {
        ipcRenderer.send("fable:close-ready", saved);
      }
    };
    ipcRenderer.on("fable:before-close", handle);
    return () => ipcRenderer.removeListener("fable:before-close", handle);
  },
  openExternal: (url) => ipcRenderer.invoke("fable:external", url),
  copyText: (text) => ipcRenderer.invoke("fable:copy", text),
};
contextBridge.exposeInMainWorld("fable", api);
ipcRenderer.on("fable:shortcut", (_event, command) => {
  if (command === "new-note" || command === "close-tab")
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: command === "new-note" ? "n" : "w",
        metaKey: process.platform === "darwin",
        ctrlKey: process.platform !== "darwin",
      }),
    );
});
