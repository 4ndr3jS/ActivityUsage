import type { ActivityWatchCategory, ActivityWatchRecord, ActivityWatchSnapshot, ActivityWatchTab } from "../shared/desktop-api";
import { classifyActivity, compileActivityCategories } from "./activity-categories";
import { appLabel } from "./app-label";
import { browserOf, createBrowserTabMatcher, splitActivitySpan } from "./browser-activity";
import { indexPhonePdfs } from "./pdf-reading";
import { PALETTE, type Rgb } from "./components/dither-kit/palette";

const CATEGORY_COLORS = new Map<string, Rgb>([
  ["Reading", PALETTE.blue.fill],
  ["Video, Social & Communication", PALETTE.red.fill],
  ["Anime", PALETTE.green.fill],
  ["Games", PALETTE.orange.fill],
  ["Uncategorized", [174, 179, 189]]
]);
const SUBCATEGORY_COLORS = new Map<string, Rgb>([
  [JSON.stringify(["Games", "Rocket League"]), PALETTE.red.fill],
  [JSON.stringify(["Games", "Counter-Strike 2"]), [249, 197, 76]],
  [JSON.stringify(["Games", "Fortnite"]), [52, 197, 155]],
  [JSON.stringify(["Games", "WE ARE SO DEAD"]), [165, 108, 72]],
  [JSON.stringify(["Games", "Minecraft"]), [121, 205, 58]],
  [JSON.stringify(["Anime", "Tensura"]), [120, 252, 241]]
]);
const PREFERRED_COLORS: Rgb[] = [
  PALETTE.red.fill, PALETTE.green.fill, PALETTE.blue.fill, PALETTE.orange.fill,
  [146, 101, 240], [248, 229, 46], [0, 220, 219], [230, 102, 176], [176, 136, 102], [164, 233, 95]
];
const CHANNELS = [48, 80, 112, 144, 176, 208, 240];
const ADDITIONAL_COLORS: Rgb[] = CHANNELS.flatMap(red => CHANNELS.flatMap(green =>
  CHANNELS.map((blue): Rgb => [red, green, blue])
)).filter(color => Math.max(...color) >= 144 && Math.max(...color) - Math.min(...color) >= 80);
const dayLabel = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const hourLabel = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });

export interface CategoryTotal {
  id: string;
  path: string[];
  color: Rgb;
  seconds: number;
  children: CategoryTotal[];
}

interface TimelinePeriod {
  start: number;
  end: number;
  label: string;
  totals: Map<string, number>;
  applicationTotals: Map<string, Map<string, number>>;
}

interface Rank {
  label: string;
  seconds: number;
  app?: string;
  unrecordedTitle?: true;
}

interface CategoryRanks {
  path: string[];
  apps: Map<string, Rank>;
  titles: Map<string, Rank>;
}

export interface ActivityStatistics {
  total: number;
  categories: CategoryTotal[];
  categoriesById: Map<string, CategoryTotal>;
  periods: TimelinePeriod[];
  ranks: CategoryRanks[];
  unsupportedRules: number;
}

