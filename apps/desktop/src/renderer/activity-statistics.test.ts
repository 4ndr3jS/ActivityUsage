import { expect, it } from "vitest";
import type { ActivityWatchRecord, ActivityWatchCategory } from "../shared/desktop-api";
import { buildActivityStatistics, directCategoryColor, directCategoryTime, rankActivity } from "./activity-statistics";
import { PALETTE } from "./components/dither-kit/palette";

const start = new Date(2026, 0, 1);
const period = { start, end: new Date(2026, 0, 2) };
function event(minute: number, duration: number, app: string, title: string | null, device: "computer" | "phone" = "computer"): ActivityWatchRecord {
  return { timestamp: new Date(+start + minute * 60_000).toISOString(), duration, app, title, device, bucketId: device };
}

const rules: ActivityWatchCategory[] = [
  { path: ["Reading"], color: "#36a", rule: null },
  { path: ["Reading", "Books"], color: null, rule: { pattern: "Novel", ignoreCase: true, fields: ["title"], priority: 20 } },
  { path: ["Games"], color: null, rule: { pattern: "^Game$", ignoreCase: false, fields: ["app"], priority: 30 } },
  { path: ["Invalid"], color: null, rule: { pattern: "(", ignoreCase: false, fields: ["title"], priority: 40 } }
];

it("uses the highest matching rule and rolls times and rankings up the category tree", () => {
  const stats = buildActivityStatistics([
    event(0, 120, "Reader", "A novel"),
    event(2, 60, "Game", "A novel"),
    event(3, 30, "Novel", "Other"),
    event(4, 20, "Reader", "Another novel"),
    event(5, 10, "Reader", "Game"),
  ], rules, period, true, true);
  const [reading, games, uncategorized] = stats.categories;
  expect(stats.total).toBe(240);
  expect(stats.unsupportedRules).toBe(1);
  expect(reading).toMatchObject({ path: ["Reading"], seconds: 140, color: PALETTE.blue.fill, children: [{ path: ["Reading", "Books"], seconds: 140 }] });
  expect(games).toMatchObject({ path: ["Games"], seconds: 60 });
  expect(uncategorized).toMatchObject({ path: ["Uncategorized"], seconds: 40 });
  expect(rankActivity(stats, [reading])).toEqual({
    apps: [{ label: "Reader", seconds: 140 }],
    titles: [{ label: "A novel", app: "Reader", seconds: 120 }, { label: "Another novel", app: "Reader", seconds: 20 }]
  });
});

it("assigns the primary colors by usage rather than by the first event", () => {
  const names = ["Study", "AI", "Programming", "Utilities"];
  const categories = names.map(name => ({
    path: [name], color: "#aaa", rule: { pattern: `^${name}$`, ignoreCase: false, fields: ["app"], priority: 10 }
  }));
  const stats = buildActivityStatistics([
    event(0, 5, "Utilities", null),
    event(1, 20, "Programming", null),
    event(2, 40, "Study", null),
    event(3, 30, "AI", null)
  ], categories, period, true, false);

  expect(stats.categories.map(category => category.path[0])).toEqual(names);
  expect(stats.categories.slice(0, 3).map(category => category.color)).toEqual([
    PALETTE.red.fill, PALETTE.green.fill, PALETTE.blue.fill
  ]);
});

it("matches the most-used child to its parent and preserves named color overrides", () => {
  const categories: ActivityWatchCategory[] = [
    ...rules,
    { path: ["Video, Social & Communication"], color: "#fff", rule: { pattern: "^Video$", ignoreCase: false, fields: ["app"], priority: 10 } },
    { path: ["Anime"], color: "#fff", rule: { pattern: "^Anime$", ignoreCase: false, fields: ["app"], priority: 10 } },
    { path: ["Anime", "Tensura"], color: null, rule: { pattern: "^Slime$", ignoreCase: false, fields: ["app"], priority: 20 } }
  ];
  const stats = buildActivityStatistics([
    event(0, 30, "Spotify", null),
    event(0.5, 5, "MangaFire", null),
    event(1, 25, "Reader", "Novel"),
    event(2, 20, "Fortnite", null),
    event(3, 15, "Video", null),
    event(4, 10, "Anime", null),
    event(5, 40, "Slime", null),
  ], categories, period, true, false);
  const color = (name: string) => stats.categoriesById.get(JSON.stringify([name]))?.color;
  expect(color("Reading")).toEqual(PALETTE.blue.fill);
  expect(color("Video, Social & Communication")).toEqual(PALETTE.red.fill);
  expect(color("Games")).toEqual(PALETTE.orange.fill);
  expect(color("Anime")).toEqual(PALETTE.green.fill);
  const reading = stats.categoriesById.get('["Reading"]')!;
  expect(reading.children[0]).toMatchObject({ path: ["Reading", "Books"], color: reading.color });
  expect(reading.children[1].color).not.toEqual(reading.color);
  expect(stats.categoriesById.get('["Anime","Tensura"]')?.color).toEqual([120, 252, 241]);
});

