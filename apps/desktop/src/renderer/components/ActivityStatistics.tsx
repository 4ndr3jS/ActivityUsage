import { Button, Popover } from "@heroui/react";
import { useMemo, useRef, useState } from "react";
import { rankActivity, type ActivityStatistics as Statistics, type CategoryTotal } from "../activity-statistics";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon } from "../icons";
import { Bar } from "./dither-kit/bar";
import { BarChart } from "./dither-kit/bar-chart";
import type { ChartConfig } from "./dither-kit/chart-context";
import { Grid } from "./dither-kit/grid";
import { rgb } from "./dither-kit/palette";
import { Pie } from "./dither-kit/pie";
import { PieChart } from "./dither-kit/pie-chart";
import { Tooltip } from "./dither-kit/tooltip";
import { XAxis } from "./dither-kit/x-axis";
import { YAxis } from "./dither-kit/y-axis";
import "./activity-statistics.css";

const RANK_PAGE_SIZE = 6;
const percent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });

export function ActivityStatistics({ stats, ...props }: {
  stats: Statistics | null;
  hourly: boolean;
  allDevices: boolean;
  rulesFailed: boolean;
  showTitles: boolean;
  onToggleTitles(): void;
}): React.JSX.Element {
  if (!stats) return <div className="activity-loading" role="status"><span className="activity-spinner" />Preparing activity statistics…</div>;
  return <StatisticsContent stats={stats} {...props} />;
}

