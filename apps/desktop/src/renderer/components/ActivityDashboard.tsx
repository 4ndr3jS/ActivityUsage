import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivityDevice, ActivityWatchRecord, ActivityWatchSnapshot } from "../../shared/desktop-api";
import { ChevronLeftIcon, ChevronRightIcon, RefreshIcon, ShareIcon } from "../icons";
import { Area } from "./dither-kit/area";
import { AreaChart } from "./dither-kit/area-chart";
import { Bar } from "./dither-kit/bar";
import { BarChart } from "./dither-kit/bar-chart";
import { Grid } from "./dither-kit/grid";
import { Pie } from "./dither-kit/pie";
import { PieChart } from "./dither-kit/pie-chart";
import { Sparkline } from "./dither-kit/sparkline";
import { Tooltip } from "./dither-kit/tooltip";
import { XAxis } from "./dither-kit/x-axis";
import { YAxis } from "./dither-kit/y-axis";
import type { DitherColor } from "./dither-kit/palette";
import { createActivityPeriod } from "../activity-period";
import "./activity-dashboard.css";

type RangeDays = 1 | 7 | 30 | 90 | 365;
export type ActivityView = "overview" | "history" | "breakdown" | "insights" | "sources" | "settings";
type DeviceFilter = "all" | ActivityDevice;
const EMPTY_EVENTS: ActivityWatchRecord[] = [];

interface Period {
  start: Date;
  end: Date;
}

interface Interval {
  start: number;
  end: number;
}

interface DayActivity {
  key: string;
  label: string;
  computer: number;
  phone: number;
  combined: number;
}

interface AppActivity {
  label: string;
  seconds: number;
  events: number;
}

