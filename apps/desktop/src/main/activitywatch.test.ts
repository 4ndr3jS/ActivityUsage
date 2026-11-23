import { afterEach, expect, it, vi } from "vitest";
import { readActivityWatchCategories, readActivityWatchData } from "../shared/activitywatch";

afterEach(() => vi.unstubAllGlobals());

it("loads collected history beyond one year when the start date is open", async () => {
  const fetch = vi.fn(async (url: string) => {
    const request = new URL(url);
    if (request.pathname === "/api/0/buckets/") {
      return Response.json([{ id: "windows", type: "currentwindow" }]);
    }
    return Response.json([
      { timestamp: "2026-11-15T23:59:50Z", duration: 20 },
      { timestamp: "2024-01-01T00:00:00Z", duration: 60 }
    ]);
  });
  vi.stubGlobal("fetch", fetch);

  const snapshot = await readActivityWatchData({ start: null, end: "2026-11-16T00:00:00Z" });

  const request = new URL(fetch.mock.calls[1]![0]);
  expect(request.searchParams.has("start")).toBe(false);
  expect(request.searchParams.get("end")).toBe("2026-11-16T00:00:00.000Z");
  expect(snapshot.events).toMatchObject([
    { timestamp: "2024-01-01T00:00:00.000Z", duration: 60 },
    { timestamp: "2026-11-15T23:59:50.000Z", duration: 10 }
  ]);
});

it("reads the effective ActivityWatch classes, retaining hierarchy, colors, and rule fields", async () => {
  const fetch = vi.fn(async () => Response.json([
    { name: ["Reading"], data: { color: "#aabbcc" }, rule: { type: "none" } },
    { name: ["Reading", "Books"], rule: { type: "regex", regex: "Novel", ignore_case: true } },
    { name: ["Games"], rule: { type: "regex", regex: "^Game$", select_keys: ["app"], priority: 30 } },
    { name: [""] }
  ]));
  vi.stubGlobal("fetch", fetch);

  expect(await readActivityWatchCategories()).toEqual([
    { path: ["Reading"], color: "#aabbcc", rule: null },
    { path: ["Reading", "Books"], color: null, rule: { pattern: "Novel", ignoreCase: true, priority: 20, fields: ["app", "title"] } },
    { path: ["Games"], color: null, rule: { pattern: "^Game$", ignoreCase: false, priority: 30, fields: ["app"] } }
  ]);
  expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:5600/api/0/settings/classes", expect.any(Object));
});

it("keeps synced PDF intervals and decoded browser filenames out of app totals", async () => {
  const phone = "aw-watcher-pdf-android_phone-synced-from-samsung";
  const tab = "aw-watcher-web-brave_PC";
  const phoneTab = "aw-watcher-android-web-synced-from-samsung";
  const fetch = vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    if (path === "/api/0/buckets/") return Response.json([
      { id: phone, type: "document.pdf.current" },
      { id: tab, type: "web.tab.current" },
      { id: phoneTab, type: "web.tab.current" }
    ]);
    return Response.json([{
      timestamp: "2026-11-19T23:59:50Z", duration: 30,
      data: path.includes(phone) ? { filename: "COTE Y3V3.pdf" }
        : path.includes(phoneTab) ? { title: "Spotify", url: "https://open.spotify.com", browser: "com.android.chrome" }
          : { title: "Sample", url: "file:///private/folder/COTE%20Y3V3.pdf#page=1" }
    }]);
  });
  vi.stubGlobal("fetch", fetch);
  const range = { start: "2026-11-20T00:00:00Z", end: "2026-11-21T00:00:00Z" };
  expect(await readActivityWatchData(range)).toMatchObject({ events: [], tabs: [], buckets: [] });
  const snapshot = await readActivityWatchData({ ...range, includeBrowserTabs: true });
  expect(snapshot.events).toEqual([]);
  expect(snapshot.pdfs).toEqual([{ timestamp: "2026-11-20T00:00:00.000Z", duration: 20, bucketId: phone, filename: "COTE Y3V3.pdf" }]);
  expect(snapshot.tabs).toMatchObject([
    { page: "Local file", pdfFilename: "COTE Y3V3.pdf", duration: 20 },
    { page: "open.spotify.com", browser: "com.android.chrome", duration: 20 }
  ]);
});