export function buildActivityStatistics(
  events: ActivityWatchRecord[],
  categories: ActivityWatchCategory[],
  period: { start: Date; end: Date },
  hourly: boolean,
  showTitles: boolean,
  context?: Pick<ActivityWatchSnapshot, "buckets" | "tabs" | "pdfs">
): ActivityStatistics {
  const { rules, unsupported } = compileActivityCategories(categories);
  const periods = buildTimelinePeriods(period, hourly);
  const categoriesById = new Map<string, CategoryTotal>();
  const roots: CategoryTotal[] = [];
  const ranks = new Map<string, CategoryRanks>();
  const classified = new Map<string, ReturnType<typeof classifyActivity>>();
  const matchTabs = context?.tabs.length ? createBrowserTabMatcher(events, context.tabs, context.buckets) : undefined;
  const matchPdfs = indexPhonePdfs(context?.pdfs ?? []);
  let total = 0;

  function getCategory(path: string[]): CategoryTotal {
    const id = JSON.stringify(path);
    const existing = categoriesById.get(id);
    if (existing) return existing;
    const parent = path.length > 1 ? getCategory(path.slice(0, -1)) : undefined;
    const node: CategoryTotal = { id, path, color: PALETTE.grey.fill, seconds: 0, children: [] };
    categoriesById.set(id, node);
    (parent?.children ?? roots).push(node);
    return node;
  }

  for (const device of ["computer", "phone"] as const) {
    let periodIndex = 0;
    const deviceEvents = events.filter(event => event.device === device);
    for (const { event, start, end, app: rawApp, title, browser, tab, filename } of
      activitySegments(deviceEvents, period, matchTabs, matchPdfs)) {
      const seconds = (end - start) / 1000;
      total += seconds;
      const matchKey = JSON.stringify([event.device, event.app, event.title, tab?.site, tab?.page, tab?.title, tab?.pdfFilename, filename]);
      let classification = classified.get(matchKey);
      if (!classification) {
        classification = classifyActivity({ event, app: rawApp, title, browser, tab, filename }, rules);
        classified.set(matchKey, classification);
      }
      const { app, path } = classification;

      const ancestors = path.map((_, index) => getCategory(path.slice(0, index + 1)));
      const leaf = ancestors.at(-1)!;
      for (const category of ancestors) category.seconds += seconds;

      if (periods.length) {
        while (periodIndex < periods.length && periods[periodIndex].end <= start) periodIndex++;
        for (let index = periodIndex; index < periods.length && periods[index].start < end; index++) {
          const bin = periods[index];
          const overlap = Math.min(end, bin.end) - Math.max(start, bin.start);
          if (overlap <= 0) continue;
          const secondsInBin = overlap / 1000;
          for (const category of ancestors) {
            bin.totals.set(category.id, (bin.totals.get(category.id) ?? 0) + secondsInBin);
          }
          let byApp = bin.applicationTotals.get(leaf.id);
          if (!byApp) {
            byApp = new Map();
            bin.applicationTotals.set(leaf.id, byApp);
          }
          byApp.set(app, (byApp.get(app) ?? 0) + secondsInBin);
        }
      }

      let group = ranks.get(leaf.id);
      if (!group) {
        group = { path, apps: new Map(), titles: new Map() };
        ranks.set(leaf.id, group);
      }
      addRank(group.apps, app, { label: app, seconds });
      if (showTitles) {
        const windowTitle = title && path[0] === "Games" ? windowTitleLabel(title, app) : title;
        const recorded = filename ?? windowTitle ?? tab?.title ?? tab?.pdfFilename;
        const siteLabel = path[1] === "Classroom of the Elite" && tab?.site === "animeanyway.com"
          ? "Anime Anyway · page title unavailable" : undefined;
        const label = recorded && app === "Spotify" && /^spotify(?: premium| free|\s*[-–—]\s*web player)?$/i.test(recorded)
          ? `${recorded} · no track title` : recorded ?? siteLabel ?? "No window title recorded";
        const unrecordedTitle = !recorded && !siteLabel;
        addRank(group.titles, JSON.stringify([app, label, unrecordedTitle]), {
          label, app, seconds, ...(unrecordedTitle ? { unrecordedTitle: true } : {})
        });
      }
    }
  }

  roots.sort(byTime);
  for (const category of categoriesById.values()) category.children.sort(byTime);
  assignCategoryColors(roots, categoriesById);
  return {
    total,
    categories: roots,
    categoriesById,
    periods,
    ranks: [...ranks.values()],
    unsupportedRules: unsupported
  };
}

