import { useEffect, useMemo, useState } from "react";
import type { ActivityWatchCategory, ActivityWatchRecord } from "../../shared/desktop-api";
import { buildActivityStatistics, rankActivity, type ActivityStatistics as Statistics, type CategoryTotal } from "../activity-statistics";
import { ChevronRightIcon } from "../icons";
import { Bar } from "./dither-kit/bar";
import { BarChart } from "./dither-kit/bar-chart";
import type { ChartConfig } from "./dither-kit/chart-context";
import { Grid } from "./dither-kit/grid";
import { PALETTE, rgb } from "./dither-kit/palette";
import { Pie } from "./dither-kit/pie";
import { PieChart } from "./dither-kit/pie-chart";
import { Tooltip } from "./dither-kit/tooltip";
import { XAxis } from "./dither-kit/x-axis";
import { YAxis } from "./dither-kit/y-axis";
import "./activity-statistics.css";

const RANK_PAGE_SIZE = 6;
const VISIBLE_CATEGORIES = 5;
const percent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });

export function ActivityStatistics({ events, period, hourly, allDevices, fetchedAt, showTitles, onToggleTitles }: {
  events: ActivityWatchRecord[];
  period: { start: Date; end: Date };
  hourly: boolean;
  allDevices: boolean;
  fetchedAt: string;
  showTitles: boolean;
  onToggleTitles(): void;
}): React.JSX.Element {
  const [settings, setSettings] = useState<{ categories: ActivityWatchCategory[]; ready: boolean; error: boolean }>({
    categories: [], ready: false, error: false
  });
  const [categoryId, setCategoryId] = useState("");

  useEffect(() => {
    let active = true;
    void window.usageAtlas.getActivityWatchCategories().then(
      categories => { if (active) setSettings({ categories, ready: true, error: false }); },
      () => { if (active) setSettings(previous => ({ ...previous, ready: true, error: true })); }
    );
    return () => { active = false; };
  }, [fetchedAt]);

  const stats = useMemo(
    () => buildActivityStatistics(events, settings.categories, period, hourly, showTitles),
    [events, settings.categories, period, hourly, showTitles]
  );
  const selected = stats.categoriesById.get(categoryId);
  const ranks = useMemo(() => rankActivity(stats, selected), [stats, selected]);
  const options = useMemo(() => flattenCategories(stats.categories), [stats.categories]);
  const distribution = useMemo(() => chartCategories(stats.categories), [stats.categories]);
  const message = settings.error ? "Couldn’t load the latest category rules from ActivityWatch."
    : stats.unsupportedRules > 0 ? `${stats.unsupportedRules} category ${stats.unsupportedRules === 1 ? "rule could" : "rules could"} not be read.`
    : settings.ready && !stats.hasRules ? "Set category rules in ActivityWatch to group recorded time." : null;

  return <div className="activity-statistics">
    <div className="activity-statistics__charts">
      <CategoryTimeline stats={stats} groups={distribution} hourly={hourly} allDevices={allDevices} rulesReady={settings.ready} />
      <CategoryMix stats={stats} groups={distribution} rulesReady={settings.ready} />
    </div>
    {message && <p className="activity-statistics__status" role="status">{message}</p>}
    <div className="activity-statistics__detail-heading">
      <h2>Activity details</h2>
      <label className="activity-statistics__filter">
        <span>Filter apps and titles</span>
        <select value={selected?.id ?? ""} onChange={event => setCategoryId(event.target.value)} disabled={!settings.ready || !options.length}>
          <option value="">All categories</option>
          {options.map(category => <option key={category.id} value={category.id}>{category.path.join(" › ")}</option>)}
        </select>
      </label>
    </div>
    <div className="activity-statistics__details">
      <section className="activity-glass-card activity-stat-card">
        <header className="activity-stat-card__heading"><div><h3>Category tree</h3><p>Category totals include subcategories.</p></div></header>
        {!settings.ready ? <p className="activity-stat-card__empty" role="status">Reading category rules…</p>
          : stats.categories.length ? <CategoryTree categories={stats.categories} />
          : <p className="activity-stat-card__empty">No categories in this period.</p>}
      </section>
      <RankCard key={`apps-${selected?.id ?? ""}`} title="Top applications" rows={ranks.apps} empty="No app activity in this selection." />
      <RankCard key={`titles-${selected?.id ?? ""}`} title="Top window titles" rows={ranks.titles}
        empty="No window titles were recorded in this selection." hideRows={!showTitles}
        action={<button className="activity-stat-card__action" type="button" aria-pressed={showTitles} onClick={onToggleTitles}>Show titles</button>} />
    </div>
  </div>;
}