it("clips overlapping foreground events per device and splits time at hourly boundaries", () => {
  const stats = buildActivityStatistics([
    event(58, 360, "Reader", "Novel"),
    event(59, 180, "Game", "Game"),
    event(59, 180, "Game", null, "phone"),
  ], rules, period, true, false);
  const reading = stats.categoriesById.get(JSON.stringify(["Reading"]))!;
  const games = stats.categoriesById.get(JSON.stringify(["Games"]))!;
  expect(stats.total).toBe(540);
  expect(stats.periods).toHaveLength(24);
  expect(reading.seconds).toBe(180);
  expect(games.seconds).toBe(360);
  expect(stats.periods[0].totals.get(reading.id)).toBe(60);
  expect(stats.periods[0].totals.get(games.id)).toBe(120);
  expect(stats.periods[1].totals.get(reading.id)).toBe(120);
  expect(stats.periods[1].totals.get(games.id)).toBe(240);
  expect(rankActivity(stats).titles).toEqual([]);
});

it("limits subcategory timeline bins and rankings to that branch", () => {
  const additionalRules: ActivityWatchCategory[] = [
    ...rules,
    { path: ["Reading", "Documents"], color: "#f96", rule: { pattern: "Manual", ignoreCase: false, fields: ["title"], priority: 20 } }
  ];
  const stats = buildActivityStatistics([
    event(0, 60, "Reader", "Novel"),
    event(1, 90, "PDF viewer", "Manual"),
    event(3, 120, "Another reader", "Untitled", "phone"),
    event(5, 30, "Game", "Game")
  ], additionalRules, period, true, true);
  const reading = stats.categoriesById.get(JSON.stringify(["Reading"]))!;
  const books = stats.categoriesById.get(JSON.stringify(["Reading", "Books"]))!;
  const uncategorized = stats.categoriesById.get(JSON.stringify(["Uncategorized"]))!;

  expect(stats.periods[0].totals.get(reading.id)).toBe(150);
  expect(stats.periods[0].totals.get(books.id)).toBe(60);
  expect(rankActivity(stats, [books]).titles).toEqual([{ app: "Reader", label: "Novel", seconds: 60 }]);
  expect(rankActivity(stats, [uncategorized]).apps).toEqual([{ label: "Another Reader", seconds: 120 }]);
  expect(rankActivity(stats, [books, uncategorized]).apps.map(row => row.label)).toEqual(["Another Reader", "Reader"]);
});

it("keeps directly assigned activity separate from child totals in the breakdown", () => {
  const categories: ActivityWatchCategory[] = [
    ...rules,
    { path: ["Reading"], color: null, rule: { pattern: "^Library$", ignoreCase: false, fields: ["app"], priority: 10 } }
  ];
  const stats = buildActivityStatistics([
    event(58, 90, "Reader", "Novel"),
    event(59.5, 90, "Library", null)
  ], categories, period, true, false);
  const reading = stats.categoriesById.get('["Reading"]')!;

  expect(reading.seconds).toBe(180);
  expect(reading.children[0].seconds).toBe(90);
  expect(directCategoryTime(reading)).toBe(90);
  expect(directCategoryColor(reading)).not.toEqual(reading.children[0].color);
  expect(stats.periods.slice(0, 2).map(bin => directCategoryTime(reading, bin.totals))).toEqual([30, 60]);
});

