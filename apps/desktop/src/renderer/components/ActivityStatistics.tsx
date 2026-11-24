import { Button, Popover } from "@heroui/react";
import { useMemo, useRef, useState } from "react";
import { directCategoryColor, directCategoryTime, rankActivity, type ActivityStatistics as Statistics, type CategoryTotal } from "../activity-statistics";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon } from "../icons";
import { todayDay } from "../personal-analytics";
import { Bar } from "./dither-kit/bar";
import { BarChart } from "./dither-kit/bar-chart";
import { useChartPart, type ChartConfig } from "./dither-kit/chart-context";
import { Grid } from "./dither-kit/grid";
import { rgb, seedOfColor } from "./dither-kit/palette";
import { Pie } from "./dither-kit/pie";
import { PieChart } from "./dither-kit/pie-chart";
import { Tooltip } from "./dither-kit/tooltip";
import { XAxis } from "./dither-kit/x-axis";
import { YAxis } from "./dither-kit/y-axis";
import "./activity-statistics.css";

const RANK_PAGE_SIZE = 6;
const percent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });

interface StatisticsControls {
  hourly: boolean;
  allDevices: boolean;
  rulesFailed: boolean;
  showTitles: boolean;
  distinctSubcategoryColors: boolean;
  onToggleTitles(): void;
  onToggleSubcategoryColors(): void;
  onSelectDay(day: string): void;
  onReturnToRange?(): void;
}

export function ActivityStatistics({ stats, ...props }: StatisticsControls & { stats: Statistics | null }): React.JSX.Element {
  if (!stats) return <div className="activity-loading" role="status"><span className="activity-spinner" />Preparing activity statistics…</div>;
  return <StatisticsContent stats={stats} {...props} />;
}

function StatisticsContent({ stats, hourly, allDevices, rulesFailed, showTitles, distinctSubcategoryColors,
  onToggleTitles, onToggleSubcategoryColors, onSelectDay, onReturnToRange }:
  StatisticsControls & { stats: Statistics }): React.JSX.Element {
  const [categoryChoice, setCategoryChoice] = useState<CategoryTotal | null>(null);
  const [appName, setAppName] = useState<string | null>(null);
  const categories = useMemo(() => distinctSubcategoryColors ? stats.categories :
    stats.categories.map(category => inheritCategoryColor(category, category.color)), [stats.categories, distinctSubcategoryColors]);
  const options = useMemo(() => flattenCategories(categories), [categories]);
  const selectedCategory = useMemo(() => {
    if (!categoryChoice) return undefined;
    return options.find(category => category.id === categoryChoice.id)
      ?? (onReturnToRange ? { ...categoryChoice, seconds: 0, children: [] } : undefined);
  }, [categoryChoice, options, onReturnToRange]);
  const selected = useMemo(() => selectedCategory ? asChartCategory(selectedCategory) : undefined, [selectedCategory]);
  const parent = selectedCategory && stats.categoriesById.get(JSON.stringify(selectedCategory.path.slice(0, -1)));
  const groups = useMemo(() => chartGroups(categories, selectedCategory, distinctSubcategoryColors),
    [categories, selectedCategory, distinctSubcategoryColors]);
  const ranks = useMemo(() => rankActivity(stats, selectedCategory ? [selectedCategory] : []), [stats, selectedCategory]);
  const filteredApp = ranks.apps.some(row => row.label === appName) ? appName : null;
  const titles = useMemo(() => ranks.titles.filter(row => filteredApp ? row.app === filteredApp : !row.unrecordedTitle), [filteredApp, ranks.titles]);
  const message = rulesFailed ? "Couldn’t load the latest category rules from ActivityWatch."
    : stats.unsupportedRules > 0 ? `${stats.unsupportedRules} category ${stats.unsupportedRules === 1 ? "rule could" : "rules could"} not be read.` : null;

  function chooseCategory(id: string): void {
    setCategoryChoice(stats.categoriesById.get(id) ?? null);
    setAppName(null);
  }

  return <div className="activity-statistics">
    <div className="activity-statistics__charts">
      <CategoryTimeline stats={stats} groups={groups} selected={selectedCategory} hourly={hourly} allDevices={allDevices}
        distinctSubcategoryColors={distinctSubcategoryColors}
        onSelectDay={onSelectDay} onReturnToRange={onReturnToRange} />
      <CategoryMix total={selected?.seconds ?? stats.total} groups={groups} selected={selected} parentLabel={parent?.path.at(-1)}
        distinctSubcategoryColors={distinctSubcategoryColors} onToggleSubcategoryColors={onToggleSubcategoryColors}
        onSelect={chooseCategory} onBack={() => chooseCategory(parent?.id ?? "")} />
    </div>
    {message && <p className="activity-statistics__status" role="status">{message}</p>}
    <div className="activity-statistics__detail-heading">
      <h2>Activity details</h2>
      <CategoryFilter options={options} selected={selected} onSelect={chooseCategory} />
    </div>
    <div className="activity-statistics__details">
      <section className="activity-glass-card activity-stat-card">
        <header className="activity-stat-card__heading"><div><h3>Category tree</h3><p>Category totals include subcategories.</p></div></header>
        {categories.length ? <CategoryTree categories={categories} selected={selectedCategory}
          onSelect={id => chooseCategory(selected?.id === id ? parent?.id ?? "" : id)} />
          : <p className="activity-stat-card__empty">No categories in this period.</p>}
      </section>
      <RankCard key={`apps-${selected?.id ?? ""}`} title="Top applications" subtitle={selected?.label} rows={ranks.apps}
        empty="No app activity in this selection." selectedRow={filteredApp} onSelectRow={label => setAppName(label === filteredApp ? null : label)} />
      <RankCard key={JSON.stringify([selected?.id, filteredApp])} title="Top window titles" subtitle={filteredApp ?? selected?.label} rows={titles}
        empty="No window titles were recorded in this selection." hideRows={!showTitles}
        action={<button className="activity-stat-card__action" type="button" aria-pressed={showTitles} onClick={onToggleTitles}>{showTitles ? "Hide titles" : "Show titles"}</button>} />
    </div>
  </div>;
}