function windowTitleLabel(title: string, app: string): string {
  const comparable = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const suffix = /^(.*)\s+[-–—|]\s+(.+)$/u.exec(title);
  const label = suffix && comparable(suffix[2]) === comparable(app)
    ? suffix[1].trim()
    : title;
  const build = /^(.+?)(?:\s+\(([^()]*)\)|,\s+([^()]+))$/u.exec(label);
  const details = build?.[2] ?? build?.[3];
  if (!build || !details) return label;
  if (comparable(build[1]) !== comparable(app)) return label;
  const buildFlag = /^(?:32-bit|64-bit|x86|x64|win32|win64|dx\d+|vulkan|opengl|cooked|shipping|release|debug|development|pcd3d_sm\d+)$/i;
  return details.trim().split(/[\s,]+/).every(flag => buildFlag.test(flag)) ? build[1].trim() : label;
}

export function rankActivity(statistics: ActivityStatistics, selected: readonly CategoryTotal[] = [], selectedApp?: string | null): {
  apps: Rank[];
  titles: Rank[];
} {
  const apps = new Map<string, Rank>();
  const titles = new Map<string, Rank>();
  const groups = selected.length ? statistics.ranks.filter(group =>
    selected.some(category => category.path.every((part, index) => part === group.path[index]))) : statistics.ranks;
  for (const group of groups) {
    for (const [key, value] of group.apps) addRank(apps, key, value);
  }
  const app = selectedApp && apps.has(selectedApp) ? selectedApp : null;
  for (const group of groups) {
    for (const [key, value] of group.titles) {
      if (!app || value.app === app) addRank(titles, key, value);
    }
  }
  return { apps: [...apps.values()].sort(byTime), titles: [...titles.values()].sort(byTime) };
}

export function directCategoryTime(category: CategoryTotal, totals?: ReadonlyMap<string, number>): number {
  const time = (node: CategoryTotal) => totals ? totals.get(node.id) ?? 0 : node.seconds;
  const remainder = time(category) - category.children.reduce((sum, child) => sum + time(child), 0);
  // Parent and child totals accumulate independently, so subtraction can leave rounding noise.
  return remainder > 1e-6 ? remainder : 0;
}

export function directCategoryColor(category: CategoryTotal): Rgb {
  const colors = category.children.map(child => child.color);
  return colors.includes(category.color) ? distinctColor(colors, colorFamily(category.color)) : category.color;
}

export function applicationRankColors(categoryColor: Rgb, count: number): Rgb[] {
  const categoryKey = categoryColor.join(",");
  const colors = [categoryColor, ...PREFERRED_COLORS.filter(color => color.join(",") !== categoryKey)].slice(0, count);
  const taken = new Set(colors.map(color => color.join(",")));
  while (colors.length < count) {
    const next = distinctColor(colors, ADDITIONAL_COLORS, taken);
    colors.push(next);
    taken.add(next.join(","));
  }
  return colors;
}

function assignCategoryColors(roots: CategoryTotal[], categories: ReadonlyMap<string, CategoryTotal>): void {
  const used = [...SUBCATEGORY_COLORS].flatMap(([id, color]) => categories.has(id) ? [color] : []);
  for (const root of roots) {
    const color = CATEGORY_COLORS.get(root.path[0]);
    if (!color) continue;
    root.color = color;
    used.push(color);
  }

  const preferred = PREFERRED_COLORS.filter(color => !used.includes(color)).values();
  const otherRoots = roots.filter(root => !CATEGORY_COLORS.has(root.path[0]))
    .sort((left, right) => byTime(left, right) || left.id.localeCompare(right.id));
  for (const category of otherRoots) {
    category.color = preferred.next().value ?? distinctColor(used, ADDITIONAL_COLORS);
    used.push(category.color);
  }

  const taken = new Set(used.map(color => color.join(",")));

  function colorChildren(parent: CategoryTotal): void {
    if (!parent.children.length) return;
    const candidates = colorFamily(parent.color);
    const nearby = [parent.color, ...parent.children.flatMap(child => {
      const color = SUBCATEGORY_COLORS.get(child.id);
      return color ? [color] : [];
    })];
    for (const [index, child] of parent.children.entries()) {
      const color = SUBCATEGORY_COLORS.get(child.id) ?? (index === 0 ? parent.color : undefined);
      child.color = color ?? distinctColor(nearby, candidates, taken);
      taken.add(child.color.join(","));
      if (!color) nearby.push(child.color);
    }
    for (const child of parent.children) colorChildren(child);
  }
  for (const root of roots) colorChildren(root);
}

