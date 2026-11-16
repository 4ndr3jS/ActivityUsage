import { expect, it } from "vitest";
import type { ActivityWatchRecord, ActivityWatchCategory } from "../shared/desktop-api";
import { buildActivityStatistics, rankActivity } from "./activity-statistics";

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
  expect(reading).toMatchObject({ path: ["Reading"], seconds: 140, color: [51, 102, 170], children: [{ path: ["Reading", "Books"], seconds: 140 }] });
  expect(games).toMatchObject({ path: ["Games"], seconds: 60 });
  expect(uncategorized).toMatchObject({ path: ["Uncategorized"], seconds: 40 });
  expect(rankActivity(stats, [reading])).toEqual({
    apps: [{ label: "Reader", seconds: 140 }],
    titles: [{ label: "A novel", app: "Reader", seconds: 120 }, { label: "Another novel", app: "Reader", seconds: 20 }]
  });
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
    event(3, 120, "Spotify", "Music", "phone"),
    event(5, 30, "Game", "Game")
  ], additionalRules, period, true, true);
  const reading = stats.categoriesById.get(JSON.stringify(["Reading"]))!;
  const books = stats.categoriesById.get(JSON.stringify(["Reading", "Books"]))!;
  const uncategorized = stats.categoriesById.get(JSON.stringify(["Uncategorized"]))!;

  expect(stats.periods[0].totals.get(reading.id)).toBe(150);
  expect(stats.periods[0].totals.get(books.id)).toBe(60);
  expect(rankActivity(stats, [books]).titles).toEqual([{ app: "Reader", label: "Novel", seconds: 60 }]);
  expect(rankActivity(stats, [uncategorized]).apps).toEqual([{ label: "Spotify", seconds: 120 }]);
  expect(rankActivity(stats, [books, uncategorized]).apps.map(row => row.label)).toEqual(["Spotify", "Reader"]);
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
