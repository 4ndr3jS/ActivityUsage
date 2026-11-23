import type { ActivityWatchRange, ActivityWatchSnapshot } from "../shared/desktop-api";
import { sliceActivitySnapshot } from "../shared/activity-mirror";

const FRESH_MS = 60_000;
const MAX_SNAPSHOTS = 6;

export function activitySnapshotKey({ start, end, includeBrowserTabs }: ActivityWatchRange): string {
  return JSON.stringify([start, end, includeBrowserTabs === true]);
}

export function coveringActivitySnapshot(
  snapshots: ReadonlyMap<string, ActivityWatchSnapshot>,
  range: ActivityWatchRange
): ActivityWatchSnapshot | null {
  const from = range.start === null ? -Infinity : Date.parse(range.start);
  const to = Date.parse(range.end);
  let latest: ActivityWatchSnapshot | undefined;
  for (const [key, snapshot] of snapshots) {
    const [start, end, includesTabs] = JSON.parse(key) as [string | null, string, boolean];
    if (range.includeBrowserTabs && !includesTabs) continue;
    if ((start !== null && Date.parse(start) > from) || Date.parse(end) < to) continue;
    if (!latest || Date.parse(snapshot.fetchedAt) > Date.parse(latest.fetchedAt)) latest = snapshot;
  }
  return latest ? sliceActivitySnapshot(latest, range) : null;
}

export function createActivitySnapshotCache(
  fetchSnapshot: (range: ActivityWatchRange) => Promise<ActivityWatchSnapshot>,
  publish: (snapshots: ReadonlyMap<string, ActivityWatchSnapshot>) => void
) {
  let snapshots = new Map<string, ActivityWatchSnapshot>();
  const pending = new Map<string, Promise<ActivityWatchSnapshot>>();
  const lastRead = new Map<string, number>();
  let reads = 0;

  return function read(range: ActivityWatchRange, refresh = false): Promise<ActivityWatchSnapshot> {
    const key = activitySnapshotKey(range);
    lastRead.set(key, ++reads);
    const request = pending.get(key);
    if (request) return request;

    const cached = snapshots.get(key);
    if (!refresh && cached && Date.now() - Date.parse(cached.fetchedAt) < FRESH_MS) {
      return Promise.resolve(cached);
    }

    const next = fetchSnapshot(range).then(snapshot => {
      const updated = new Map(snapshots);
      updated.set(key, snapshot);
      if (updated.size > MAX_SNAPSHOTS) {
        const [oldest] = [...updated.keys()].sort((a, b) => lastRead.get(a)! - lastRead.get(b)!);
        updated.delete(oldest);
        if (!pending.has(oldest)) lastRead.delete(oldest);
      }
      snapshots = updated;
      publish(snapshots);
      return snapshot;
    }).finally(() => {
      pending.delete(key);
      if (!snapshots.has(key)) lastRead.delete(key);
    });
    pending.set(key, next);
    return next;
  };
}