function colorFamily([red, green, blue]: Rgb): Rgb[] {
  const max = Math.max(red, green, blue);
  const spread = max - Math.min(red, green, blue);
  const hue = spread === 0 ? 0 : 60 * (max === red ? (green - blue) / spread
    : max === green ? 2 + (blue - red) / spread : 4 + (red - green) / spread);
  const hues = [-30, -20, -10, 0, 10, 20, 30].map(offset => hue + offset);
  const saturations = spread < 40 ? [0, 0.12, 0.25] : [0.64, 0.8, 0.96];
  return hues.flatMap(hue => saturations.flatMap(saturation =>
    [0.43, 0.49, 0.55, 0.61, 0.67, 0.73].map(lightness => hslColor(hue, saturation, lightness))
  ));
}

function hslColor(hue: number, saturation: number, lightness: number): Rgb {
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  function channel(offset: number): number {
    const phase = (offset + hue / 30 + 12) % 12;
    const wave = Math.max(-1, Math.min(phase - 3, 9 - phase, 1));
    return Math.round(255 * (lightness - amplitude * wave));
  }
  return [channel(0), channel(8), channel(4)];
}

function distinctColor(used: Rgb[], candidates: Rgb[], taken = new Set(used.map(color => color.join(",")))): Rgb {
  let best: Rgb | undefined;
  let bestDistance = 0;
  for (const color of candidates) {
    if (taken.has(color.join(","))) continue;
    let distance = Infinity;
    for (const other of used) {
      const gap = (color[0] - other[0]) ** 2 + (color[1] - other[1]) ** 2 + (color[2] - other[2]) ** 2;
      distance = Math.min(distance, gap);
      if (distance <= bestDistance) break;
    }
    if (distance <= bestDistance) continue;
    best = color;
    bestDistance = distance;
  }
  if (best) return best;

  // Keep swatches unique even if a custom rule set exhausts the chart palette.
  for (let index = 0; index < 0x1000000; index++) {
    const color: Rgb = [index & 255, (index >> 8) & 255, 240 ^ (index >> 16)];
    if (!taken.has(color.join(","))) return color;
  }
  return PALETTE.grey.fill;
}

function addRank(ranks: Map<string, Rank>, key: string, row: Rank): void {
  const existing = ranks.get(key);
  if (existing) existing.seconds += row.seconds;
  else ranks.set(key, { ...row });
}

function byTime(left: { seconds: number }, right: { seconds: number }): number {
  return right.seconds - left.seconds;
}

