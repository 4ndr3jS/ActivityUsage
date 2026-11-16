import type { ActivityWatchCategory, ActivityWatchRecord } from "../shared/desktop-api";
import { appLabel } from "./app-label";
import { PALETTE, type Rgb } from "./components/dither-kit/palette";

const UNCATEGORIZED = ["Uncategorized"];
const COLORS = [PALETTE.blue, PALETTE.pink, PALETTE.green, PALETTE.purple, PALETTE.orange, PALETTE.red];
const HOUR = 3_600_000;
const dayLabel = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const hourLabel = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

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
}

interface Rank {
  label: string;
  seconds: number;
  app?: string;
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
  hasRules: boolean;
  unsupportedRules: number;
}

export function buildActivityStatistics(
  events: ActivityWatchRecord[],
  categories: ActivityWatchCategory[],
  period: { start: Date; end: Date },
  hourly: boolean,
  showTitles: boolean
): ActivityStatistics {
  const rules = compileRules(categories);
  const periods = buildTimelinePeriods(period, hourly);
  const colors = new Map(categories.map(category => [JSON.stringify(category.path), parseColor(category.color)]));
  const categoriesById = new Map<string, CategoryTotal>();
  const roots: CategoryTotal[] = [];
  const ranks = new Map<string, CategoryRanks>();
  const classified = new Map<string, string[]>();
  const appNames = new Map<string | null, string>();
  let total = 0;

  function getCategory(path: string[]): CategoryTotal {
    const id = JSON.stringify(path);
    const existing = categoriesById.get(id);
    if (existing) return existing;
    const parent = path.length > 1 ? getCategory(path.slice(0, -1)) : undefined;
    const color = colors.get(id) ?? parent?.color
      ?? (path[0] === UNCATEGORIZED[0] ? PALETTE.grey.fill : COLORS[roots.length % COLORS.length].fill);
    const node: CategoryTotal = { id, path, color, seconds: 0, children: [] };
    categoriesById.set(id, node);
    (parent?.children ?? roots).push(node);
    return node;
  }

  for (const device of ["computer", "phone"] as const) {
    let periodIndex = 0;
    const deviceEvents = events.filter(event => event.device === device);
    for (const { event, start, end } of foregroundSegments(deviceEvents, +period.start, +period.end)) {
      const seconds = (end - start) / 1000;
      total += seconds;
      const matchKey = JSON.stringify([event.app, event.title]);
      let path = classified.get(matchKey);
      if (!path) {
        path = rules.compiled.find(({ rule, regex }) => rule.fields.some(field => {
          const value = field === "app" ? event.app : field === "title" ? event.title : null;
          return value !== null && regex.test(value);
        }))?.path ?? UNCATEGORIZED;
        classified.set(matchKey, path);
      }

      const leaf = getCategory(path);
      const ancestors = path.map((_, index) => getCategory(path.slice(0, index + 1)));
      for (const category of ancestors) category.seconds += seconds;

      if (periods.length) {
        while (periodIndex < periods.length && periods[periodIndex].end <= start) periodIndex++;
        for (let index = periodIndex; index < periods.length && periods[index].start < end; index++) {
          const bin = periods[index];
          const overlap = Math.min(end, bin.end) - Math.max(start, bin.start);
          for (const category of ancestors) {
            bin.totals.set(category.id, (bin.totals.get(category.id) ?? 0) + overlap / 1000);
          }
        }
      }

      let app = appNames.get(event.app);
      if (!app) {
        app = appLabel(event.app);
        appNames.set(event.app, app);
      }
      let group = ranks.get(leaf.id);
      if (!group) {
        group = { path, apps: new Map(), titles: new Map() };
        ranks.set(leaf.id, group);
      }
      addRank(group.apps, app, { label: app, seconds });
      if (showTitles && event.title) {
        const label = windowTitleLabel(event.title, app);
        addRank(group.titles, JSON.stringify([app, label]), { label, app, seconds });
      }
    }
  }

  for (const category of categoriesById.values()) category.children.sort(byTime);
  return {
    total,
    categories: roots.sort(byTime),
    categoriesById,
    periods,
    ranks: [...ranks.values()],
    hasRules: rules.compiled.length > 0,
    unsupportedRules: rules.unsupported
  };
}

function windowTitleLabel(title: string, app: string): string {
  const suffix = /^(.*)\s+[-–—|]\s+(.+)$/u.exec(title);
  const label = suffix && suffix[2].trim().toLowerCase() === app.toLowerCase()
    ? suffix[1].trim()
    : title;
  const build = /^(.+?)(?:\s+\(([^()]*)\)|,\s+([^()]+))$/u.exec(label);
  const details = build?.[2] ?? build?.[3];
  if (!build || !details) return label;
  const comparable = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (comparable(build[1]) !== comparable(app)) return label;
  const buildFlag = /^(?:32-bit|64-bit|x86|x64|win32|win64|dx\d+|vulkan|opengl|cooked|shipping|release|debug)$/i;
  return details.trim().split(/[\s,]+/).every(flag => buildFlag.test(flag)) ? build[1].trim() : label;
}

export function rankActivity(statistics: ActivityStatistics, selected: readonly CategoryTotal[] = []): {
  apps: Rank[];
  titles: Rank[];
} {
  const apps = new Map<string, Rank>();
  const titles = new Map<string, Rank>();
  for (const group of statistics.ranks) {
    if (selected.length && !selected.some(category => category.path.every((part, index) => part === group.path[index]))) continue;
    for (const [key, value] of group.apps) addRank(apps, key, value);
    for (const [key, value] of group.titles) addRank(titles, key, value);
  }
  return { apps: [...apps.values()].sort(byTime), titles: [...titles.values()].sort(byTime) };
}

function compileRules(categories: ActivityWatchCategory[]) {
  const compiled = [];
  let unsupported = 0;
  for (const { path, rule } of categories) {
    if (!rule) continue;
    try {
      compiled.push({ path, rule, regex: new RegExp(rule.pattern, rule.ignoreCase ? "im" : "m") });
    } catch {
      unsupported++;
    }
  }
  compiled.sort((left, right) => right.rule.priority - left.rule.priority);
  return { compiled, unsupported };
}

function parseColor(value: string | null): Rgb | undefined {
  if (!value || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)) return;
  const hex = value.length === 4 ? value.slice(1).replace(/./g, digit => digit.repeat(2)) : value.slice(1);
  return [0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16)) as Rgb;
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
  const boundaries = [+period.start];
  if (hourly) {
    for (let time = +period.start + HOUR; time < +period.end; time += HOUR) boundaries.push(time);
  } else {
    const date = new Date(period.start);
    date.setDate(date.getDate() + 1);
    date.setHours(0, 0, 0, 0);
    while (date < period.end) {
      boundaries.push(+date);
      date.setDate(date.getDate() + 1);
      date.setHours(0, 0, 0, 0);
    }
  }
  const stride = hourly ? 1 : Math.max(1, Math.ceil(boundaries.length / 31));
  const periods = [];
  for (let index = 0; index < boundaries.length; index += stride) {
    const start = boundaries[index];
    const end = boundaries[index + stride] ?? +period.end;
    if (start >= end) break;
    const label = hourly ? hourLabel.format(start) : dayLabel.format(start);
    const last = Math.min(boundaries.length - 1, index + stride - 1);
    periods.push({
      start, end,
      label: last === index ? label : `${label} – ${dayLabel.format(boundaries[last])}`,
      totals: new Map<string, number>()
    });
  }
  return periods;
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
