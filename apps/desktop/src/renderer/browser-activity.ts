import type { ActivityWatchBucket, ActivityWatchRecord, ActivityWatchTab } from "../shared/desktop-api";
import { appLabel } from "./app-label";

export interface BrowserActivityRow {
  label: string;
  address?: string;
  seconds: number;
}

export interface BrowserActivity {
  sites: BrowserActivityRow[];
  pages: BrowserActivityRow[];
  unassignedSeconds: number;
}

interface WindowInterval {
  start: number;
  end: number;
  app: string;
  host: string;
}

interface TabInterval extends ActivityWatchTab {
  start: number;
  end: number;
  host: string;
}

const BROWSERS: Record<string, string> = {
  brave: "brave", "com.brave.browser": "brave", "brave browser": "brave",
  chrome: "chrome", "google chrome": "chrome", "com.android.chrome": "chrome",
  chromium: "chromium", edge: "edge", msedge: "edge", "microsoft edge": "edge", "com.microsoft.emmx": "edge",
  firefox: "firefox", "org.mozilla.firefox": "firefox", safari: "safari",
  opera: "opera", "com.opera.browser": "opera", vivaldi: "vivaldi", "com.vivaldi.browser": "vivaldi",
  "samsung internet": "samsung", "com.sec.android.app.sbrowser": "samsung"
};

function browserOf(raw: string): string | undefined {
  const name = raw.trim().toLowerCase().split(/[\\/]/).at(-1)?.replace(/\.(exe|app|desktop)$/, "") ?? "";
  return Object.hasOwn(BROWSERS, name) ? BROWSERS[name] : undefined;
}

function hostname(bucket: ActivityWatchBucket): string {
  const name = bucket.hostname.trim().toLowerCase();
  return name === "unknown" || name === bucket.id.toLowerCase() ? "" : name;
}

function add(rows: Map<string, BrowserActivityRow>, label: string, seconds: number, address?: string): void {
  const key = JSON.stringify([label, address]);
  const row = rows.get(key);
  if (row) row.seconds += seconds;
  else rows.set(key, { label, address, seconds });
}

/** Use tab records only to label existing foreground intervals, never as additional time. */
export function buildBrowserActivity(
  events: ActivityWatchRecord[],
  tabs: ActivityWatchTab[],
  buckets: ActivityWatchBucket[]
): Map<string, BrowserActivity> {
  const sources = new Map(buckets.map(bucket => [bucket.id, bucket]));
  const windowsByBrowser = new Map<string, WindowInterval[]>();
  for (const event of events) {
    const bucket = sources.get(event.bucketId);
    const browser = event.app && browserOf(event.app);
    if (!browser || bucket?.type !== "currentwindow") continue;
    const key = `${event.device}:${browser}`;
    let windows = windowsByBrowser.get(key);
    if (!windows) windowsByBrowser.set(key, windows = []);
    const start = Date.parse(event.timestamp);
    windows.push({ start, end: start + event.duration * 1000, app: appLabel(event.app), host: hostname(bucket) });
  }

  const tabsByBrowser = new Map<string, TabInterval[]>();
  for (const tab of tabs) {
    const source = sources.get(tab.bucketId);
    if (!source) continue;
    const browser = browserOf(tab.browser ?? "") ?? browserOf(/^aw-watcher-web-([^_]+)/.exec(tab.bucketId)?.[1] ?? "");
    const key = `${source.device}:${browser}`;
    if (!windowsByBrowser.has(key)) continue;
    let intervals = tabsByBrowser.get(key);
    if (!intervals) tabsByBrowser.set(key, intervals = []);
    const start = Date.parse(tab.timestamp);
    intervals.push({ ...tab, start, end: start + tab.duration * 1000, host: hostname(source) });
  }

  const apps = new Map<string, {
    sites: Map<string, BrowserActivityRow>; pages: Map<string, BrowserActivityRow>; unassignedSeconds: number;
  }>();
  for (const [key, windows] of windowsByBrowser) {
    const intervals = (tabsByBrowser.get(key) ?? []).sort((a, b) => a.start - b.start);
    const hosts = new Set(windows.map(window => window.host));
    let maxEnd = -Infinity;
    const maxEnds = intervals.map(tab => maxEnd = Math.max(maxEnd, tab.end));
    for (const window of windows) {
      let app = apps.get(window.app);
      if (!app) apps.set(window.app, app = { sites: new Map(), pages: new Map(), unassignedSeconds: 0 });
      // Find overlapping tabs without scanning the whole preceding history.
      let low = 0;
      let high = intervals.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (intervals[mid].start < window.end) low = mid + 1;
        else high = mid;
      }
      const candidates: TabInterval[] = [];
      const cuts = new Set([window.start, window.end]);
      for (let i = low - 1; i >= 0 && maxEnds[i] > window.start; i--) {
        const tab = intervals[i];
        if (tab.end <= window.start || (tab.host ? tab.host !== window.host : hosts.size !== 1)) continue;
        candidates.push(tab);
        cuts.add(Math.max(window.start, tab.start));
        cuts.add(Math.min(window.end, tab.end));
      }
      // Prefer the matching host, then the latest tab when watchers overlap.
      candidates.sort((a, b) => Number(Boolean(b.host)) - Number(Boolean(a.host)) || b.start - a.start);
      const boundaries = [...cuts].sort((a, b) => a - b);
      for (let i = 1; i < boundaries.length; i++) {
        const start = boundaries[i - 1];
        const end = boundaries[i];
        const seconds = (end - start) / 1000;
        const tab = candidates.find(item => item.start <= start && item.end >= end);
        if (tab) {
          add(app.sites, tab.site, seconds);
          add(app.pages, tab.title ?? tab.page, seconds, tab.title ? tab.page : undefined);
        } else app.unassignedSeconds += seconds;
      }
    }
  }
  const ranked = (rows: Map<string, BrowserActivityRow>): BrowserActivityRow[] =>
    [...rows.values()].sort((a, b) => b.seconds - a.seconds || a.label.localeCompare(b.label));
  return new Map([...apps].map(([app, data]) => [app, {
    sites: ranked(data.sites), pages: ranked(data.pages), unassignedSeconds: data.unassignedSeconds
  }]));
}
