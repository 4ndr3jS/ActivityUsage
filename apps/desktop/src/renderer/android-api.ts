import { readActivityWatchCategories, readActivityWatchData } from "../shared/activitywatch";
import { selectMirrorRange, type ActivityMirror } from "../shared/activity-mirror";
import type { ActivityUsageDesktopAPI, DesktopUpdateState } from "../shared/desktop-api";

export interface ActivityUsageAndroid {
  hasConnection(): boolean;
  openActivityWatch(): void;
  connectActivityWatch(): void;
  hasSyncFolder(): boolean;
  chooseSyncFolder(): void;
  openPdfTrackingSettings(): void;
  saveExport(json: string): void;
}

const API_PATH = "/activitywatch";
export const ANDROID_CONNECTED_EVENT = "activityusage:android-connected";
const ANDROID_EXPORT_EVENT = "activityusage:android-export";

export function installAndroidAPI(android: ActivityUsageAndroid): void {
  let cached: { version: string; mirror: ActivityMirror } | null = null;
  let pending: Promise<ActivityMirror | null> | null = null;
  window.addEventListener(ANDROID_CONNECTED_EVENT, () => { cached = null; });
  async function readMirror(): Promise<ActivityMirror | null> {
    const response = await fetch("/synced-activity", {
      cache: "no-store",
      headers: cached ? { "X-Snapshot-Version": cached.version } : {},
      signal: AbortSignal.timeout(15_000)
    });
    if (response.status === 204 || !response.ok || !response.body) return cached?.mirror ?? null;
    const json = new Response(response.body.pipeThrough(new DecompressionStream("gzip")));
    const mirror = await json.json() as ActivityMirror;
    if (mirror.version !== 1 || !Array.isArray(mirror.snapshot?.events) ||
      !Array.isArray(mirror.snapshot.buckets) || !Array.isArray(mirror.snapshot.tabs) || !Array.isArray(mirror.categories)) {
      throw new Error("Desktop history copy has an unsupported format.");
    }
    cached = { version: response.headers.get("X-Snapshot-Version") ?? "", mirror };
    return mirror;
  }
  function getMirror(): Promise<ActivityMirror | null> {
    if (!android.hasSyncFolder()) return Promise.resolve(null);
    pending ??= readMirror().catch(() => cached?.mirror ?? null).finally(() => { pending = null; });
    return pending;
  }
  const updates: DesktopUpdateState = { status: "unavailable", currentVersion: "", availableVersion: null, error: null };
  const api: Pick<ActivityUsageDesktopAPI,
    "platform" | "getActivityWatchData" | "getActivityWatchCategories" | "saveActivityWatchExport" |
    "getUpdateState" | "checkForUpdates" | "installUpdate" | "onUpdateState"
  > = {
    platform: "android",
    getActivityWatchData: async range => {
      const mirror = await getMirror();
      if (mirror) return selectMirrorRange(mirror, range);
      return { ...await readActivityWatchData(range, API_PATH), source: "android-local" };
    },
    getActivityWatchCategories: async () => (await getMirror())?.categories ?? readActivityWatchCategories(API_PATH),
    saveActivityWatchExport: json => new Promise((resolve, reject) => {
      const complete = (event: Event) => {
        const result = (event as CustomEvent<boolean | null>).detail;
        if (result === null) reject(new Error("The activity summary could not be saved."));
        else resolve(result);
      };
      window.addEventListener(ANDROID_EXPORT_EVENT, complete, { once: true });
      try {
        android.saveExport(json);
      } catch (error) {
        window.removeEventListener(ANDROID_EXPORT_EVENT, complete);
        reject(error);
      }
    }),
    getUpdateState: async () => updates,
    checkForUpdates: async () => updates,
    installUpdate: async () => {},
    onUpdateState: () => () => {}
  };
  Object.defineProperty(window, "usageAtlas", { value: Object.freeze(api) });
}
