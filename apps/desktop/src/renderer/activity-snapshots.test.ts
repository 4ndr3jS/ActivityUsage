import { expect, it, vi } from "vitest";
import type { ActivityWatchSnapshot } from "../shared/desktop-api";
import { activitySnapshotKey, createActivitySnapshotCache } from "./activity-snapshots";

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
