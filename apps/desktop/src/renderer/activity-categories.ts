import type { ActivityWatchCategory, ActivityWatchRecord, ActivityWatchTab } from "../shared/desktop-api";
import { isPdfReader } from "./pdf-reading";

const CLASSROOM = ["Reading", "Classroom of the Elite"];
const MANGA = ["Reading", "Manga sites"];
const DIGITAL_BOOKS = ["Reading", "Digital books & PDFs"];
const MY_FILES = ["Reading", "My Files"];
const MUSIC = ["Music"];
const WEB = ["Web Browsing"];
const UNCATEGORIZED = ["Uncategorized"];

const CLASSROOM_BOOK = /^(?:classroom[\s_+]+of[\s_+]+the[\s_+]+elite|cote)(?:[\s_.,:–—-]*(?:(?:year|y)[\s_]*\d+[\s_.,:–—-]*)?(?:volume|vol\.?|v|chapter|ch\.?)[\s_]*\d+(?:\.\d+)?(?:-dark)?)?(?:\.(?:pdf|epub))?$/i;
const SPOTIFY_SITE = /(?:^|\.)spotify\.com$/i;
const SPOTIFY_TITLE = /^(?:spotify(?:\s+premium|\s+free)?|open\.spotify\.com)$|^spotify\s*[-–—]\s*web player\b|\|\s*spotify$/i;
const MANGA_SITE = /(?:^|\.)(?:mangafire|comix)\.to$/i;
const GAME_NAMES = new Map([
  ["rocket league", "Rocket League"],
  ["counter strike 2", "Counter-Strike 2"],
  ["counter-strike 2", "Counter-Strike 2"],
  ["fortnite", "Fortnite"],
  ["we are so dead", "WE ARE SO DEAD"],
  ["minecraft", "Minecraft"]
]);

export function compileActivityCategories(categories: ActivityWatchCategory[]) {
  const rules = [];
  let unsupported = 0;
  for (const { path, rule } of categories) {
    if (!rule) continue;
    try {
      const inlineCaseFlag = rule.pattern.startsWith("(?i)");
      const pattern = inlineCaseFlag ? rule.pattern.slice(4) : rule.pattern;
      rules.push({ path, rule, regex: new RegExp(pattern, rule.ignoreCase || inlineCaseFlag ? "im" : "m") });
    } catch {
      unsupported++;
    }
  }
  rules.sort((left, right) => right.rule.priority - left.rule.priority);
  return { rules, unsupported };
}

function statisticsCategoryPath(path: string[]): string[] {
  const game = GAME_NAMES.get(path[0].toLowerCase());
  if (game) return ["Games", game, ...path.slice(1)];
  return path[0] === "Browsing" ? [...WEB, ...path.slice(1)] : path;
}

export function classifyActivity(
  { event, app, title, browser, tab, filename }: {
    event: ActivityWatchRecord;
    app: string;
    title: string | null;
    browser: string | undefined;
    tab: ActivityWatchTab | undefined;
    filename: string | undefined;
  },
  rules: ReturnType<typeof compileActivityCategories>["rules"]
): { path: string[]; app: string } {
  const site = tab?.site ?? "";
  const titles = [title, tab?.title, tab?.pdfFilename, filename].filter((value): value is string => Boolean(value));
  if (app === "Spotify" || (browser && (site ? SPOTIFY_SITE.test(site) : titles.some(value => SPOTIFY_TITLE.test(value))))) {
    return { path: MUSIC, app: "Spotify" };
  }
  const appName = app.toLowerCase();
  const game = GAME_NAMES.get(appName) ??
    (appName === "outside" && /^we\s+are\s+so\s+dead(?:\s+\(|$)/i.test(title ?? "") ? "WE ARE SO DEAD" : undefined);
  if (game) return { path: ["Games", game], app: game };

  const phoneFiles = event.device === "phone" && app === "My Files";
  const reader = isPdfReader(event.app);
  if (/(?:^|\.)classroomoftheelite\.net$/i.test(site) ||
    ((browser || reader || phoneFiles || filename) && titles.some(value => CLASSROOM_BOOK.test(value)))) {
    return { path: CLASSROOM, app };
  }
  if (app === "MangaFire" || MANGA_SITE.test(site)) return { path: MANGA, app };
  if (filename || tab?.pdfFilename || ((browser || reader || phoneFiles) && /\.(?:pdf|epub)$/i.test(title ?? ""))) {
    return { path: DIGITAL_BOOKS, app };
  }
  if (phoneFiles) return { path: MY_FILES, app };

  const fields: Record<string, (string | null | undefined)[]> = {
    app: [event.app],
    title: [event.title, title, tab?.title],
    url: [tab?.page, tab?.page && `https://${tab.page}`],
    "$domain": [tab?.site]
  };
  const matched = rules.find(({ rule, regex }) => rule.fields.some(field =>
    fields[field]?.some(value => value && regex.test(value))));
  const web = browser || app === "Google";
  if (matched) {
    // The legacy Browsing rule also covers desktop utilities.
    const path = matched.path[0] === "Browsing" && !web ? ["Utilities", ...matched.path.slice(1)] : statisticsCategoryPath(matched.path);
    return { path, app };
  }
  return { path: web ? WEB : UNCATEGORIZED, app };
}