interface ChartCategory {
  id: string;
  label: string;
  color: CategoryTotal["color"];
  seconds: number;
  sources: string[];
}

function chartCategories(categories: CategoryTotal[]): ChartCategory[] {
  const count = categories.length > VISIBLE_CATEGORIES + 1 ? VISIBLE_CATEGORIES : categories.length;
  const groups = categories.slice(0, count).map(category => ({
    id: category.id, label: category.path[0], seconds: category.seconds, color: category.color, sources: [category.id]
  }));
  const remainder = categories.slice(count);
  if (remainder.length) {
    groups.push({
      id: "other", label: "Other categories", color: PALETTE.grey.fill,
      seconds: remainder.reduce((sum, category) => sum + category.seconds, 0),
      sources: remainder.map(category => category.id)
    });
  }
  return groups;
}

function chartConfig(groups: ChartCategory[]): ChartConfig {
  return Object.fromEntries(groups.map(group => [group.id, { label: group.label, color: group.color }]));
}

function CategoryTimeline({ stats, groups, hourly, allDevices, rulesReady }: {
  stats: Statistics; groups: ChartCategory[]; hourly: boolean; allDevices: boolean; rulesReady: boolean;
}): React.JSX.Element {
  const config = useMemo(() => chartConfig(groups), [groups]);
  const rows = useMemo(() => stats.periods.map((period): { key: number; label: string; [key: string]: number | string } => ({
    key: period.start, label: period.label,
    ...Object.fromEntries(groups.map(group => [
      group.id, group.sources.reduce((sum, id) => sum + (period.totals.get(id) ?? 0), 0)
    ]))
  })), [groups, stats.periods]);
  const view = hourly ? "By hour" : stats.periods.some(period => period.label.includes(" – ")) ? "By date range" : "By day";
  return <section className="activity-glass-card activity-stat-card">
    <header className="activity-stat-card__heading">
      <div><h3>Category timeline</h3><p>{view}{allDevices && " · Computer and phone time are added"}</p></div>
      <strong>{formatTime(stats.total)}</strong>
    </header>
    <div className="activity-chart-plot activity-stat-timeline" role="group" aria-label="Recorded time by category">
      {rulesReady && stats.total > 0 ? <BarChart data={rows} config={config} stackType="stacked" animate={false}
        margins={{ top: 18, right: 25, bottom: 30, left: 51 }}>
        <Grid /><XAxis dataKey="label" maxTicks={7} minTickSpacing={85} /><YAxis tickFormatter={formatTime} tickCount={4} />
        {groups.map(group => <Bar key={group.id} dataKey={group.id} variant="solid" />)}
        <Tooltip labelKey="label" valueFormatter={formatTime} variant="frosted-glass" />
      </BarChart> : <div className="activity-chart-empty"><span>{rulesReady ? "No recorded activity" : "Reading category rules…"}</span></div>}
    </div>
    {rulesReady && stats.total > 0 && <details className="activity-chart-values">
      <summary>View chart values</summary>
      <div><table><thead><tr><th scope="col">Period</th>{groups.map(group => <th key={group.id} scope="col">{group.label}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.key}><th scope="row">{row.label}</th>
          {groups.map(group => {
            const value = Number(row[group.id]);
            return <td key={group.id}>{value > 0 ? formatTime(value) : "—"}</td>;
          })}
        </tr>)}</tbody></table></div>
    </details>}
  </section>;
}

