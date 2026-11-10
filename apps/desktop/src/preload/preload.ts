import { contextBridge, ipcRenderer } from "electron";
import type { UsageAtlasDesktopAPI } from "../shared/desktop-api";
import { IPC } from "../shared/desktop-api";

type ActivityOnlyDesktopAPI = Pick<UsageAtlasDesktopAPI,
  "platform" | "getActivityWatchData" | "saveActivityWatchExport" |
  "getUpdateState" | "checkForUpdates" | "installUpdate" | "onUpdateState"
>;

const api: ActivityOnlyDesktopAPI = {
  platform: process.platform,
  getActivityWatchData: range => ipcRenderer.invoke(IPC.activityWatchData, range),
  saveActivityWatchExport: json => ipcRenderer.invoke(IPC.saveActivityWatchExport, json),
  getUpdateState: () => ipcRenderer.invoke(IPC.getUpdateState),
  checkForUpdates: () => ipcRenderer.invoke(IPC.checkForUpdates),
  installUpdate: () => ipcRenderer.invoke(IPC.installUpdate),
  onUpdateState: listener => {
    const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state);
    ipcRenderer.on(IPC.updateStateChanged, handler);
    return () => ipcRenderer.removeListener(IPC.updateStateChanged, handler);
  }
};

contextBridge.exposeInMainWorld("usageAtlas", Object.freeze(api));
