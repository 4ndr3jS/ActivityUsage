import { describe, expect, it } from "vitest";
import { pageAddress } from "../shared/browser-page";
import type { ActivityWatchBucket, ActivityWatchRecord, ActivityWatchTab } from "../shared/desktop-api";
import { buildBrowserActivity } from "./browser-activity";

const timestamp = (second: number): string => new Date(second * 1000).toISOString();
const bucket = (id: string, hostname: string, type: string, device: "computer" | "phone" = "computer"): ActivityWatchBucket =>
  ({ id, hostname, type, device, lastUpdated: null, eventCount: 0, error: null });
const windowEvent = (bucketId: string, app: string, start: number, duration: number, device: "computer" | "phone" = "computer"): ActivityWatchRecord =>
  ({ bucketId, timestamp: timestamp(start), duration, device, app, title: null });
const tab = (bucketId: string, page: string, start: number, duration: number, browser: string | null = null): ActivityWatchTab =>
  ({ bucketId, timestamp: timestamp(start), duration, browser, site: "example.com", page: `example.com/${page}`, title: page });

describe("browser activity", () => {
  it("splits a foreground interval between tabs and reports gaps without adding tab time", () => {
    const watcher = "aw-watcher-web-brave_pc";
    const legacyWatcher = "aw-watcher-web-brave";
    const result = buildBrowserActivity([windowEvent("windows", "brave.exe", 10, 22)], [
      tab(watcher, "Article A", 1, 17),
      tab(watcher, "Article B", 16, 9),
      tab(legacyWatcher, "Duplicate", 14, 7),
      tab(watcher, "Background", 40, 60)
    ], [bucket("windows", "pc", "currentwindow"), bucket(watcher, "pc", "web.tab.current"), bucket(legacyWatcher, "unknown", "web.tab.current")]);
    expect(result.get("Brave")).toEqual({
      sites: [{ label: "example.com", seconds: 15 }],
      pages: [
        { label: "Article B", address: "example.com/Article B", seconds: 9 },
        { label: "Article A", address: "example.com/Article A", seconds: 6 }
      ],
      unassignedSeconds: 7
    });
  });

  it("matches phone Chrome by its package and excludes desktop Chrome, other browsers and hosts", () => {
    const phoneWeb = "aw-watcher-android-web-synced-from-phone";
    const desktopWeb = "aw-watcher-web-chrome_pc";
    const result = buildBrowserActivity([windowEvent("phone", "Chrome", 1, 20, "phone")], [
      tab(phoneWeb, "Article", 4, 5, "com.android.chrome"),
      tab(phoneWeb, "Brave page", 6, 10, "com.brave.browser"),
      tab(desktopWeb, "Desktop page", 1, 20),
      tab("other-phone", "Other phone", 1, 20, "com.android.chrome")
    ], [
      bucket("phone", "samsung", "currentwindow", "phone"),
      bucket(phoneWeb, "samsung", "web.tab.current", "phone"),
      bucket("other-phone", "other", "web.tab.current", "phone"),
      bucket(desktopWeb, "pc", "web.tab.current")
    ]);
    expect(result.get("Google Chrome")?.pages.map(page => page.label)).toEqual(["Article"]);
    expect(result.get("Google Chrome")?.unassignedSeconds).toBe(15);
  });

  it("omits sensitive URL parts and local paths from page labels", () => {
    expect(pageAddress("https://user:secret@www.example.com/article?token=private#anchor"))
      .toEqual({ site: "example.com", page: "example.com/article" });
    expect(pageAddress("file:///private/notes.txt")).toEqual({ site: "Local files", page: "Local file" });
    expect(pageAddress("example.com/read")).toEqual({ site: "example.com", page: "example.com/read" });
    expect(pageAddress("https://")).toBeNull();
  });
});
