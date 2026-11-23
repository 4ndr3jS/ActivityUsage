import { expect, it } from "vitest";
import type { ActivityWatchBucket, ActivityWatchRecord, ActivityWatchSnapshot } from "../shared/desktop-api";
import { buildActivityStatistics, rankActivity } from "./activity-statistics";

const title = "Classroom of the Elite: Year 3 Volume 3";
const filename = "COTE Y3V3.pdf";
const start = Date.parse("2026-11-20T00:00:00Z");

function timestamp(hours: number): string {
  return new Date(start + hours * 3_600_000).toISOString();
}

function bucket(id: string, type: string, hostname = "PC"): ActivityWatchBucket {
  return { id, type, hostname, device: "computer", lastUpdated: null, eventCount: 0, error: null };
}

function window(hour: number, duration: number, title: string, app = "brave.exe"): ActivityWatchRecord {
  return { timestamp: timestamp(hour), duration, title, app, device: "computer", bucketId: "windows" };
}

const period = { start: new Date(start), end: new Date(timestamp(12)) };

it("attributes foreground PDF spans to Reading without adding duplicate watcher time", () => {
  const tab = { timestamp: timestamp(1), duration: 4 * 3600, title, browser: null, site: "Local files",
    page: "Local file", bucketId: "aw-watcher-web-brave_PC", pdfFilename: filename };
  const viewing = { timestamp: timestamp(7), duration: 7200, filename: filename.toUpperCase(), bucketId: "phone-pdf" };
  const snapshot: ActivityWatchSnapshot = {
    connected: true, fetchedAt: timestamp(10),
    buckets: [bucket("windows", "currentwindow"), bucket(tab.bucketId, "web.tab.current")],
    events: [
      window(1, 4 * 3600, title + " - Brave"),
      window(2, 3600, "File Explorer", "explorer.exe"),
      { ...window(6, 3 * 3600, "", "My Files"), device: "phone", bucketId: "phone" }
    ],
    tabs: [tab, tab],
    pdfs: [viewing, viewing]
  };
  const stats = buildActivityStatistics(snapshot.events, [], period, false, true, snapshot);
  const classroom = stats.categoriesById.get('["Reading","Classroom of the Elite"]')!;
  expect(stats.total).toBe(25_200);
  expect(classroom.seconds).toBe(18_000);
  expect(stats.categoriesById.get('["Reading","My Files"]')?.seconds).toBe(3600);
  expect(rankActivity(stats, [classroom]).titles).toEqual([
    { label: title, app: "Brave", seconds: 10_800 },
    { label: filename.toUpperCase(), app: "My Files", seconds: 7200 }
  ]);
});

it("requires desktop PDF evidence and supports native reader window titles", () => {
  const snapshot: ActivityWatchSnapshot = {
    connected: true, fetchedAt: timestamp(10),
    buckets: [bucket("windows", "currentwindow"), bucket("aw-watcher-web-brave_other", "web.tab.current", "other")],
    events: [
      window(0, 30, filename, "explorer.exe"),
      window(1, 30, "Book title - Brave"),
      window(2, 30, "Book.pdf - SumatraPDF", "SumatraPDF.exe")
    ],
    tabs: [{ timestamp: timestamp(1), duration: 30, title: "Book title", browser: null, site: "Local files",
      page: "Local file", bucketId: "aw-watcher-web-brave_other", pdfFilename: filename }]
  };
  const stats = buildActivityStatistics(snapshot.events, [], period, false, true, snapshot);
  expect(stats.categoriesById.get('["Reading"]')?.seconds).toBe(30);
  expect(rankActivity(stats, [stats.categoriesById.get('["Reading"]')!]).titles).toEqual([
    { label: "Book.pdf", app: "Sumatra PDF", seconds: 30 }
  ]);
});
