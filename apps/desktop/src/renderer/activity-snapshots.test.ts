import { expect, it, vi } from "vitest";
import type { ActivityWatchSnapshot } from "../shared/desktop-api";
import { activitySnapshotKey, coveringActivitySnapshot, createActivitySnapshotCache } from "./activity-snapshots";

const history = { start: "2026-10-16T23:00:00.000Z", end: "2026-11-15T23:00:00.000Z" };
const savedSnapshot = (age = 0): ActivityWatchSnapshot => ({
  connected: true, fetchedAt: new Date(Date.now() - age).toISOString(), buckets: [], events: [], tabs: []
});

it("reuses both preloads and keeps the browser records specific to Breakdown", async () => {
  const historySnapshot = savedSnapshot();
  const breakdownSnapshot = savedSnapshot();
  const fetchSnapshot = vi.fn()
    .mockResolvedValueOnce(historySnapshot)
    .mockResolvedValueOnce(breakdownSnapshot);
  const publish = vi.fn();
  const read = createActivitySnapshotCache(fetchSnapshot, publish);

  const breakdown = { ...history, includeBrowserTabs: true };
  const preloadedHistory = read(history);
  const preloadedBreakdown = read(breakdown);
  expect(read({ ...history, includeBrowserTabs: false })).toBe(preloadedHistory);
  expect(read({ ...breakdown })).toBe(preloadedBreakdown);
  await Promise.all([preloadedHistory, preloadedBreakdown]);
  expect(publish.mock.lastCall?.[0].get(activitySnapshotKey(history))).toBe(historySnapshot);
  expect(publish.mock.lastCall?.[0].get(activitySnapshotKey(breakdown))).toBe(breakdownSnapshot);
  expect(await read(history)).toBe(historySnapshot);
  expect(await read(breakdown)).toBe(breakdownSnapshot);
  expect(fetchSnapshot).toHaveBeenCalledTimes(2);
});

it("keeps the cached dates visible during a failed refresh and lets Retry reload them", async () => {
  const cached = savedSnapshot(61_000);
  const updated = savedSnapshot();
  const fetchSnapshot = vi.fn()
    .mockResolvedValueOnce(cached)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(updated);
  const publish = vi.fn();
  const read = createActivitySnapshotCache(fetchSnapshot, publish);

  await read(history);
  const lastPublished = publish.mock.lastCall?.[0];
  await expect(read(history)).rejects.toThrow("offline");
  expect(publish.mock.lastCall?.[0]).toBe(lastPublished);
  expect(lastPublished.get(activitySnapshotKey(history))).toBe(cached);
  await expect(read(history, true)).resolves.toBe(updated);
  expect(publish.mock.lastCall?.[0].get(activitySnapshotKey(history))).toBe(updated);
});

it("clips a cached range to the selected day with browser detail intact", () => {
  const start = "2026-11-01T23:00:00.000Z";
  const end = "2026-11-02T23:00:00.000Z";
  const timestamp = "2026-11-01T22:59:30.000Z";
  const snapshot: ActivityWatchSnapshot = {
    ...savedSnapshot(),
    events: [
      { timestamp, duration: 60, bucketId: "window", device: "computer", app: "Brave", title: "Page" },
      { timestamp: end, duration: 30, bucketId: "window", device: "computer", app: "Brave", title: "Tomorrow" }
    ],
    tabs: [{ timestamp, duration: 60, bucketId: "web", browser: "brave", site: "example.org", page: "example.org", title: "Page" }]
  };
  const cache = new Map([[activitySnapshotKey(history), savedSnapshot()]]);
  const day = { start, end, includeBrowserTabs: true };

  expect(coveringActivitySnapshot(cache, day)).toBeNull();
  cache.set(activitySnapshotKey({ ...history, includeBrowserTabs: true }), snapshot);
  const coveredDay = coveringActivitySnapshot(cache, day);
  expect(coveredDay?.events).toEqual([{ ...snapshot.events[0], timestamp: start, duration: 30 }]);
  expect(coveredDay?.tabs).toEqual([{ ...snapshot.tabs[0], timestamp: start, duration: 30 }]);
  expect(coveringActivitySnapshot(cache, { ...day, end: "2026-11-16T00:00:00.000Z" })).toBeNull();
});