interface ChartCategory {
  id: string;
  label: string;
  color: CategoryTotal["color"];
  seconds: number;
  direct?: true;
}

function asChartCategory(category: CategoryTotal): ChartCategory {
  return { id: category.id, label: category.path.join(" › "), color: category.color, seconds: category.seconds };
}

function chartGroups(roots: CategoryTotal[], selected: CategoryTotal | undefined, distinctSubcategoryColors: boolean): ChartCategory[] {
  if (!selected) return roots.map(asChartCategory);
  if (!selected.children.length) return [asChartCategory(selected)];
  const groups = selected.children.map(child => ({ ...asChartCategory(child), label: child.path.at(-1)! }));
  const direct = directCategoryTime(selected);
  if (!direct) return groups;
  return [...groups, {
    ...asChartCategory(selected), label: `Other ${selected.path.at(-1)} activity`,
    color: distinctSubcategoryColors ? directCategoryColor(selected) : selected.color, seconds: direct, direct: true
  }];
}

function chartConfig(groups: ChartCategory[]): ChartConfig {
  return Object.fromEntries(groups.map(group => [group.id, { label: group.label, color: group.color }]));
}

function CategoryTimeline({ stats, groups, selected, hourly, allDevices, distinctSubcategoryColors, onSelectDay, onReturnToRange }: {
  stats: Statistics; groups: ChartCategory[]; selected?: CategoryTotal; hourly: boolean; allDevices: boolean;
  distinctSubcategoryColors: boolean;
  onSelectDay(day: string): void; onReturnToRange?(): void;
}): React.JSX.Element {
  const merged = selected && groups.length > 1 && !distinctSubcategoryColors ? selected : undefined;
  const bars = useMemo(() => merged ? [{ ...asChartCategory(merged), id: "total" }] : groups, [groups, merged]);
  const config = useMemo(() => chartConfig(bars), [bars]);
  const rows = useMemo(() => stats.periods.map((period): { key: number; label: string; [key: string]: number | string } => ({
    key: period.start, label: period.label,
    ...(merged ? { total: period.totals.get(merged.id) ?? 0 } : {}),
    ...Object.fromEntries(groups.map(group => [
      group.id, group.direct && selected ? directCategoryTime(selected, period.totals) : period.totals.get(group.id) ?? 0
    ]))
  })), [groups, merged, selected, stats.periods]);
  const view = hourly ? "By hour" : stats.periods.some(period => period.label.includes(" – ")) ? "By date range" : "By day";
  const subtitle = (selected ? `${selected.path.join(" › ")} · ${view.toLowerCase()}` : view)
    + (allDevices ? " · Computer and phone time are added" : "");
  const total = selected?.seconds ?? stats.total;
  const periodKey = `${stats.periods[0]?.start}:${stats.periods.at(-1)?.end}:${hourly}`;

  return <section className="activity-glass-card activity-stat-card activity-stat-timeline-card">
    <header className="activity-stat-card__heading">
      <div><h3>Category timeline</h3><p title={subtitle}>{subtitle}</p></div>
      <div className="activity-stat-timeline__summary">
        <strong>{formatTime(total)}</strong>
        {onReturnToRange && <button className="activity-stat-card__action" type="button" onClick={onReturnToRange}>Back to range</button>}
      </div>
    </header>
    <div key={periodKey} className="activity-chart-plot activity-stat-timeline" role="group" aria-label="Recorded time by category">
      {rows.length ? <BarChart data={rows} config={config} stackType="stacked" animate={false}
        margins={{ top: 18, right: 25, bottom: 30, left: 51 }}>
        <Grid /><XAxis dataKey="label" maxTicks={7} minTickSpacing={85} /><YAxis tickFormatter={formatTime} tickCount={4} />
        {bars.map(bar => <Bar key={bar.id} dataKey={bar.id} variant="solid" />)}
        {!hourly && <DailyBarActions periods={stats.periods} onSelectDay={onSelectDay} />}
        <Tooltip labelKey="label" valueFormatter={formatTime} variant="frosted-glass" hideZeroValues
          itemsAt={merged ? index => groups.map(group => ({
            name: group.id, label: group.label, value: Number(rows[index]?.[group.id] ?? 0),
            seed: seedOfColor(group.color), dimmed: false
          })) : undefined} />
      </BarChart> : <div className="activity-chart-empty"><span>No recorded activity</span></div>}
    </div>
    {total > 0 && <details className="activity-chart-values">
      <summary>View chart values</summary>
      <div><table><thead><tr><th scope="col">Period</th>{groups.map(group => <th key={group.id} scope="col">{group.label}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={`${row.key}:${row.label}`}><th scope="row">{row.label}</th>
          {groups.map(group => {
            const value = Number(row[group.id]);
            return <td key={group.id}>{value > 0 ? formatTime(value) : "—"}</td>;
          })}
        </tr>)}</tbody></table></div>
    </details>}
  </section>;
}