function CategoryMix({ stats, groups, rulesReady }: { stats: Statistics; groups: ChartCategory[]; rulesReady: boolean }): React.JSX.Element {
  const config = useMemo(() => chartConfig(groups), [groups]);
  return <section className="activity-glass-card activity-stat-card activity-stat-mix">
    <header className="activity-stat-card__heading"><div><h3>Category share</h3><p>Share of recorded device time</p></div></header>
    {rulesReady && stats.total > 0 ? <div className="activity-stat-mix__content">
      <div className="activity-stat-mix__ring" aria-hidden="true">
        <PieChart config={config} data={groups} dataKey="seconds" nameKey="id" innerRadius={0.7}
          margins={{ top: 6, right: 6, bottom: 6, left: 6 }} animate={false} expandOnHover={false}><Pie variant="solid" /></PieChart>
        <div className="activity-stat-mix__center"><strong>{formatTime(stats.total)}</strong><small>recorded</small></div>
      </div>
      <ul className="activity-stat-mix__legend">{groups.map(group => <li key={group.id}>
        <span className="activity-stat-swatch" style={{ backgroundColor: rgb(group.color) }} />
        <span title={group.label}>{group.label}</span><strong title={formatTime(group.seconds)}>{percent.format(group.seconds / stats.total)}</strong>
      </li>)}</ul>
    </div> : <p className="activity-stat-card__empty">{rulesReady ? "No recorded activity." : "Reading category rules…"}</p>}
  </section>;
}

function CategoryTree({ categories }: { categories: CategoryTotal[] }): React.JSX.Element {
  return <ul className="activity-stat-tree">{categories.map(category => {
    const label = category.path.at(-1);
    const content = <>
      <span className="activity-stat-swatch" style={{ backgroundColor: rgb(category.color) }} />
      <span className="activity-stat-tree__name" title={label}>{label}</span><strong>{formatTime(category.seconds)}</strong>
    </>;
    return <li key={category.id}>{category.children.length ? <details>
      <summary><ChevronRightIcon />{content}</summary>
      <CategoryTree categories={category.children} />
    </details> : <div>{content}</div>}</li>;
  })}</ul>;
}

function flattenCategories(categories: CategoryTotal[]): CategoryTotal[] {
  return categories.flatMap(category => [category, ...flattenCategories(category.children)]);
}

function RankCard({ title, rows, empty, action, hideRows = false }: {
  title: string;
  rows: ReturnType<typeof rankActivity>["titles"];
  empty: string;
  action?: React.ReactNode;
  hideRows?: boolean;
}): React.JSX.Element {
  const [limit, setLimit] = useState(RANK_PAGE_SIZE);
  return <section className="activity-glass-card activity-stat-card">
    <header className="activity-stat-card__heading"><h3>{title}</h3>{action}</header>
    {hideRows ? <p className="activity-stat-card__empty">Window titles are hidden by your privacy setting.</p>
      : rows.length ? <>
        <ol className="activity-stat-rank">{rows.slice(0, limit).map(row => <li key={JSON.stringify([row.app, row.label])}>
          <div><span title={row.label}>{row.label}</span><strong>{formatTime(row.seconds)}</strong></div>
          {row.app && <small>{row.app}</small>}
          <div aria-hidden="true" className="activity-stat-rank__track"><span style={{ width: `${row.seconds / rows[0].seconds * 100}%` }} /></div>
        </li>)}</ol>
        {rows.length > limit && <button className="activity-stat-card__action activity-stat-card__more" type="button"
          onClick={() => setLimit(value => value + RANK_PAGE_SIZE)}>Show more</button>}
      </> : <p className="activity-stat-card__empty">{empty}</p>}
  </section>;
}

function formatTime(value: number): string {
  const seconds = Math.round(value);
  if (seconds < 60) return seconds || value === 0 ? `${seconds}s` : "<1s";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m${seconds % 60 ? ` ${seconds % 60}s` : ""}`;
}
