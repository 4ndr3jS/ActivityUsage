import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  net,
  protocol,
  screen,
  session,
  shell,
  type IpcMainInvokeEvent
} from "electron";
import squirrelStartup from "electron-squirrel-startup";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readActivityWatchCategories, readActivityWatchData } from "./activitywatch";
import { configureAutoUpdates, type DesktopUpdater } from "./updates";
import { DOWNLOAD_PAGE_URL } from "./update-feed";
import { windowSizeForWorkArea } from "./window-sizing";
import type { AppRoute } from "../shared/desktop-api";
import { IPC } from "../shared/desktop-api";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

app.enableSandbox();
app.setName("Activity Usage");
if (process.platform === "win32") {
  app.setAppUserModelId(app.isPackaged ? "com.squirrel.ActivityUsage.ActivityUsage" : "com.activityusage.desktop.dev");
}

let mainWindow: BrowserWindow | null = null;
let updater: DesktopUpdater;
let installPendingUpdate: (() => void) | null = null;

const allowedExternalHosts = new Set(["usageatlas.com", "github.com"]);
const windowChrome = {
  light: { backgroundColor: "#f5f5f7", symbolColor: "#1d1d1f" },
  dark: { backgroundColor: "#1c1c1e", symbolColor: "#f5f5f7" }
} as const;

function runtimeIconPath(filename: "activityusage.ico" | "activityusage.png"): string {
  const directory = app.isPackaged ? path.join(process.resourcesPath, "icons") : path.join(app.getAppPath(), "resources", "icons");
  return path.join(directory, filename);
}

function runtimeLogo(): Electron.NativeImage {
  const image = nativeImage.createFromPath(runtimeIconPath("activityusage.png"));
  if (image.isEmpty()) throw new Error("Activity Usage application icon could not be loaded.");
  return image;
}

function trustedRendererUrl(value: string): boolean {
  try {
    const candidate = new URL(value);
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) return candidate.origin === new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin;
    return candidate.protocol === "app:" && candidate.hostname === "activityusage";
  } catch {
    return false;
  }
}

function allowedExternalUrl(value: string): boolean {
  try {
    const candidate = new URL(value);
    return candidate.protocol === "https:" && allowedExternalHosts.has(candidate.hostname);
  } catch {
    return false;
  }
}

function createWindow(route: AppRoute = "day"): BrowserWindow {
  const chrome = nativeTheme.shouldUseDarkColors ? windowChrome.dark : windowChrome.light;
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { width, height, minWidth, minHeight } = windowSizeForWorkArea(workArea);
  const window = new BrowserWindow({
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
    minWidth,
    minHeight,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: chrome.backgroundColor,
    icon: process.platform === "win32" ? nativeImage.createFromPath(runtimeIconPath("activityusage.ico")) : runtimeLogo(),
    roundedCorners: true,
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const }
      : { titleBarStyle: "hidden" as const, titleBarOverlay: { color: chrome.backgroundColor, symbolColor: chrome.symbolColor, height: 40 } }),
    title: "Activity Usage",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  window.setAspectRatio(16 / 9);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (allowedExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!trustedRendererUrl(url)) event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());
  window.once("closed", () => { if (mainWindow === window) mainWindow = null; });

  const syncChrome = (): void => {
    const next = nativeTheme.shouldUseDarkColors ? windowChrome.dark : windowChrome.light;
    window.setBackgroundColor(next.backgroundColor);
    if (process.platform !== "darwin") window.setTitleBarOverlay({ color: next.backgroundColor, symbolColor: next.symbolColor, height: 40 });
  };
  nativeTheme.on("updated", syncChrome);
  window.once("closed", () => nativeTheme.off("updated", syncChrome));

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const url = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    url.hash = route;
    void window.loadURL(url.toString());
  } else {
    void window.loadURL(`app://activityusage/index.html#${route}`);
  }
  return window;
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const frame = event.senderFrame;
  if (!frame || frame !== frame.top || !trustedRendererUrl(frame.url)) throw new Error("Untrusted IPC sender.");
}

function registerIPC(): void {
  ipcMain.handle(IPC.activityWatchData, (event, range: unknown) => {
    assertTrustedSender(event);
    return readActivityWatchData(range);
  });
  ipcMain.handle(IPC.activityWatchCategories, event => {
    assertTrustedSender(event);
    return readActivityWatchCategories();
  });
  ipcMain.handle(IPC.saveActivityWatchExport, async (event, json: unknown) => {
    assertTrustedSender(event);
    if (typeof json !== "string" || json.length > 15 * 1024 * 1024) throw new Error("The activity export is too large.");
    try {
      const parsed: unknown = JSON.parse(json);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid export data.");
    } catch {
      throw new Error("The activity export is not valid JSON.");
    }
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.SaveDialogOptions = {
      title: "Export device activity summary",
      defaultPath: path.join(app.getPath("downloads"), "activityusage-device-activity.json"),
      filters: [{ name: "JSON summary", extensions: ["json"] }]
    };
    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return false;
    writeFileSync(result.filePath, json, "utf8");
    return true;
  });
  ipcMain.handle(IPC.getUpdateState, event => {
    assertTrustedSender(event);
    return updater.getState();
  });
  ipcMain.handle(IPC.checkForUpdates, event => {
    assertTrustedSender(event);
    return updater.check();
  });
  ipcMain.handle(IPC.installUpdate, async event => {
    assertTrustedSender(event);
    if (updater.getState().status === "ready" && installPendingUpdate) installPendingUpdate();
    else if (updater.getState().status === "available") await shell.openExternal(DOWNLOAD_PAGE_URL);
    else throw new Error("No update is ready to install.");
  });
}

async function registerApplicationProtocol(): Promise<void> {
  const rendererRoot = path.resolve(__dirname, "../renderer", MAIN_WINDOW_VITE_NAME);
  protocol.handle("app", request => {
    const parsed = new URL(request.url);
    if (parsed.hostname !== "activityusage") return new Response("Not found", { status: 404 });
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) return new Response("Not found", { status: 404 });
    const relativePath = decodeURIComponent(parsed.pathname).replace(/^\/+/, "") || "index.html";
    const requestedPath = path.resolve(rendererRoot, relativePath);
    if (requestedPath !== rendererRoot && !requestedPath.startsWith(`${rendererRoot}${path.sep}`)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(requestedPath).toString());
  });
}

if (squirrelStartup || !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show();
    mainWindow?.focus();
  });
  void app.whenReady().then(async () => {
    if (process.platform === "darwin") app.dock?.setIcon(runtimeLogo());
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    await registerApplicationProtocol();
    updater = configureAutoUpdates({
      onStateChange: state => mainWindow?.webContents.send(IPC.updateStateChanged, state),
      onUpdateReady: install => { installPendingUpdate = install; }
    });
    registerIPC();
    mainWindow = createWindow();
    app.on("activate", () => {
      if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow();
      else { mainWindow.show(); mainWindow.focus(); }
    });
  }).catch(error => {
    console.error("Activity Usage could not start.", error);
    app.quit();
  });
}

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