function buildTimelinePeriods(period: { start: Date; end: Date }, hourly: boolean): TimelinePeriod[] {
  if (hourly) {
    // Keep one slot per clock hour. Across DST, an absent hour is empty and a repeated hour is combined.
    const boundaries = Array.from({ length: 25 }, (_, hour) => new Date(period.start).setHours(hour, 0, 0, 0));
    return boundaries.slice(0, 24).map((start, hour) => ({
      start: Math.max(start, +period.start),
      end: Math.min(boundaries[hour + 1], +period.end),
      label: hourLabel.format(Date.UTC(2000, 0, 1, hour)),
      totals: new Map<string, number>(),
      applicationTotals: new Map<string, Map<string, number>>()
    }));
  }
  const boundaries = [+period.start];
  const date = new Date(period.start);
  date.setDate(date.getDate() + 1);
  date.setHours(0, 0, 0, 0);
  while (date < period.end) {
    boundaries.push(+date);
    date.setDate(date.getDate() + 1);
    date.setHours(0, 0, 0, 0);
  }
  const stride = Math.max(1, Math.ceil(boundaries.length / 31));
  const periods = [];
  for (let index = 0; index < boundaries.length; index += stride) {
    const start = boundaries[index];
    const end = boundaries[index + stride] ?? +period.end;
    if (start >= end) break;
    const label = dayLabel.format(start);
    const last = Math.min(boundaries.length - 1, index + stride - 1);
    periods.push({
      start, end,
      label: last === index ? label : `${label} – ${dayLabel.format(boundaries[last])}`,
      totals: new Map<string, number>(),
      applicationTotals: new Map<string, Map<string, number>>()
    });
  }
  return periods;
}

function* activitySegments(
  events: ActivityWatchRecord[],
  period: { start: Date; end: Date },
  matchTabs: ReturnType<typeof createBrowserTabMatcher> | undefined,
  matchPdfs: ReturnType<typeof indexPhonePdfs>
) {
  const applications = new Map<string | null, { app: string; browser: string | undefined }>();
  for (const segment of foregroundSegments(events, +period.start, +period.end)) {
    const { event, start, end } = segment;
    let application = applications.get(event.app);
    if (!application) {
      application = { app: appLabel(event.app), browser: browserOf(event.app ?? "") };
      applications.set(event.app, application);
    }
    const { app, browser } = application;
    const title = event.title && windowTitleLabel(event.title, app);
    const info = { ...segment, app, title, browser, tab: undefined, filename: undefined };
    const phoneReader = event.device === "phone" && (app === "My Files" || app === "Samsung Notes");
    const pdfs = phoneReader ? matchPdfs(start, end) : [];
    if (pdfs.length) {
      for (const part of splitActivitySpan(start, end, pdfs)) {
        yield { ...info, start: part.start, end: part.end, filename: part.match?.filename };
      }
      continue;
    }
    const tabs = browser ? matchTabs?.(event, start, end) : undefined;
    const compatibleTabs = tabs?.filter(tab => !title || !tab.title || sameTitle(title, tab));
    if (!compatibleTabs?.length) {
      yield info;
      continue;
    }
    for (const part of splitActivitySpan(start, end, compatibleTabs)) {
      yield { ...info, start: part.start, end: part.end, tab: part.match };
    }
  }
}

function sameTitle(title: string, tab: ActivityWatchTab): boolean {
  return title.normalize("NFC").trim().toLowerCase() === tab.title?.normalize("NFC").trim().toLowerCase();
}

/** Attribute overlaps on one device to its latest foreground event. */
function* foregroundSegments(events: ActivityWatchRecord[], periodStart: number, periodEnd: number) {
  const edges = events.flatMap(event => {
    const timestamp = Date.parse(event.timestamp);
    const start = Math.max(timestamp, periodStart);
    const end = Math.min(timestamp + event.duration * 1000, periodEnd);
    if (!(end > start)) return [];
    const span = { event, timestamp };
    return [{ time: start, starts: true, span }, { time: end, starts: false, span }];
  });
  edges.sort((left, right) => left.time - right.time || left.span.timestamp - right.span.timestamp);
  const active = new Set<(typeof edges)[number]["span"]>();
  const stack: (typeof edges)[number]["span"][] = [];
  let cursor = periodStart;
  for (const { time, starts, span } of edges) {
    const foreground = stack.at(-1);
    if (foreground && cursor < time) yield { event: foreground.event, start: cursor, end: time };
    if (starts) {
      active.add(span);
      stack.push(span);
    } else {
      active.delete(span);
      while (stack.length && !active.has(stack.at(-1)!)) stack.pop();
    }
    cursor = time;
  }
}
