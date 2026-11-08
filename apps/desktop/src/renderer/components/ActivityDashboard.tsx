import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ActivityDevice, ActivityWatchRecord, ActivityWatchSnapshot } from "../../shared/desktop-api";

import { ChevronLeftIcon, ChevronRightIcon, RefreshIcon, ShareIcon } from "../icons";

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

function OverviewView(_props: {
  days: DayActivity[]; hours: ActivityRow[]; apps: AppActivity[]; periodLabel: string;
  rangeDays: RangeDays; summary: Summary; previous: Summary | null; peakDay: DayActivity | null;
}): React.JSX.Element { return <></>; }

function HistoryView(_props: { days: DayActivity[]; periodLabel: string; summary: Summary; previous: Summary | null }): React.JSX.Element { return <></>; }

function BreakdownView(_props: { apps: AppActivity[]; summary: Summary }): React.JSX.Element { return <></>; }

function InsightsView(_props: { days: DayActivity[]; hours: Array<{ label: string; seconds: number }>; apps: AppActivity[]; summary: Summary }): React.JSX.Element { return <></>; }

function SourcesView(_props: { snapshot: ActivityWatchSnapshot | null; device: DeviceFilter }): React.JSX.Element { return <></>; }

function ActivitySettingsView(_props: {
  showTitles: boolean;
  includeLabels: boolean;
  autoRefresh: boolean;
  onShowTitles(value: boolean): void;
  onIncludeLabels(value: boolean): void;
  onAutoRefresh(value: boolean): void;
}): React.JSX.Element { return <></>; }

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

function readPreference(key: string): boolean {
  try { return window.localStorage.getItem(key) === "1"; } catch { return false; }
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