function DailyBarActions({ periods, onSelectDay }: {
  periods: Statistics["periods"]; onSelectDay(day: string): void;
}): React.JSX.Element | null {
  const chart = useChartPart("DailyBarActions", "bar");
  if (!chart.ready) return null;
  const baseline = chart.y(0);
  return <>{periods.map((period, index) => {
    const day = todayDay(new Date(period.start));
    if (day !== todayDay(new Date(period.end - 1))) return null;
    const total = Math.max(0, ...chart.configKeys.map(key => chart.bands[key]?.[index]?.[1] ?? 0));
    const slot = chart.barSlot(index, 0, chart.configKeys.length);
    const height = Math.max(12, baseline - chart.y(total));
    return <button key={day} className="activity-stat-timeline__day" type="button" aria-label={`Show activity for ${period.label}`}
      style={{ left: chart.margins.left + slot.x, top: chart.margins.top + baseline - height, width: slot.width, height }}
      onClick={() => onSelectDay(day)} />;
  })}</>;
}

DailyBarActions.chartLayer = "dom" as const;

function CategoryMix({ total, groups, selected, parentLabel, distinctSubcategoryColors, onToggleSubcategoryColors, onSelect, onBack }: {
  total: number; groups: ChartCategory[]; selected?: ChartCategory; parentLabel?: string;
  distinctSubcategoryColors: boolean;
  onToggleSubcategoryColors(): void;
  onSelect(id: string): void; onBack(): void;
}): React.JSX.Element {
  const config = useMemo(() => chartConfig(groups), [groups]);
  const isLeaf = selected?.id === groups[0]?.id && groups.length === 1;
  return <section className="activity-glass-card activity-stat-card activity-stat-mix">
    <header className="activity-stat-card__heading activity-stat-mix__heading">
      <h3>Category share</h3>
      <p title={selected?.label}>{selected?.label ?? "Select a category to filter statistics."}</p>
      {selected && groups.length > 1 && <label className="activity-switch activity-stat-mix__color-toggle">
        <input type="checkbox" role="switch" aria-label="Different colors for subcategories"
          checked={distinctSubcategoryColors} onChange={onToggleSubcategoryColors} />
        <span>Different colors</span>
      </label>}
    </header>
    {total > 0 ? <div className="activity-stat-mix__content">
      <div className="activity-stat-mix__ring">
        <div className="activity-stat-mix__plot" aria-hidden="true">
          <PieChart config={config} data={groups} dataKey="seconds" nameKey="id" innerRadius={0.70}
            onSlicePress={id => { if (isLeaf) onBack(); else if (id !== selected?.id) onSelect(id); }}
            margins={{ top: 6, right: 6, bottom: 6, left: 6 }} animate={false} expandOnHover={false}><Pie variant="solid" /></PieChart>
        </div>
        {selected
          ? <button type="button" className="activity-stat-mix__center" aria-label={parentLabel ? `Back to ${parentLabel}` : "Clear category filter"} onClick={onBack}>
            <strong>{formatTime(total)}</strong><small>{parentLabel ? "Back" : "Clear filter"}</small>
          </button>
          : <div className="activity-stat-mix__center"><strong>{formatTime(total)}</strong><small>recorded</small></div>}
      </div>
      <ul key={selected?.id ?? "all"} className="activity-stat-mix__legend">{groups.map(group => {
        const share = group.seconds / total;
        const content = <>
          <span className="activity-stat-swatch" style={{ backgroundColor: rgb(group.color) }} />
          <span>{group.label}</span><strong title={formatTime(group.seconds)}>{share < 0.0005 ? `<${percent.format(0.001)}` : percent.format(share)}</strong>
        </>;
        return <li key={group.id}>{group.id === selected?.id
          ? <div className="activity-stat-mix__legend-row">{content}</div>
          : <button type="button" className="activity-stat-mix__legend-row" onClick={() => onSelect(group.id)}>{content}</button>}
        </li>;
      })}</ul>
    </div> : <p className="activity-stat-card__empty">No recorded activity.</p>}
  </section>;
}

