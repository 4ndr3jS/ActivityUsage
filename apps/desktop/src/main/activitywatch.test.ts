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