function StatisticsContent({ stats, hourly, allDevices, rulesFailed, showTitles, onToggleTitles }: {
  stats: Statistics; hourly: boolean; allDevices: boolean; rulesFailed: boolean; showTitles: boolean; onToggleTitles(): void;
}): React.JSX.Element {
  const [categoryId, setCategoryId] = useState("");
  const [appName, setAppName] = useState<string | null>(null);
  const options = useMemo(() => flattenCategories(stats.categories), [stats.categories]);
  const distribution = useMemo(() => stats.categories.map(asChartCategory), [stats.categories]);
  const selectedCategory = stats.categoriesById.get(categoryId);
  const selected = useMemo(() => selectedCategory ? asChartCategory(selectedCategory) : undefined, [selectedCategory]);
  const selectedRootId = selectedCategory ? JSON.stringify(selectedCategory.path.slice(0, 1)) : null;
  const timelineGroups = useMemo(() => selected ? [selected] : distribution, [selected, distribution]);
  const ranks = useMemo(() => rankActivity(stats, selectedCategory ? [selectedCategory] : []), [stats, selectedCategory]);
  const filteredApp = ranks.apps.some(row => row.label === appName) ? appName : null;
  const titles = useMemo(() => filteredApp ? ranks.titles.filter(row => row.app === filteredApp) : ranks.titles, [filteredApp, ranks.titles]);
  const message = rulesFailed ? "Couldn’t load the latest category rules from ActivityWatch."
    : stats.unsupportedRules > 0 ? `${stats.unsupportedRules} category ${stats.unsupportedRules === 1 ? "rule could" : "rules could"} not be read.`
    : !stats.hasRules ? "Set category rules in ActivityWatch to group recorded time." : null;

  function chooseCategory(id: string): void {
    setCategoryId(id);
    setAppName(null);
  }

  return <div className="activity-statistics">
    <div className="activity-statistics__charts">
      <CategoryTimeline stats={stats} groups={timelineGroups} selected={selected} hourly={hourly} allDevices={allDevices} />
      <CategoryMix total={stats.total} categories={stats.categories} groups={distribution} selected={selected} rootId={selectedRootId}
        onSelect={id => chooseCategory(selected?.id === id ? "" : id)} onClear={() => chooseCategory("")} />
    </div>
    {message && <p className="activity-statistics__status" role="status">{message}</p>}
    <div className="activity-statistics__detail-heading">
      <h2>Activity details</h2>
      <CategoryFilter options={options} selected={selected} onSelect={chooseCategory} />
    </div>
    <div className="activity-statistics__details">
      <section className="activity-glass-card activity-stat-card">
        <header className="activity-stat-card__heading"><div><h3>Category tree</h3><p>Category totals include subcategories.</p></div></header>
        {stats.categories.length ? <CategoryTree categories={stats.categories} selected={selectedCategory}
          onSelect={id => chooseCategory(selected?.id === id ? "" : id)} />
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
}

function asChartCategory(category: CategoryTotal): ChartCategory {
  return { id: category.id, label: category.path.join(" › "), color: category.color, seconds: category.seconds };
}

function chartConfig(groups: ChartCategory[]): ChartConfig {
  return Object.fromEntries(groups.map(group => [group.id, { label: group.label, color: group.color }]));
}

function CategoryTimeline({ stats, groups, selected, hourly, allDevices }: {
  stats: Statistics; groups: ChartCategory[]; selected?: ChartCategory; hourly: boolean; allDevices: boolean;
}): React.JSX.Element {
  const config = useMemo(() => chartConfig(groups), [groups]);
  const rows = useMemo(() => stats.periods.map((period): { key: number; label: string; [key: string]: number | string } => ({
    key: period.start, label: period.label,
    ...Object.fromEntries(groups.map(group => [
      group.id, period.totals.get(group.id) ?? 0
    ]))
  })), [groups, stats.periods]);
  const view = hourly ? "By hour" : stats.periods.some(period => period.label.includes(" – ")) ? "By date range" : "By day";
  const total = selected?.seconds ?? stats.total;
  return <section className="activity-glass-card activity-stat-card">
    <header className="activity-stat-card__heading">
      <div><h3>Category timeline</h3><p>{selected ? `${selected.label} · ${view.toLowerCase()}` : view}{allDevices && " · Computer and phone time are added"}</p></div>
      <strong>{formatTime(total)}</strong>
    </header>
    <div className="activity-chart-plot activity-stat-timeline" role="group" aria-label="Recorded time by category">
      {total > 0 ? <BarChart data={rows} config={config} stackType="stacked" animate={false}
        margins={{ top: 18, right: 25, bottom: 30, left: 51 }}>
        <Grid /><XAxis dataKey="label" maxTicks={7} minTickSpacing={85} /><YAxis tickFormatter={formatTime} tickCount={4} />
        {groups.map(group => <Bar key={group.id} dataKey={group.id} variant="solid" />)}
        <Tooltip labelKey="label" valueFormatter={formatTime} variant="frosted-glass" />
      </BarChart> : <div className="activity-chart-empty"><span>No recorded activity</span></div>}
    </div>
    {total > 0 && <details className="activity-chart-values">
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

function CategoryMix({ total, categories, groups, selected, rootId, onSelect, onClear }: {
  total: number; categories: CategoryTotal[]; groups: ChartCategory[]; selected?: ChartCategory; rootId: string | null;
  onSelect(id: string): void; onClear(): void;
}): React.JSX.Element {
  const slices = useMemo(() => categories.flatMap(category => [
    // Children already count toward their parent. Keep their colors available for drill-down.
    ...flattenCategories(category.children).map(child => ({ ...asChartCategory(child), seconds: 0 })),
    asChartCategory(category)
  ]), [categories]);
  const config = useMemo(() => chartConfig(slices), [slices]);
  return <section className="activity-glass-card activity-stat-card activity-stat-mix">
    <header className="activity-stat-card__heading"><div><h3>Category share</h3><p>Select a category to filter statistics.</p></div></header>
    {total > 0 ? <div className="activity-stat-mix__content">
      <div className="activity-stat-mix__ring">
        <div className="activity-stat-mix__plot" aria-hidden="true">
          <PieChart config={config} data={slices} dataKey="seconds" nameKey="id" innerRadius={0.70}
            selectedDataKey={selected?.id ?? null} onSlicePress={selected ? onClear : onSelect}
            margins={{ top: 6, right: 6, bottom: 6, left: 6 }} animate={false} fillOnSelection><Pie variant="solid" /></PieChart>
        </div>
        {selected
          ? <button type="button" className="activity-stat-mix__center" aria-label="Clear category filter" onClick={onClear}>
            <strong>{formatTime(selected.seconds)}</strong><small>Clear filter</small>
          </button>
          : <div className="activity-stat-mix__center"><strong>{formatTime(total)}</strong><small>recorded</small></div>}
      </div>
      <ul className="activity-stat-mix__legend">{groups.map(group => <li key={group.id}>
        <button type="button" aria-pressed={rootId === group.id} onClick={() => onSelect(group.id)}>
          <span className="activity-stat-swatch" style={{ backgroundColor: rgb(group.color) }} />
          <span>{group.label}</span><strong title={formatTime(group.seconds)}>{percent.format(group.seconds / total)}</strong>
        </button>
      </li>)}</ul>
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
  const selectedChild = Boolean(selected && selected.path.length > category.path.length
    && category.path.every((part, index) => part === selected.path[index]));
  const isOpen = expanded ?? selectedChild;
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
        <ol className="activity-stat-rank">{rows.slice(0, limit).map(row => <li key={JSON.stringify([row.app, row.label])}>
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
