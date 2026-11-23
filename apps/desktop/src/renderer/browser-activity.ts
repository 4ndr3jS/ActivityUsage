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

export interface ActivitySpan {
  start: number;
  end: number;
}

interface TabInterval extends ActivityWatchTab, ActivitySpan {
  host: string;
  chapterTitle: boolean;
}

const BROWSERS: Record<string, string> = {
  brave: "brave", "com.brave.browser": "brave", "brave browser": "brave",
  chrome: "chrome", "google chrome": "chrome", "com.android.chrome": "chrome",
  chromium: "chromium", edge: "edge", msedge: "edge", "microsoft edge": "edge", "com.microsoft.emmx": "edge",
  firefox: "firefox", "org.mozilla.firefox": "firefox", safari: "safari",
  opera: "opera", "com.opera.browser": "opera", vivaldi: "vivaldi", "com.vivaldi.browser": "vivaldi",
  "samsung internet": "samsung", "com.sec.android.app.sbrowser": "samsung"
};

export function browserOf(raw: string): string | undefined {
  const name = raw.trim().toLowerCase().split(/[\\/]/).at(-1)?.replace(/\.(exe|app|desktop)$/, "") ?? "";
  return Object.hasOwn(BROWSERS, name) ? BROWSERS[name] : undefined;
}

export function browserHostname(bucket: ActivityWatchBucket): string {
  const name = bucket.hostname.trim().toLowerCase();
  return name === "unknown" || name === bucket.id.toLowerCase() ? "" : name;
}

export function tabBrowser(tab: ActivityWatchTab): string | undefined {
  return browserOf(tab.browser ?? "") ?? browserOf(/^aw-watcher-web-([^_]+)/.exec(tab.bucketId)?.[1] ?? "");
}

export function indexActivitySpans<T extends ActivitySpan>(spans: T[]) {
  spans.sort((a, b) => a.start - b.start);
  let maxEnd = -Infinity;
  const maxEnds = spans.map(span => maxEnd = Math.max(maxEnd, span.end));
  return (start: number, end: number): T[] => {
    let low = 0;
    let high = spans.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (spans[mid].start < end) low = mid + 1;
      else high = mid;
    }
    const overlaps: T[] = [];
    for (let i = low - 1; i >= 0 && maxEnds[i] > start; i--) {
      if (spans[i].end > start) overlaps.push(spans[i]);
    }
    return overlaps;
  };
}

/** Candidates are ordered by preference. Leave uncovered portions in the result. */
export function* splitActivitySpan<T extends ActivitySpan>(start: number, end: number, candidates: T[]) {
  const cuts = new Set([start, end]);
  for (const span of candidates) {
    cuts.add(Math.max(start, span.start));
    cuts.add(Math.min(end, span.end));
  }
  const boundaries = [...cuts].sort((a, b) => a - b);
  for (let i = 1; i < boundaries.length; i++) {
    const start = boundaries[i - 1];
    const end = boundaries[i];
    yield { start, end, match: candidates.find(span => span.start <= start && span.end >= end) };
  }
}

export function createBrowserTabMatcher(events: ActivityWatchRecord[], tabs: ActivityWatchTab[], buckets: ActivityWatchBucket[]) {
  const sources = new Map(buckets.map(bucket => [bucket.id, bucket]));
  const hostsByBrowser = new Map<string, Set<string>>();
  for (const event of events) {
    const browser = event.app && browserOf(event.app);
    const source = sources.get(event.bucketId);
    if (!browser || source?.type !== "currentwindow") continue;
    const key = `${event.device}:${browser}`;
    let hosts = hostsByBrowser.get(key);
    if (!hosts) hostsByBrowser.set(key, hosts = new Set());
    hosts.add(browserHostname(source));
  }

  const tabsByBrowser = new Map<string, TabInterval[]>();
  for (const tab of tabs) {
    const source = sources.get(tab.bucketId);
    const browser = tabBrowser(tab);
    if (!source || !browser) continue;
    const key = `${source.device}:${browser}`;
    if (!hostsByBrowser.has(key)) continue;
    let intervals = tabsByBrowser.get(key);
    if (!intervals) tabsByBrowser.set(key, intervals = []);
    const start = Date.parse(tab.timestamp);
    intervals.push({
      ...tab, start, end: start + tab.duration * 1000, host: browserHostname(source),
      chapterTitle: Boolean(tab.title && source.id.startsWith("aw-watcher-anime-anyway-android_"))
    });
  }
  const indexes = new Map([...tabsByBrowser].map(([key, intervals]) => [key, indexActivitySpans(intervals)]));

  return (event: ActivityWatchRecord, start: number, end: number): TabInterval[] => {
    const source = sources.get(event.bucketId);
    const browser = event.app && browserOf(event.app);
    if (!browser || source?.type !== "currentwindow") return [];
    const key = `${event.device}:${browser}`;
    const host = browserHostname(source);
    const overlaps = indexes.get(key)?.(start, end) ?? [];
    // The Android chapter watcher carries a page title even when the browser watcher only sees a domain.
    return overlaps.filter(tab => tab.host ? tab.host === host : hostsByBrowser.get(key)?.size === 1)
      .sort((a, b) => Number(Boolean(b.host)) - Number(Boolean(a.host)) ||
        Number(b.chapterTitle) - Number(a.chapterTitle) || b.start - a.start);
  };
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
  const matchTabs = createBrowserTabMatcher(events, tabs, buckets);
  const apps = new Map<string, {
    sites: Map<string, BrowserActivityRow>; pages: Map<string, BrowserActivityRow>; unassignedSeconds: number;
  }>();
  for (const event of events) {
    if (!event.app || !browserOf(event.app) || sources.get(event.bucketId)?.type !== "currentwindow") continue;
    const label = appLabel(event.app);
    let app = apps.get(label);
    if (!app) apps.set(label, app = { sites: new Map(), pages: new Map(), unassignedSeconds: 0 });
    const start = Date.parse(event.timestamp);
    const end = start + event.duration * 1000;
    for (const part of splitActivitySpan(start, end, matchTabs(event, start, end))) {
      const seconds = (part.end - part.start) / 1000;
      const tab = part.match;
      if (tab) {
        add(app.sites, tab.site, seconds);
        add(app.pages, tab.title ?? tab.page, seconds, tab.title ? tab.page : undefined);
      } else app.unassignedSeconds += seconds;
    }
  }
  const ranked = (rows: Map<string, BrowserActivityRow>): BrowserActivityRow[] =>
    [...rows.values()].sort((a, b) => b.seconds - a.seconds || a.label.localeCompare(b.label));
  return new Map([...apps].map(([app, data]) => [app, {
    sites: ranked(data.sites), pages: ranked(data.pages), unassignedSeconds: data.unassignedSeconds
  }]));
}