it("groups game variants and keeps specific activities ahead of generic web browsing", () => {
  const stats = buildActivityStatistics([
    event(0, 30, "RocketLeague_EAC.exe", "Rocket League"),
    event(1, 30, "cs2.exe", "Counter-Strike 2"),
    event(2, 30, "FortniteClient-Win64-Shipping.exe", "Fortnite"),
    event(3, 30, "OUTSIDE.exe", "WE ARE SO DEAD (64-bit Development PCD3D_SM6)"),
    event(3.5, 30, "Minecraft.exe", "Minecraft"),
    event(4, 30, "brave.exe", "Classroom of the Elite – Year 3, Volume 1 - Brave"),
    event(5, 30, "brave.exe", "Some web page"),
    event(6, 30, "com.android.chrome", null, "phone"),
    event(7, 30, "com.google.android.googlequicksearchbox", null, "phone"),
    event(8, 30, "MangaFire", null, "phone"),
  ], [], period, true, false);
  const category = (path: string[]) => stats.categoriesById.get(JSON.stringify(path))!;
  expect(category(["Games"]).children.map(row => row.path.at(-1))).toEqual(["Rocket League", "Counter-Strike 2", "Fortnite", "WE ARE SO DEAD", "Minecraft"]);
  expect(category(["Games", "Rocket League"]).color).toEqual(PALETTE.red.fill);
  expect(category(["Games", "Counter-Strike 2"]).color).toEqual([249, 197, 76]);
  expect(category(["Games", "Fortnite"]).color).toEqual([52, 197, 155]);
  expect(category(["Games", "WE ARE SO DEAD"]).color).toEqual([165, 108, 72]);
  expect(category(["Games", "Minecraft"]).color).toEqual([121, 205, 58]);
  expect(category(["Reading", "Classroom of the Elite"]).seconds).toBe(30);
  expect(category(["Reading", "Manga sites"]).seconds).toBe(30);
  expect(category(["Web Browsing"]).seconds).toBe(90);
  expect(rankActivity(stats).titles).toEqual([]);
});

it("classifies Anime Anyway volume pages as Classroom of the Elite by URL or recorded title", () => {
  const tabBucket = "aw-watcher-web-brave_pc";
  const bucket = (id: string, type: string) =>
    ({ id, type, hostname: "pc", device: "computer" as const, lastUpdated: null, eventCount: 0, error: null });
  const onSite = "animeanyway.com";
  const context = {
    buckets: [bucket("computer", "currentwindow"), bucket(tabBucket, "web.tab.current")],
    tabs: [
      { timestamp: new Date(+start + 120_000).toISOString(), duration: 60, bucketId: tabBucket,
        title: null, browser: null, site: onSite, page: `${onSite}/y3v5/ch2` },
      { timestamp: new Date(+start + 180_000).toISOString(), duration: 60, bucketId: tabBucket,
        title: "SignIn | Anime Anyway", browser: null, site: onSite, page: `${onSite}/signin` },
      { timestamp: new Date(+start + 240_000).toISOString(), duration: 60, bucketId: tabBucket,
        title: "Classroom of the Elite Year 3 Volume 5 - Google Search", browser: null, site: "google.com", page: "google.com/search" }
    ]
  };
  const stats = buildActivityStatistics([
    event(0, 60, "brave.exe", "Chapter 1 | Year 3 Volume 5 | Anime Anyway - Brave"),
    event(1, 60, "brave.exe", "Prologue | Year 3 Volume 5 | Anime Anyway - Brave"),
    event(2, 60, "brave.exe", "Continue reading - Brave"),
    event(3, 60, "brave.exe", "SignIn | Anime Anyway - Brave"),
    event(4, 60, "brave.exe", "Classroom of the Elite Year 3 Volume 5 - Google Search - Brave"),
    event(5, 60, "brave.exe", "Anime Anyway Translations - Brave")
  ], [], period, true, true, context);

  const classroom = stats.categoriesById.get('["Reading","Classroom of the Elite"]')!;
  const browsing = stats.categoriesById.get('["Web Browsing"]')!;
  expect(classroom.seconds).toBe(180);
  expect(browsing.seconds).toBe(180);
  expect(rankActivity(stats, [classroom]).titles.map(row => row.label)).toEqual([
    "Chapter 1 | Year 3 Volume 5 | Anime Anyway", "Prologue | Year 3 Volume 5 | Anime Anyway", "Continue reading"
  ]);
});