export function ActivityDashboard({ view }: { view: ActivityView }): React.JSX.Element {
  const [rangeDays, setRangeDays] = useState<RangeDays>(view === "overview" ? 1 : 30);
  const previousView = useRef(view);
  const requestVersion = useRef(0);
  const [periodOffset, setPeriodOffset] = useState(0);
  const [device, setDevice] = useState<DeviceFilter>("all");
  const [compare, setCompare] = useState(false);
  const [showTitles, setShowTitles] = useState(() => readPreference("usageatlas.activity.showTitles"));
  const [includeLabels, setIncludeLabels] = useState(() => readPreference("usageatlas.activity.includeLabels"));
  const [autoRefresh, setAutoRefresh] = useState(() => readPreference("usageatlas.activity.autoRefresh"));
  const [snapshot, setSnapshot] = useState<ActivityWatchSnapshot | null>(null);
  const [previousSnapshot, setPreviousSnapshot] = useState<ActivityWatchSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const wasOverview = previousView.current === "overview";
    const isOverview = view === "overview";
    if (wasOverview !== isOverview) {
      setRangeDays(isOverview ? 1 : 30);
      setPeriodOffset(0);
    }
    previousView.current = view;
  }, [view]);

  const period = useMemo(() => createActivityPeriod(rangeDays, periodOffset), [periodOffset, rangeDays]);
  const loadData = useCallback(async (): Promise<void> => {
    const request = ++requestVersion.current;
    setLoading(true);
    setError(null);
    setSnapshot(null);
    setPreviousSnapshot(null);
    try {
      const currentRange = { start: period.start.toISOString(), end: period.end.toISOString() };
      const previousRange = {
        start: new Date(new Date(period.start).setDate(period.start.getDate() - rangeDays)).toISOString(),
        end: period.start.toISOString()
      };
      const currentPromise = window.usageAtlas.getActivityWatchData(currentRange);
      const previousPromise = compare ? window.usageAtlas.getActivityWatchData(previousRange) : Promise.resolve(null);
      const [current, previous] = await Promise.all([currentPromise, previousPromise]);
      if (request !== requestVersion.current) return;
      setSnapshot(current);
      setPreviousSnapshot(previous);
    } catch (caught: unknown) {
      if (request === requestVersion.current) setError(caught instanceof Error ? caught.message : "ActivityWatch could not be reached.");
    } finally {
      if (request === requestVersion.current) setLoading(false);
    }
  }, [compare, period, rangeDays]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadData(); }, 0);
    return () => { window.clearTimeout(timer); requestVersion.current += 1; };
  }, [loadData]);
  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = window.setInterval(() => {
      void loadData();
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, loadData]);

  const events = snapshot?.events ?? EMPTY_EVENTS;
  const visibleEvents = useMemo(() => filterEvents(events, device), [device, events]);
  const summary = useMemo(() => summarize(events, device), [device, events]);
  const previousSummary = useMemo(
    () => summarize(previousSnapshot?.events ?? [], device),
    [device, previousSnapshot]
  );
  const days = useMemo(() => buildDays(events, period, rangeDays), [events, period, rangeDays]);
  const visibleDays = useMemo(() => days.map(day => {
    if (device === "computer") return { ...day, phone: 0, combined: day.computer };
    if (device === "phone") return { ...day, computer: 0, combined: day.phone };
    return day;
  }), [days, device]);
  const hours = useMemo(() => buildHours(events, period.start, device), [device, events, period.start]);
  const hourProfile = useMemo(() => buildHourProfile(events, device), [device, events]);
  const apps = useMemo(() => buildApps(visibleEvents, showTitles), [showTitles, visibleEvents]);
  const peakDay = visibleDays.reduce<DayActivity | null>((peak, day) => !peak || day.combined > peak.combined ? day : peak, null);
  const periodLabel = labelPeriod(period, rangeDays);
  const pageTitle: Record<ActivityView, string> = {
    overview: "Your device activity",
    history: "Activity history",
    breakdown: "Activity breakdown",
    insights: "Your activity rhythm",
    sources: "ActivityWatch sources",
    settings: "Activity preferences"
  };

  function updatePreference(key: string, next: boolean, setter: (value: boolean) => void): void {
    setter(next);
    try { window.localStorage.setItem(key, next ? "1" : "0"); } catch { /* Keep the current session usable if storage is disabled. */ }
  }

  async function exportSummary(): Promise<void> {
    setExporting(true);
    setNotice(null);
    try {
      const payload = {
        exportedAt: new Date().toISOString(),
        range: { start: period.start.toISOString(), end: period.end.toISOString() },
        device,
        summary: {
          computerSeconds: summary.computer,
          phoneSeconds: summary.phone,
          combinedSeconds: summary.combined,
          overlapSeconds: summary.overlap
        },
        days: visibleDays.map(day => ({ date: day.key, computerSeconds: day.computer, phoneSeconds: day.phone, combinedSeconds: day.combined })),
        ...(includeLabels ? { apps: buildApps(visibleEvents, false).map(app => ({ name: app.label, seconds: app.seconds, events: app.events })) } : {})
      };
      const saved = await window.usageAtlas.saveActivityWatchExport(JSON.stringify(payload, null, 2));
      if (saved) setNotice("Activity summary saved.");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "The activity summary could not be saved.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="activity-dashboard" aria-label="Device activity dashboard">


      <div className="activity-toolbar" aria-label="Activity controls">
        <div className="activity-period-controls">
          <button className="activity-icon-button" type="button" aria-label="Previous period" onClick={() => setPeriodOffset(value => value - 1)}>
            <ChevronLeftIcon />
          </button>
          <select aria-label="Date range" value={rangeDays} onChange={event => { setRangeDays(Number(event.target.value) as RangeDays); setPeriodOffset(0); }}>
            <option value={1}>{periodOffset === 0 ? "Today" : periodLabel}</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option><option value={365}>Last 12 months</option>
          </select>
          <button className="activity-icon-button" type="button" aria-label="Next period" disabled={periodOffset >= 0} onClick={() => setPeriodOffset(value => Math.min(0, value + 1))}>
            <ChevronRightIcon />
          </button>
        </div>
        <label className="activity-select-label">Device
          <select aria-label="Filter by device" value={device} onChange={event => setDevice(event.target.value as DeviceFilter)}>
            <option value="all">All devices</option><option value="computer">Computer</option><option value="phone">Phone</option>
          </select>
        </label>
        <label className="activity-switch"><input type="checkbox" checked={compare} onChange={event => setCompare(event.target.checked)} /><span>Compare</span></label>
        <div className="activity-toolbar__actions">
          <button className="activity-icon-button" type="button" aria-label="Refresh ActivityWatch" title="Refresh ActivityWatch" disabled={loading} onClick={() => void loadData()}>
            <RefreshIcon />
          </button>
          <button className="activity-button" type="button" disabled={!snapshot || exporting} onClick={() => void exportSummary()}>
            <ShareIcon />{exporting ? "Saving…" : "Export"}
          </button>
        </div>
      </div>

      {view !== "overview" && <header className="activity-dashboard__heading">
        <div><p className="activity-eyebrow">{view === "history" ? "Collected history" : "Local device history"}</p>
          <h1>{pageTitle[view]}</h1>
          <p className="activity-dashboard__subtitle">{view === "history" ? "How your computer and phone activity changes over time." : "Your ActivityWatch history, kept on this computer."}</p>
        </div>
        <div className={`activity-live-pill${error ? " is-offline" : ""}`}><span />{error ? "ActivityWatch unavailable" : snapshot ? "ActivityWatch connected" : "Reading activity…"}</div>
      </header>}

      {error && <div className="activity-error" role="alert"><strong>ActivityWatch data unavailable</strong><span>{error}</span><button type="button" onClick={() => void loadData()}>Retry</button></div>}
      {notice && <div className="activity-notice" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss notification" onClick={() => setNotice(null)}>×</button></div>}
      {loading && !snapshot && <div className="activity-loading" role="status"><span className="activity-spinner" />Reading local ActivityWatch history…</div>}
      {!loading && !snapshot && !error && <div className="activity-empty">No ActivityWatch records are available yet.</div>}

      {snapshot && view !== "sources" && view !== "settings" && (
        <>
          {view === "overview" && <OverviewView days={visibleDays} hours={hours} apps={apps} periodLabel={periodLabel} rangeDays={rangeDays} summary={summary} previous={compare ? previousSummary : null} peakDay={peakDay} />}
          {view === "history" && <HistoryView days={visibleDays} periodLabel={periodLabel} summary={summary} previous={compare ? previousSummary : null} />}
          {view === "breakdown" && <BreakdownView apps={apps} summary={summary} />}
          {view === "insights" && <InsightsView days={visibleDays} hours={hourProfile} apps={apps} summary={summary} />}
          <footer className="activity-dashboard__footer">
            <span>{visibleEvents.length.toLocaleString()} recorded events · {periodLabel}</span>
            <span>Active intervals describe tracked app use; they are not an attention or productivity score.</span>
          </footer>
        </>
      )}
      {view === "sources" && <SourcesView snapshot={snapshot} device={device} />}
      {view === "settings" && <ActivitySettingsView showTitles={showTitles} includeLabels={includeLabels} autoRefresh={autoRefresh}
        onShowTitles={value => updatePreference("usageatlas.activity.showTitles", value, setShowTitles)}
        onIncludeLabels={value => updatePreference("usageatlas.activity.includeLabels", value, setIncludeLabels)}
        onAutoRefresh={value => updatePreference("usageatlas.activity.autoRefresh", value, setAutoRefresh)} />}
    </section>
  );
}

interface Summary {
  computer: number;
  phone: number;
  combined: number;
  overlap: number;
}

type ActivityRow = { key: string; label: string; seconds: number };

function dailyRows(days: DayActivity[], key: "computer" | "phone" | "combined"): ActivityRow[] {
  return days.map(day => ({ key: day.key, label: day.label, seconds: day[key] }));
}

function OverviewView({ days, hours, apps, periodLabel, rangeDays, summary, previous, peakDay }: {
  days: DayActivity[]; hours: ActivityRow[]; apps: AppActivity[]; periodLabel: string;
  rangeDays: RangeDays; summary: Summary; previous: Summary | null; peakDay: DayActivity | null;
}): React.JSX.Element {
  return <>
    <div className="activity-hero-grid">
      <section className="activity-glass-card activity-hero">
        <p className="activity-eyebrow">{rangeDays === 1 && days[0] ? new Date(`${days[0].key}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }) : periodLabel}</p>
        <h1>Your device activity</h1>
        <div className="activity-hero-metric"><span>Combined active time</span><strong>{formatDuration(summary.combined)}</strong></div>
        <p className="activity-hero-context">{previous ? compareDelta(summary.combined, previous.combined) : "Overlapping device time counted once"}</p>
        <div className="activity-hero-devices"><DeviceIcon /><span>Computer</span><DeviceIcon phone /><span>Phone</span></div>
      </section>
      <DeviceMix summary={summary} />
    </div>
    <div className="activity-metric-grid">
      <MetricCard title="Computer activity" value={formatDuration(summary.computer)} note="Recorded foreground-app intervals" delta={previous ? compareDelta(summary.computer, previous.computer) : null} spark={days.map(day => day.computer)} tone="green" />
      <MetricCard title="Phone activity" value={formatDuration(summary.phone)} note="Recorded Android app intervals" delta={previous ? compareDelta(summary.phone, previous.phone) : null} spark={days.map(day => day.phone)} tone="purple" />
    </div>
    <div className="activity-metric-grid activity-metric-grid--compact">
      <MetricCard title="Daily average" value={formatDuration(days.length ? summary.combined / days.length : 0)} note="Across calendar days in range" />
      <MetricCard title="Peak day" value={peakDay && peakDay.combined > 0 ? formatDuration(peakDay.combined) : "0m"} note={peakDay && peakDay.combined > 0 ? peakDay.label : "No recorded activity"} />
      <MetricCard title="Recorded overlap" value={formatDuration(summary.overlap)} note="Time both devices were active" />
    </div>
    <SectionHeading eyebrow="Selected period" title={rangeDays === 1 ? "Usage through the day" : "Usage through the period"} detail={periodLabel} />
    <ChartPanel title={rangeDays === 1 ? "Hourly activity" : "Combined activity"} subtitle="Combined active time, with overlap counted once" rows={rangeDays === 1 ? hours : dailyRows(days, "combined")} tone="blue" kind={rangeDays === 1 ? "bar" : "area"} />
    <SectionHeading eyebrow="Applications" title="Where your time went" detail={periodLabel} />
    <AppList apps={apps.slice(0, 8)} title="Most used apps" subtitle="Ranked by recorded foreground-app duration" />
  </>;
}

function HistoryView({ days, periodLabel, summary, previous }: { days: DayActivity[]; periodLabel: string; summary: Summary; previous: Summary | null }): React.JSX.Element {
  const peak = days.reduce((value, day) => Math.max(value, day.combined), 0);
  return <>
    <div className="activity-metric-grid">
      <MetricCard title="Combined active time" value={formatDuration(summary.combined)} note="Overlap counted once" delta={previous ? compareDelta(summary.combined, previous.combined) : null} spark={days.map(day => day.combined)} tone="green" />
      <MetricCard title="Tracked device time" value={formatDuration(summary.computer + summary.phone)} note="Sum of computer and phone intervals" spark={days.map(day => day.computer + day.phone)} tone="blue" />
    </div>
    <div className="activity-metric-grid activity-metric-grid--compact">
      <MetricCard title="Daily average" value={formatDuration(summary.combined / Math.max(1, days.length))} note={`Across ${days.length} calendar days`} />
      <MetricCard title="Peak day" value={formatDuration(peak)} note={peak > 0 ? days.find(day => day.combined === peak)?.label ?? "" : "No recorded activity"} />
      <MetricCard title="Recorded overlap" value={formatDuration(summary.overlap)} note="Simultaneous computer and phone use" />
    </div>
    <SectionHeading eyebrow="Over time" title="Device activity" detail={periodLabel} />
    <div className="activity-chart-grid">
      <ChartPanel title="Computer activity" subtitle={periodLabel} rows={dailyRows(days, "computer")} tone="green" />
      <ChartPanel title="Phone activity" subtitle={periodLabel} rows={dailyRows(days, "phone")} tone="purple" />
    </div>
    <ChartPanel title="Combined active time" subtitle="Overlapping computer and phone use counts once" rows={dailyRows(days, "combined")} tone="blue" />
  </>;
}

function DeviceIcon({ phone = false }: { phone?: boolean }): React.JSX.Element {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{phone ? <><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M10 18h4M10 5h4" /></> : <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></>}</svg>;
}

function DeviceMix({ summary }: { summary: Summary }): React.JSX.Element {
  const total = summary.computer + summary.phone;
  const data = [{ name: "Computer", value: summary.computer }, { name: "Phone", value: summary.phone }];
  const config = { Computer: { color: "green" as const, label: "Computer" }, Phone: { color: "purple" as const, label: "Phone" } };
  return <section className="activity-glass-card activity-device-breakdown">
    <div className="activity-chart-panel__header"><div><h3>Device mix</h3><p>Share of tracked time across your devices</p></div></div>
    <div className="activity-device-mix">
      <div className={`activity-donut${total ? "" : " is-empty"}`} role="img" aria-label={total ? `Tracked time ${formatDuration(total)}. Computer ${Math.round(summary.computer / total * 100)}%, phone ${Math.round(summary.phone / total * 100)}%.` : "No device activity recorded"}>
        {total > 0 && <PieChart config={config} data={data.filter(row => row.value > 0)} dataKey="value" nameKey="name" innerRadius={0.68} margins={{ top: 8, right: 8, bottom: 8, left: 8 }} bloom="low" animate={false}>
          <Pie variant="gradient" /><Tooltip valueFormatter={formatDuration} variant="frosted-glass" />
        </PieChart>}
        <div className="activity-donut-center"><strong>{formatDuration(total)}</strong><span>tracked time</span></div>
      </div>
      <div className="activity-device-legend">{data.map(row => <div className="activity-device-row" key={row.name}>
        <span className={`activity-device-icon ${row.name === "Phone" ? "is-phone" : ""}`}><DeviceIcon phone={row.name === "Phone"} /></span>
        <div><strong>{row.name}</strong><small>{total ? `${Math.round(row.value / total * 100)}% of tracked time` : "No records in this range"}</small></div>
        <b>{formatDuration(row.value)}</b>
      </div>)}</div>
    </div>
    <div className="activity-mix-context"><span>Combined, overlap removed <b>{formatDuration(summary.combined)}</b></span><span>Recorded overlap <b>{formatDuration(summary.overlap)}</b></span></div>
  </section>;
}

function BreakdownView({ apps, summary }: { apps: AppActivity[]; summary: Summary }): React.JSX.Element {
  return <div className="activity-breakdown-grid"><DeviceMix summary={summary} /><AppList apps={apps} title="Applications" subtitle="Recorded foreground-app durations" /></div>;
}

function InsightsView({ days, hours, apps, summary }: { days: DayActivity[]; hours: Array<{ label: string; seconds: number }>; apps: AppActivity[]; summary: Summary }): React.JSX.Element {
  const peakDay = days.reduce<DayActivity | null>((peak, day) => day.combined > (peak?.combined ?? 0) ? day : peak, null);
  const peakHour = hours.reduce<{ label: string; seconds: number } | null>((peak, hour) => hour.seconds > (peak?.seconds ?? 0) ? hour : peak, null);
  const phoneShare = summary.computer + summary.phone ? Math.round(summary.phone / (summary.computer + summary.phone) * 100) : 0;
  return <>
    <div className="activity-insight-grid">
      <MetricCard title="Busiest day" value={peakDay ? formatDuration(peakDay.combined) : "No data"} note={peakDay?.label ?? "No recorded activity in this period"} spark={days.map(day => day.combined)} tone="green" />
      <MetricCard title="Busiest hour" value={peakHour?.label ?? "No data"} note={peakHour ? `${formatDuration(peakHour.seconds)} accumulated across this period` : "No recorded hourly activity"} />
      <MetricCard title="Phone share" value={`${phoneShare}%`} note="Share of summed device intervals" />
      <MetricCard title="Top app" value={apps[0]?.label ?? "No app records"} note={apps[0] ? `${formatDuration(apps[0].seconds)} of recorded event time` : "No recorded app names"} />
    </div>
    <SectionHeading eyebrow="Observed patterns" title="Your daily rhythm" detail="Local time" />
    <ChartPanel title="Activity by hour of day" subtitle="Combined time accumulated in each hour across the selected period" rows={hours.map((hour, index) => ({ ...hour, key: String(index) }))} tone="blue" kind="bar" />
    <p className="activity-explainer">These are summaries of ActivityWatch records. They do not indicate focus, attention, or productivity.</p>
  </>;
}

function SourcesView({ snapshot, device }: { snapshot: ActivityWatchSnapshot | null; device: DeviceFilter }): React.JSX.Element {
  const buckets = snapshot?.buckets.filter(bucket => device === "all" || bucket.device === device) ?? [];
  return <>
    <SectionHeading eyebrow="Local connections" title="Connected watchers" detail={`${buckets.length} sources in this view`} />
    <div className="activity-source-grid">{buckets.map(bucket => <article className="activity-glass-card activity-source-card" key={bucket.id}>
      <div className="activity-source-card__top"><span className={`activity-source-tag activity-source-tag--${bucket.device}`}><DeviceIcon phone={bucket.device === "phone"} />{bucket.device === "phone" ? "Phone watcher" : "Computer watcher"}</span><span className={`activity-source-state${bucket.error ? " is-warning" : bucket.eventCount ? "" : " is-idle"}`}><i />{bucket.error ? "Unavailable" : bucket.eventCount ? "Records available" : "No records in range"}</span></div>
      <h3>{bucket.hostname}</h3><dl><div><dt>Bucket</dt><dd title={bucket.id}>{bucket.id}</dd></div><div><dt>Watcher type</dt><dd>{bucket.type}</dd></div><div><dt>Events in selected range</dt><dd>{bucket.eventCount.toLocaleString()}</dd></div><div><dt>Last updated</dt><dd>{bucket.lastUpdated ? new Date(bucket.lastUpdated).toLocaleString() : "Not provided by ActivityWatch"}</dd></div></dl>
      {bucket.error && <p className="activity-source-error">{bucket.error}</p>}
    </article>)}</div>
    {snapshot && !buckets.length && <p className="activity-empty">No activity sources match the selected device.</p>}
    {!snapshot && <p className="activity-empty">Start ActivityWatch on this computer, then refresh to read its sources.</p>}
  </>;
}

function SectionHeading({ eyebrow, title, detail }: { eyebrow: string; title: string; detail?: string }): React.JSX.Element {
  return <div className="activity-section-heading"><div><p className="activity-eyebrow">{eyebrow}</p><h2>{title}</h2></div>{detail && <span>{detail}</span>}</div>;
}

function ActivitySettingsView({ showTitles, includeLabels, autoRefresh, onShowTitles, onIncludeLabels, onAutoRefresh }: {
  showTitles: boolean;
  includeLabels: boolean;
  autoRefresh: boolean;
  onShowTitles(value: boolean): void;
  onIncludeLabels(value: boolean): void;
  onAutoRefresh(value: boolean): void;
}): React.JSX.Element {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "System default";
  return <div className="activity-settings-grid">
    <section className="activity-glass-card activity-privacy-card"><p className="activity-eyebrow">PRIVACY</p><h2>Local activity controls</h2>
      <PreferenceToggle checked={showTitles} label="Show window titles" note="Window titles may reveal document or page names." onChange={onShowTitles} />
      <PreferenceToggle checked={includeLabels} label="Include app labels in exports" note="Off by default; exports contain totals and daily activity only." onChange={onIncludeLabels} />
      <PreferenceToggle checked={autoRefresh} label="Refresh every five minutes" note="Reads the local ActivityWatch API while this page is open." onChange={onAutoRefresh} />
      <p className="activity-privacy-note">ActivityWatch data stays in its local database. UsageAtlas does not upload device activity.</p>
    </section>
    <section className="activity-glass-card activity-privacy-card"><p className="activity-eyebrow">DISPLAY</p><h2>Reporting time zone</h2>
      <div className="activity-timezone-row"><span>System time zone</span><strong>{timeZone}</strong></div>
      <p className="activity-privacy-note">Day boundaries and chart labels use your computer’s current time zone.</p>
    </section>
  </div>;
}

function MetricCard({ title, value, note, delta, spark, tone = "green" }: { title: string; value: string; note: string; delta?: string | null; spark?: number[]; tone?: DitherColor }): React.JSX.Element {
  return <article className="activity-glass-card activity-metric-card"><div className="activity-metric-copy"><span>{title}</span><strong title={value}>{value}</strong><small>{delta && <em>{delta}</em>}{note}</small></div>
    {spark && spark.length > 1 && spark.some(value => value > 0) && <div className="activity-spark" aria-hidden="true"><Sparkline data={spark} color={tone} bloom="low" /></div>}
  </article>;
}

function ChartPanel({ title, subtitle, rows, tone, kind = "area" }: {
  title: string; subtitle: string; rows: ActivityRow[]; tone: DitherColor; kind?: "area" | "bar";
}): React.JSX.Element {
  const total = rows.reduce((sum, row) => sum + row.seconds, 0);
  const Chart = kind === "bar" || rows.length === 1 ? BarChart : AreaChart;
  const Series = kind === "bar" || rows.length === 1 ? Bar : Area;
  const config = { seconds: { color: tone, label: title } };
  return <section className="activity-glass-card activity-chart-panel">
    <div className="activity-chart-panel__header"><div><h3>{title}</h3><p>{subtitle}</p></div><strong>{formatDuration(total)}</strong></div>
    <div className="activity-chart-plot" role="group" aria-label={`${title}, ${formatDuration(total)} total`}>
      {total > 0 ? <Chart data={rows} config={config} bloom="low" animate={false} margins={{ top: 16, right: 24, bottom: 30, left: 44 }}>
        <Grid /><XAxis dataKey="label" maxTicks={8} minTickSpacing={70} /><YAxis tickFormatter={formatDuration} />
        <Series dataKey="seconds" variant="gradient" /><Tooltip labelKey="label" valueFormatter={formatDuration} variant="frosted-glass" />
      </Chart> : <div className="activity-chart-empty"><span>No recorded activity</span><small>No intervals for this device in the selected period.</small></div>}
    </div>
    {total > 0 && <details className="activity-chart-values"><summary>View chart values</summary><div><table><thead><tr><th>Period</th><th>Active time</th></tr></thead><tbody>{rows.map(row => <tr key={row.key}><td>{row.label}</td><td>{formatDuration(row.seconds)}</td></tr>)}</tbody></table></div></details>}
  </section>;
}

function AppList({ apps, title, subtitle }: { apps: AppActivity[]; title: string; subtitle: string }): React.JSX.Element {
  const maximum = Math.max(1, ...apps.map(app => app.seconds));
  return <section className="activity-glass-card activity-app-list"><div className="activity-chart-panel__header"><div><h3>{title}</h3><p>{subtitle}</p></div></div>
    {apps.length ? <ol>{apps.map((app, index) => <li key={app.label}><span className="activity-app-rank">{String(index + 1).padStart(2, "0")}</span><div className="activity-app-detail"><div className="activity-app-row"><span title={app.label}>{app.label}</span><b>{formatDuration(app.seconds)}</b></div><div className="activity-app-track"><i style={{ width: `${app.seconds / maximum * 100}%` }} /></div><small>{app.events.toLocaleString()} recorded events</small></div></li>)}</ol> : <p className="activity-empty">No app-level events in this range.</p>}
  </section>;
}

function PreferenceToggle({ checked, label, note, onChange }: { checked: boolean; label: string; note: string; onChange(value: boolean): void }): React.JSX.Element {
  return <label className="activity-preference"><span><strong>{label}</strong><small>{note}</small></span><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /></label>;
}

function labelPeriod(period: Period, days: RangeDays): string {
  if (days === 1 && period.end.getTime() > Date.now()) return "Today";
  const last = new Date(period.end);
  last.setDate(last.getDate() - 1);
  return `${period.start.toLocaleDateString([], { month: "short", day: "numeric" })} – ${last.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

function filterEvents(events: ActivityWatchRecord[], device: DeviceFilter): ActivityWatchRecord[] {
  return device === "all" ? events : events.filter(event => event.device === device);
}

function recordIntervals(events: ActivityWatchRecord[], device?: ActivityDevice): Interval[] {
  return events.filter(event => !device || event.device === device).map(event => {
    const start = Date.parse(event.timestamp);
    return { start, end: start + event.duration * 1000 };
  }).filter(interval => Number.isFinite(interval.start) && interval.end > interval.start);
}

function mergeIntervals(items: Interval[]): Interval[] {
  const sorted = [...items].sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

function intervalSeconds(items: Interval[]): number {
  return items.reduce((sum, item) => sum + Math.max(0, item.end - item.start), 0) / 1000;
}

function summarize(events: ActivityWatchRecord[], device: DeviceFilter): Summary {
  const computerIntervals = mergeIntervals(recordIntervals(events, "computer"));
  const phoneIntervals = mergeIntervals(recordIntervals(events, "phone"));
  const combinedIntervals = mergeIntervals([...computerIntervals, ...phoneIntervals]);
  const computer = device === "phone" ? 0 : intervalSeconds(computerIntervals);
  const phone = device === "computer" ? 0 : intervalSeconds(phoneIntervals);
  const combined = device === "computer" ? computer : device === "phone" ? phone : intervalSeconds(combinedIntervals);
  return { computer, phone, combined, overlap: Math.max(0, computer + phone - combined) };
}

function buildDays(events: ActivityWatchRecord[], period: Period, days: RangeDays): DayActivity[] {
  const ranges = Array.from({ length: days }, (_, index) => {
    const start = new Date(period.start);
    start.setDate(start.getDate() + index);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end, key: localDateKey(start), label: start.toLocaleDateString([], { month: "short", day: "numeric" }) };
  });
  const computerByDay = ranges.map(() => [] as Interval[]);
  const phoneByDay = ranges.map(() => [] as Interval[]);
  distributeIntervals(recordIntervals(events, "computer"), ranges, computerByDay);
  distributeIntervals(recordIntervals(events, "phone"), ranges, phoneByDay);
  const result: DayActivity[] = [];
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index];
    const computer = computerByDay[index];
    const phone = phoneByDay[index];
    const combined = [...computer, ...phone];
    result.push({
      key: range.key,
      label: range.label,
      computer: intervalSeconds(mergeIntervals(computer)),
      phone: intervalSeconds(mergeIntervals(phone)),
      combined: intervalSeconds(mergeIntervals(combined))
    });
  }
  return result;
}

function distributeIntervals(intervals: Interval[], ranges: Array<{ start: Date; end: Date }>, output: Interval[][]): void {
  for (const interval of intervals) {
    let low = 0;
    let high = ranges.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = ranges[middle];
      if (!candidate || candidate.end.getTime() <= interval.start) low = middle + 1;
      else high = middle;
    }
    for (let index = low; index < ranges.length; index += 1) {
      const range = ranges[index];
      const dayOutput = output[index];
      if (!range || !dayOutput || range.start.getTime() >= interval.end) break;
      const clipped = { start: Math.max(interval.start, range.start.getTime()), end: Math.min(interval.end, range.end.getTime()) };
      if (clipped.end > clipped.start) dayOutput.push(clipped);
    }
  }
}

function buildHours(events: ActivityWatchRecord[], dayStart: Date, device: DeviceFilter): Array<{ key: string; label: string; seconds: number }> {
  const intervals = recordIntervals(filterEvents(events, device));
  return Array.from({ length: 24 }, (_, hour) => {
    const start = new Date(dayStart);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(dayStart);
    end.setHours(hour + 1, 0, 0, 0);
    return {
      key: `${localDateKey(dayStart)}-${hour}`,
      label: start.toLocaleTimeString([], { hour: "numeric" }),
      seconds: intervalSeconds(mergeIntervals(clipIntervals(intervals, start.getTime(), end.getTime())))
    };
  });
}

function buildHourProfile(events: ActivityWatchRecord[], device: DeviceFilter): Array<{ label: string; seconds: number }> {
  const totals = Array.from({ length: 24 }, (_, hour) => ({
    label: new Date(2024, 0, 1, hour).toLocaleTimeString([], { hour: "numeric" }),
    seconds: 0
  }));
  const intervals = mergeIntervals(recordIntervals(filterEvents(events, device)));
  for (const interval of intervals) {
    let cursor = interval.start;
    while (cursor < interval.end) {
      const date = new Date(cursor);
      const nextHour = new Date(date);
      nextHour.setHours(date.getHours() + 1, 0, 0, 0);
      const end = Math.min(interval.end, nextHour.getTime());
      const hour = totals[date.getHours()];
      if (hour) hour.seconds += (end - cursor) / 1000;
      cursor = end;
    }
  }
  return totals;
}

function clipIntervals(intervals: Interval[], start: number, end: number): Interval[] {
  return intervals.flatMap(interval => {
    const clipped = { start: Math.max(interval.start, start), end: Math.min(interval.end, end) };
    return clipped.end > clipped.start ? [clipped] : [];
  });
}

function buildApps(events: ActivityWatchRecord[], showTitles: boolean): AppActivity[] {
  const groups = new Map<string, AppActivity>();
  for (const event of events) {
    const app = event.app || "Unlabelled application";
    const label = showTitles && event.title ? `${app} · ${event.title}` : app;
    const existing = groups.get(label) ?? { label, seconds: 0, events: 0 };
    existing.seconds += event.duration;
    existing.events += 1;
    groups.set(label, existing);
  }
  return [...groups.values()].sort((left, right) => right.seconds - left.seconds);
}

function compareDelta(current: number, previous: number): string {
  if (previous <= 0) return current > 0 ? "New activity" : "No prior activity";
  const percent = Math.round((current - previous) / previous * 100);
  return `${percent > 0 ? "+" : ""}${percent}% vs prior`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function readPreference(key: string): boolean {
  try { return window.localStorage.getItem(key) === "1"; } catch { return false; }
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