function CategoryFilter({ options, selected, onSelect }: {
  options: CategoryTotal[]; selected?: ChartCategory; onSelect(id: string): void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [boundary, setBoundary] = useState<HTMLElement>();
  const filterRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLElement>(null);
  const choices = [{ id: "", label: "All categories", color: null }, ...options.map(asChartCategory)];
  return <div className="activity-statistics__filter" ref={filterRef}>
    <span>Filter apps and titles</span>
    <Popover isOpen={open} onOpenChange={nextOpen => {
      if (nextOpen) setBoundary(filterRef.current?.closest("main") ?? undefined);
      setOpen(nextOpen);
    }}>
      <Button className="atlas-period-trigger justify-between" variant="secondary" isDisabled={!options.length}
        aria-label={`Filter apps and titles: ${selected?.label ?? "All categories"}`}>
        <span className="truncate">{selected?.label ?? "All categories"}</span><ChevronDownIcon className="size-4 shrink-0 text-muted" />
      </Button>
      <Popover.Content className="atlas-time-popover activity-statistics__popover" placement="bottom end" offset={7}
        boundaryElement={boundary} containerPadding={8} scrollRef={menuRef}>
        <Popover.Dialog aria-label="Filter by category" className="atlas-time-menu activity-statistics__menu" ref={menuRef}>
          {choices.map(choice => {
            const isCurrent = choice.id === (selected?.id ?? "");
            return <Button key={choice.id} className="atlas-time-option" variant={isCurrent ? "secondary" : "ghost"}
              aria-pressed={isCurrent} onPress={() => { onSelect(choice.id); setOpen(false); }}>
              {choice.color && <span className="activity-stat-swatch" style={{ backgroundColor: rgb(choice.color) }} />}
              <span className="min-w-0 flex-1">{choice.label}</span>
              {isCurrent && <CheckIcon className="atlas-time-option__check" />}
            </Button>;
          })}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  </div>;
}

type CategoryTreeProps = { selected?: CategoryTotal; onSelect(id: string): void };

function CategoryTree({ categories, ...props }: CategoryTreeProps & { categories: CategoryTotal[] }): React.JSX.Element {
  return <ul className="activity-stat-tree">{categories.map(category => <CategoryTreeItem key={category.id} category={category} {...props} />)}</ul>;
}

function CategoryTreeItem({ category, selected, onSelect }: CategoryTreeProps & { category: CategoryTotal }): React.JSX.Element {
  const [expanded, setExpanded] = useState<boolean>();
  const label = category.path.at(-1);
  const selectedBranch = Boolean(selected && selected.path.length >= category.path.length
    && category.path.every((part, index) => part === selected.path[index]));
  const isOpen = expanded ?? selectedBranch;
  return <li>
    <div className="activity-stat-tree__row">
      {category.children.length > 0 && <button className="activity-stat-tree__expand" type="button"
        aria-label={`${isOpen ? "Collapse" : "Expand"} ${label}`} aria-expanded={isOpen}
        onClick={() => setExpanded(!isOpen)}><ChevronRightIcon aria-hidden="true" /></button>}
      <button className="activity-stat-tree__select" type="button" aria-pressed={selected?.id === category.id} onClick={() => onSelect(category.id)}>
        <span className="activity-stat-swatch" style={{ backgroundColor: rgb(category.color) }} />
        <span className="activity-stat-tree__name">{label}</span><strong>{formatTime(category.seconds)}</strong>
      </button>
    </div>
    {category.children.length > 0 && isOpen && <CategoryTree categories={category.children} selected={selected} onSelect={onSelect} />}
  </li>;
}

function flattenCategories(categories: CategoryTotal[]): CategoryTotal[] {
  return categories.flatMap(category => [category, ...flattenCategories(category.children)]);
}

function inheritCategoryColor(category: CategoryTotal, color: CategoryTotal["color"]): CategoryTotal {
  return { ...category, color, children: category.children.map(child => inheritCategoryColor(child, color)) };
}

function RankCard({ title, subtitle, rows, empty, action, hideRows = false, selectedRow, onSelectRow }: {
  title: string;
  subtitle?: string;
  rows: ReturnType<typeof rankActivity>["titles"];
  empty: string;
  action?: React.ReactNode;
  hideRows?: boolean;
  selectedRow?: string | null;
  onSelectRow?(label: string): void;
}): React.JSX.Element {
  const [limit, setLimit] = useState(RANK_PAGE_SIZE);
  return <section className="activity-glass-card activity-stat-card">
    <header className="activity-stat-card__heading"><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>{action}</header>
    {hideRows ? <p className="activity-stat-card__empty">Window titles are hidden by your privacy setting.</p>
      : rows.length ? <>
        <ol className="activity-stat-rank">{rows.slice(0, limit).map(row => <li key={JSON.stringify([row.app, row.label, row.unrecordedTitle])}>
          {onSelectRow
            ? <button className="activity-stat-rank__entry" type="button" aria-pressed={selectedRow === row.label}
              aria-label={`Filter window titles by ${row.label}, ${formatTime(row.seconds)}`} onClick={() => onSelectRow(row.label)}>
              <span title={row.label}>{row.label}</span><strong>{formatTime(row.seconds)}</strong>
            </button>
            : <div className="activity-stat-rank__entry"><span title={row.label}>{row.label}</span><strong>{formatTime(row.seconds)}</strong></div>}
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