it("counts untitled phone Anime Anyway visits and prefers captured chapter titles where available", () => {
  const tabBucket = "aw-watcher-android-web-synced-from-samsung";
  const titleBucket = "aw-watcher-anime-anyway-android_abc-synced-from-samsung";
  const bucket = (id: string, type: string, hostname = "samsung") =>
    ({ id, type, hostname, device: "phone" as const, lastUpdated: null, eventCount: 0, error: null });
  const chrome = "com.android.chrome";
  const site = "animeanyway.com";
  const chapter = "Chapter 1 | Year 3 Volume 5 | Anime Anyway";
  const tab = (second: number, duration: number, bucketId: string, page: string, title: string | null = null) =>
    ({ timestamp: new Date(+start + second * 1000).toISOString(), duration, bucketId, browser: chrome,
      site: page.split("/")[0], page, title });
  const context = {
    buckets: [bucket("phone", "currentwindow"), bucket(tabBucket, "web.tab.current"),
      bucket(titleBucket, "web.tab.current"), bucket("other-phone", "web.tab.current", "other")],
    tabs: [
      tab(0, 20, tabBucket, site),
      tab(25, 10, tabBucket, site),
      tab(24, 8, titleBucket, site, chapter),
      tab(35, 10, tabBucket, `${site}/signin`),
      tab(45, 10, tabBucket, "example.com"),
      tab(45, 10, "other-phone", site, chapter)
    ]
  };
  const stats = buildActivityStatistics([event(0, 60, chrome, null, "phone")], [], period, true, true, context);
  const classroom = stats.categoriesById.get('["Reading","Classroom of the Elite"]')!;
  expect(stats.total).toBe(60);
  expect(classroom.seconds).toBe(31);
  expect(stats.categoriesById.get('["Web Browsing"]')?.seconds).toBe(29);
  expect(rankActivity(stats, [classroom]).titles).toEqual([
    { label: "Anime Anyway · page title unavailable", app: "Google Chrome", seconds: 23 },
    { label: chapter, app: "Google Chrome", seconds: 8 }
  ]);
});

it("attributes Spotify on both devices and matching browser time to one app with a full title breakdown", () => {
  const bucket = (id: string, type: string) =>
    ({ id, type, hostname: "pc", device: "computer" as const, lastUpdated: null, eventCount: 0, error: null });
  const tabs = [{ timestamp: new Date(+start + 120000).toISOString(), duration: 40, bucketId: "aw-watcher-web-brave_pc",
    title: "A song from the web player", browser: null, site: "open.spotify.com", page: "open.spotify.com/track/test" }];
  const events = [
    event(0, 32, "Spotify.exe", "Spotify Premium"),
    event(1, 20, "com.spotify.music", null, "phone"),
    event(2, 30, "brave.exe", "A song from the web player - Brave"),
    event(2.5, 30, "brave.exe", "Other page - Brave")
  ];
  const context = { buckets: [bucket("computer", "currentwindow"), bucket("aw-watcher-web-brave_pc", "web.tab.current")], tabs };
  const stats = buildActivityStatistics(events, [], period, true, true, context);
  const music = stats.categoriesById.get('["Music"]')!;
  expect(stats.total).toBe(112);
  expect(music.seconds).toBe(82);
  expect(rankActivity(stats, [music])).toEqual({
    apps: [{ label: "Spotify", seconds: 82 }],
    titles: [
      { label: "Spotify Premium · no track title", app: "Spotify", seconds: 32 },
      { label: "A song from the web player", app: "Spotify", seconds: 30 },
      { label: "No window title recorded", app: "Spotify", seconds: 20, unrecordedTitle: true }
    ]
  });
  const hidden = buildActivityStatistics(events, [], period, true, false, context);
  expect(hidden.categoriesById.get(music.id)?.seconds).toBe(82);
  expect(rankActivity(hidden).titles).toEqual([]);
});

it("combines technical title variants without removing meaningful title details", () => {
  const stats = buildActivityStatistics([
    event(0, 60, "RocketLeague.exe", "Rocket League (64-bit, DX11, Cooked)"),
    event(1, 60, "RocketLeague.exe", "Rocket League, 64-bit DX11 cooked"),
    event(2, 60, "brave.exe", "Episode 2 - A new start (Director’s cut) - Brave"),
    event(3, 60, "brave.exe", "Shader Programming (OpenGL)"),
  ], [], period, true, true);
  expect(rankActivity(stats).titles).toEqual([
    { label: "Rocket League", app: "Rocket League", seconds: 120 },
    { label: "Episode 2 - A new start (Director’s cut)", app: "Brave", seconds: 60 },
    { label: "Shader Programming (OpenGL)", app: "Brave", seconds: 60 },
  ]);
});
