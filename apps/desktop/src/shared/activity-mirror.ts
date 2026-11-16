import { validateRange } from "./activitywatch";
import type { ActivityWatchCategory, ActivityWatchRange, ActivityWatchSnapshot } from "./desktop-api";

export interface ActivityMirror {
  version: 1;
  snapshot: ActivityWatchSnapshot;
  categories: ActivityWatchCategory[];
}

export function selectMirrorRange(mirror: ActivityMirror, input: ActivityWatchRange): ActivityWatchSnapshot {
  const range = validateRange(input);
  const start = range.start === null ? -Infinity : Date.parse(range.start);
  const end = Date.parse(range.end);
  const counts = new Map<string, number>();
  function clip<T extends { timestamp: string; duration: number; bucketId: string }>(rows: T[]): T[] {
    return rows.flatMap(row => {
      const timestamp = Date.parse(row.timestamp);
      const from = Math.max(timestamp, start);
      const duration = (Math.min(timestamp + row.duration * 1000, end) - from) / 1000;
      if (duration <= 0) return [];
      counts.set(row.bucketId, (counts.get(row.bucketId) ?? 0) + 1);
      return from === timestamp && duration === row.duration ? [row] : [{ ...row, timestamp: new Date(from).toISOString(), duration }];
    });
  }
  const events = clip(mirror.snapshot.events);
  const tabs = range.includeBrowserTabs ? clip(mirror.snapshot.tabs) : [];
  const buckets = mirror.snapshot.buckets
    .filter(bucket => range.includeBrowserTabs || bucket.type !== "web.tab.current" || /android/i.test(bucket.id))
    .map(bucket => ({ ...bucket, eventCount: counts.get(bucket.id) ?? 0 }));
  return { ...mirror.snapshot, buckets, events, tabs, source: "desktop-mirror" };
}
