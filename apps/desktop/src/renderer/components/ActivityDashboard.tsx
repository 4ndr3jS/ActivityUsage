import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Popover } from "@heroui/react";
import type { ActivityDevice, ActivityWatchBucket, ActivityWatchCategory, ActivityWatchRange, ActivityWatchRecord, ActivityWatchSnapshot } from "../../shared/desktop-api";
import { ChevronDownIcon, RefreshIcon, ShareIcon } from "../icons";
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
import { subscribeActivityRefresh } from "../activity-refresh";
import { activitySnapshotKey, coveringActivitySnapshot, createActivitySnapshotCache } from "../activity-snapshots";
import { appLabel } from "../app-label";
import { buildActivityStatistics } from "../activity-statistics";
import { formatPeriodLabel, shiftDay, todayDay, type AnalyticsRange } from "../personal-analytics";
import { TimeNavigator } from "./AnalyzerControls";
import { ActivityStatistics } from "./ActivityStatistics";
import "./activity-dashboard.css";

type ActivityRange = 1 | AnalyticsRange;
export type ActivityView = "overview" | "history" | "statistics" | "insights" | "sources" | "settings";
type DeviceFilter = "all" | ActivityDevice;
const EMPTY_EVENTS: ActivityWatchRecord[] = [];
const DEFAULT_HISTORY_DAYS = 30;
const WINDOW_TITLES_KEY = "activityusage.activity.showTitles";

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
  const isOverview = view === "overview";
  const android = window.ActivityUsageAndroid;
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [range, setRange] = useState<ActivityRange>(isOverview ? 1 : DEFAULT_HISTORY_DAYS);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [wasOverview, setWasOverview] = useState(isOverview);
  const requestVersion = useRef(0);
  const [periodOffset, setPeriodOffset] = useState(0);
  const [timelineRange, setTimelineRange] = useState<{
    range: AnalyticsRange; offset: number; key: string; snapshot: ActivityWatchSnapshot;
  } | null>(null);
  const [device, setDevice] = useState<DeviceFilter>("all");
  const [compare, setCompare] = useState(false);
  const [showTitles, setShowTitles] = useState(() => readPreference(WINDOW_TITLES_KEY));
  const [includeLabels, setIncludeLabels] = useState(() => readPreference("activityusage.activity.includeLabels"));
  const [autoRefresh, setAutoRefresh] = useState(() => readPreference("activityusage.activity.autoRefresh", true));
  const [calendarDay, setCalendarDay] = useState(todayDay);
  const autoRequestRunning = useRef(false);
  const [snapshots, setSnapshots] = useState<ReadonlyMap<string, ActivityWatchSnapshot>>(() => new Map());
  const [categoryRules, setCategoryRules] = useState<ActivityWatchCategory[]>([]);
  const [rulesStatus, setRulesStatus] = useState<"loading" | "ready" | "error">("loading");
  const [readSnapshot] = useState(() => createActivitySnapshotCache(
    range => window.usageAtlas.getActivityWatchData(range), setSnapshots
  ));
  const [requestState, setRequestState] = useState<{ key: string; loading: boolean; error: string | null } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Apply the default range before committing a view switch so it reads the
  // right cached snapshot on its first render.
  if (wasOverview !== isOverview) {
    setWasOverview(isOverview);
    setRange(isOverview ? 1 : DEFAULT_HISTORY_DAYS);
    setPickedDay(null);
    setPeriodOffset(0);
    setTimelineRange(null);
  }

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const selectedDay = pickedDay ?? calendarDay;
  const comparePeriod = compare && range !== "all" && view !== "statistics";
  const requestedPeriod = useMemo(() => {
    const anchor = range === 1 ? selectedDay : calendarDay;
    return createActivityPeriod(range === "all" ? 1 : range, periodOffset, new Date(`${anchor}T12:00:00`));
  }, [calendarDay, periodOffset, range, selectedDay]);
  const currentQuery = useMemo<ActivityWatchRange>(() => ({
    start: range === "all" ? null : requestedPeriod.start.toISOString(),
    end: requestedPeriod.end.toISOString(),
    includeBrowserTabs: view === "statistics"
  }), [range, requestedPeriod, view]);
  const previousQuery = useMemo<ActivityWatchRange | null>(() => {
    if (!comparePeriod) return null;
    const start = new Date(requestedPeriod.start);
    start.setDate(start.getDate() - range);
    return { start: start.toISOString(), end: requestedPeriod.start.toISOString() };
  }, [comparePeriod, range, requestedPeriod]);
  const currentKey = activitySnapshotKey(currentQuery);
  const previousKey = previousQuery ? activitySnapshotKey(previousQuery) : null;
  const requestKey = JSON.stringify([currentKey, previousKey]);
  const snapshot = useMemo(() => {
    const key = activitySnapshotKey(currentQuery);
    return snapshots.get(key) ?? (view === "statistics" && timelineRange?.key === key ? timelineRange.snapshot : null)
      ?? (view === "statistics" && range === 1 ? coveringActivitySnapshot(snapshots, currentQuery) : null);
  }, [snapshots, currentQuery, view, range, timelineRange]);
  const previousSnapshot = previousKey ? snapshots.get(previousKey) : undefined;
  const syncLabel = snapshot?.source === "desktop-mirror"
    ? `Desktop and phone synced · ${new Date(snapshot.fetchedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
    : android?.hasSyncFolder() && snapshot ? "Waiting for desktop sync · showing phone activity" : null;
  const activeRequest = requestState?.key === requestKey ? requestState : null;
  const error = activeRequest?.error ?? null;
  const loading = activeRequest?.loading ?? !snapshot;
  const historyPeriod = useMemo(() => createActivityPeriod(DEFAULT_HISTORY_DAYS, 0, new Date(`${calendarDay}T12:00:00`)), [calendarDay]);
  const historyQuery = useMemo(() => ({ start: historyPeriod.start.toISOString(), end: historyPeriod.end.toISOString() }), [historyPeriod]);
  const historyKey = activitySnapshotKey(historyQuery);
  const historySnapshot = snapshots.get(historyKey);

  const loadData = useCallback(async (refresh = false): Promise<void> => {
    const request = ++requestVersion.current;
    setRequestState({ key: requestKey, loading: true, error: null });
    try {
      await Promise.all([
        readSnapshot(currentQuery, refresh),
        previousQuery ? readSnapshot(previousQuery, refresh) : null
      ]);
      if (request === requestVersion.current) setRequestState({ key: requestKey, loading: false, error: null });
    } catch (caught: unknown) {
      if (request === requestVersion.current) setRequestState({
        key: requestKey, loading: false,
        error: caught instanceof Error ? caught.message : "ActivityWatch could not be reached."
      });
    }
  }, [readSnapshot, currentQuery, previousQuery, requestKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadData(); }, 0);
    return () => { window.clearTimeout(timer); requestVersion.current += 1; };
  }, [loadData]);
  useEffect(() => {
    // History, Statistics, and Sources start with the same history snapshot.
    void readSnapshot(historyQuery).catch(() => {});
  }, [historyQuery, readSnapshot]);
  const statisticsSnapshot = isOverview ? historySnapshot : snapshot ?? historySnapshot;
  const categoryRevision = statisticsSnapshot?.fetchedAt;
  useEffect(() => {
    if (!categoryRevision) return;
    let active = true;
    void window.usageAtlas.getActivityWatchCategories().then(
      categories => {
        if (!active) return;
        setCategoryRules(previous => JSON.stringify(previous) === JSON.stringify(categories) ? previous : categories);
        setRulesStatus("ready");
      },
      () => {
        if (active) setRulesStatus("error");
      }
    );
    return () => { active = false; };
  }, [categoryRevision]);
  useEffect(() => {
    if (!autoRefresh) return undefined;
    return subscribeActivityRefresh(() => {
      const today = todayDay();
      if (today !== calendarDay) { setCalendarDay(today); return; }
      if (autoRequestRunning.current) return;
      autoRequestRunning.current = true;
      void loadData(true).finally(() => { autoRequestRunning.current = false; });
    });
  }, [autoRefresh, calendarDay, loadData]);

  const events = snapshot?.events ?? EMPTY_EVENTS;
  const firstEvent = events[0]?.timestamp;
  const period = useMemo(() => {
    if (range !== "all" || !firstEvent) return requestedPeriod;
    const start = new Date(firstEvent);
    start.setHours(0, 0, 0, 0);
    return { start, end: requestedPeriod.end };
  }, [firstEvent, range, requestedPeriod]);
  const visibleEvents = useMemo(() => filterEvents(events, device), [device, events]);
  const summary = useMemo(() => summarize(events, device), [device, events]);
  const previousSummary = useMemo(
    () => previousSnapshot ? summarize(previousSnapshot.events, device) : null,
    [device, previousSnapshot]
  );
  const days = useMemo(() => buildDays(events, period), [events, period]);
  const visibleDays = useMemo(() => days.map(day => {
    if (device === "computer") return { ...day, phone: 0, combined: day.computer };
    if (device === "phone") return { ...day, computer: 0, combined: day.phone };
    return day;
  }), [days, device]);
  const needsHours = view === "overview" && range === 1;
  const needsHourProfile = view === "insights";
  const needsApps = view === "overview" || view === "insights";
  const includeAppTitles = view === "overview" && showTitles;
  const hours = useMemo(() => needsHours ? buildHours(events, period.start, device) : [], [device, events, period.start, needsHours]);
  const hourProfile = useMemo(() => needsHourProfile ? buildHourProfile(events, device) : [], [device, events, needsHourProfile]);
  const apps = useMemo(() => needsApps ? buildApps(visibleEvents, includeAppTitles) : [], [includeAppTitles, visibleEvents, needsApps]);
  const useHistoryForStatistics = isOverview || !snapshot || currentKey === historyKey;
  const statisticsPeriod = useHistoryForStatistics ? historyPeriod : period;
  const statisticsHourly = !useHistoryForStatistics && range === 1;
  const rulesLoaded = rulesStatus !== "loading";
  const statistics = useMemo(() => {
    if (!statisticsSnapshot || !rulesLoaded) return null;
    return buildActivityStatistics(filterEvents(statisticsSnapshot.events, device), categoryRules,
      statisticsPeriod, statisticsHourly, showTitles, statisticsSnapshot);
  }, [categoryRules, device, rulesLoaded, showTitles, statisticsHourly, statisticsPeriod, statisticsSnapshot]);
  const peakDay = visibleDays.reduce<DayActivity | null>((peak, day) => !peak || day.combined > peak.combined ? day : peak, null);
  const periodLabel = labelPeriod(period, range, calendarDay);
  const navigatorLabel = range === 1 || periodOffset < 0 ? periodLabel : formatPeriodLabel(range);
  const pageTitle: Record<ActivityView, string> = {
    overview: "Your device activity",
    history: "Activity history",
    statistics: "Activity statistics",
    insights: "Your activity rhythm",
    sources: "ActivityWatch sources",
    settings: "Activity preferences"
  };

  function updatePreference(key: string, next: boolean, setter: (value: boolean) => void): void {
    setter(next);
    try { window.localStorage.setItem(key, next ? "1" : "0"); } catch { /* Keep the current session usable if storage is disabled. */ }
  }

  function selectDay(day: string): void {
    setRange(1);
    setPickedDay(day === calendarDay ? null : day);
    setPeriodOffset(0);
  }

  function selectRange(nextRange: AnalyticsRange): void {
    setRange(nextRange);
    setPickedDay(null);
    setPeriodOffset(0);
    setTimelineRange(null);
  }

  function openTimelineDay(day: string): void {
    if (range === 1 || !snapshot) return;
    setTimelineRange({ range, offset: periodOffset, key: currentKey, snapshot });
    selectDay(day);
  }

  function returnToTimelineRange(): void {
    if (!timelineRange) return;
    setRange(timelineRange.range);
    setPickedDay(null);
    setPeriodOffset(timelineRange.offset);
  }

  function movePeriod(offset: -1 | 1): void {
    if (range === 1) selectDay(shiftDay(selectedDay, offset));
    else setPeriodOffset(value => Math.min(0, value + offset));
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
      setNotice(caught instanceof Error ? caught.message : "The activity summary could not be saved.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="activity-dashboard" data-view={view} aria-label="Device activity dashboard">


      {(!android || view !== "settings") && <div className="activity-toolbar" aria-label="Activity controls">
        <div className="activity-period-controls">
          <TimeNavigator
            canMoveBack={range !== "all"}
            canMoveForward={range === 1 ? selectedDay < calendarDay : periodOffset < 0}
            label={navigatorLabel}
            mode={range === 1 ? "day" : "range"}
            onMoveBack={() => movePeriod(-1)}
            onMoveForward={() => movePeriod(1)}
            onSelectDay={selectDay}
            onSelectRange={selectRange}
            selectedDay={selectedDay}
            selectedRange={range === 1 ? undefined : range}
            today={calendarDay}
          />
        </div>
        <label className="activity-select-label">Device
          <select aria-label="Filter by device" value={device} onChange={event => setDevice(event.target.value as DeviceFilter)}>
            <option value="all">All devices</option><option value="computer">Computer</option><option value="phone">Phone</option>
          </select>
        </label>
        {!android && view !== "statistics" && <label className="activity-switch"><input type="checkbox" checked={comparePeriod} disabled={range === "all"} onChange={event => setCompare(event.target.checked)} /><span>Compare</span></label>}
        {android ? <Popover isOpen={optionsOpen} onOpenChange={setOptionsOpen}>
          <Button className="android-options-trigger" variant="secondary" aria-label="Activity options">Options<ChevronDownIcon /></Button>
          <Popover.Content className="android-options-popover" placement="bottom end" offset={8}>
            <Popover.Dialog className="android-options-menu">
              <Popover.Heading>Activity options</Popover.Heading>
              {view !== "statistics" && view !== "sources" && <label className="activity-switch">
                <span>Compare previous period</span><input type="checkbox" checked={comparePeriod} disabled={range === "all"} onChange={event => setCompare(event.target.checked)} />
              </label>}
              <Button variant="ghost" isDisabled={loading} onPress={() => { setOptionsOpen(false); void loadData(true); }}><RefreshIcon />Refresh activity</Button>
              <Button variant="ghost" isDisabled={!snapshot || exporting} onPress={() => { setOptionsOpen(false); void exportSummary(); }}><ShareIcon />{exporting ? "Saving…" : "Export summary"}</Button>
            </Popover.Dialog>
          </Popover.Content>
        </Popover> : <div className="activity-toolbar__actions">
          <button className="activity-icon-button" type="button" aria-label="Refresh ActivityWatch" title="Refresh ActivityWatch" disabled={loading} onClick={() => void loadData(true)}>
            <RefreshIcon />
          </button>
          <button className="activity-button activity-toolbar-export" type="button" aria-label={exporting ? "Saving activity summary" : "Export"}
            disabled={!snapshot || exporting} onClick={() => void exportSummary()}>
            <ShareIcon /><span>{exporting ? "Saving…" : "Export"}</span>
          </button>
        </div>}
      </div>}

      {view !== "overview" && <header className="activity-dashboard__heading">
        <div>{!android && view !== "statistics" && <p className="activity-eyebrow">{view === "history" ? "Collected history" : "Local device history"}</p>}
          <h1>{pageTitle[view]}</h1>
          <p className="activity-dashboard__subtitle">{android ? (view === "settings" ? "Make Activity Usage yours." : view === "sources" ? "Your connected activity records." : periodLabel) : view === "history" ? "How your computer and phone activity changes over time."
            : view === "statistics" ? periodLabel : "Your ActivityWatch history, kept on this computer."}</p>
        </div>
        <div className={`activity-live-pill${error ? " is-offline" : ""}`}><span />{syncLabel ?? (error ? "ActivityWatch unavailable" : snapshot ? "ActivityWatch connected" : "Reading activity…")}</div>
      </header>}
      {view === "overview" && syncLabel && <div className="activity-live-pill"><span />{syncLabel}</div>}

      {error && <div className="activity-error" role="alert"><strong>ActivityWatch data unavailable</strong><span>{error}</span><button type="button" onClick={() => void loadData(true)}>Retry</button>
        {android && <button type="button" onClick={() => android.connectActivityWatch()}>Connect</button>}
      </div>}
      {notice && <div className="activity-notice" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss notification" onClick={() => setNotice(null)}>×</button></div>}
      {view !== "history" && loading && !snapshot && <div className="activity-loading" role="status"><span className="activity-spinner" />Reading local ActivityWatch history…</div>}
      {!loading && !snapshot && !error && <div className="activity-empty">No ActivityWatch records are available yet.</div>}

      {snapshot && view !== "sources" && view !== "settings" && (
        <>
          {view === "overview" && <OverviewView days={visibleDays} hours={hours} apps={apps} periodLabel={periodLabel} singleDay={range === 1} summary={summary} previous={comparePeriod ? previousSummary : null} peakDay={peakDay} />}
          {view === "history" && <HistoryView days={visibleDays} periodLabel={periodLabel} summary={summary} previous={comparePeriod ? previousSummary : null} />}
          {view === "statistics" && <ActivityStatistics stats={statistics} hourly={statisticsHourly}
            allDevices={device === "all"} rulesFailed={rulesStatus === "error"} showTitles={showTitles}
            onSelectDay={openTimelineDay} onReturnToRange={range === 1 && timelineRange ? returnToTimelineRange : undefined}
            onToggleTitles={() => updatePreference(WINDOW_TITLES_KEY, !showTitles, setShowTitles)} />}
          {view === "insights" && <InsightsView days={visibleDays} hours={hourProfile} apps={apps} summary={summary} />}
          <footer className="activity-dashboard__footer">
            <span>{visibleEvents.length.toLocaleString()} recorded events · {periodLabel}</span>
            <span>Active intervals describe tracked app use; they are not an attention or productivity score.</span>
          </footer>
        </>
      )}
      {view === "sources" && <SourcesView snapshot={snapshot} device={device} />}
      {view === "settings" && <ActivitySettingsView showTitles={showTitles} includeLabels={includeLabels} autoRefresh={autoRefresh}
        onShowTitles={value => updatePreference(WINDOW_TITLES_KEY, value, setShowTitles)}
        onIncludeLabels={value => updatePreference("activityusage.activity.includeLabels", value, setIncludeLabels)}
        onAutoRefresh={value => updatePreference("activityusage.activity.autoRefresh", value, setAutoRefresh)} />}
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

function OverviewView({ days, hours, apps, periodLabel, singleDay, summary, previous, peakDay }: {
  days: DayActivity[]; hours: ActivityRow[]; apps: AppActivity[]; periodLabel: string;
  singleDay: boolean; summary: Summary; previous: Summary | null; peakDay: DayActivity | null;
}): React.JSX.Element {
  return <>
    <div className="activity-hero-grid">
      <section className="activity-glass-card activity-hero">
        <p className="activity-eyebrow">{singleDay && days[0] ? new Date(`${days[0].key}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }) : periodLabel}</p>
        <h1>Your device activity</h1>
        <div className="activity-hero-metric"><span>Combined active time</span><strong>{formatDuration(summary.combined)}</strong></div>
        <p className="activity-hero-context">{previous ? compareDelta(summary.combined, previous.combined) : "Overlapping device time counted once"}</p>
        <div className="activity-hero-devices"><DeviceIcon /><span>Computer</span><DeviceIcon phone /><span>Phone</span></div>
      </section>
      <DeviceMix summary={summary} />
    </div>
    <div className="activity-metric-grid">
      <MetricCard title="Computer activity" value={formatDuration(summary.computer)} note="Time recorded from desktop apps" delta={previous ? compareDelta(summary.computer, previous.computer) : null} spark={days.map(day => day.computer)} tone="green" />
      <MetricCard title="Phone activity" value={formatDuration(summary.phone)} note="Time recorded from phone apps" delta={previous ? compareDelta(summary.phone, previous.phone) : null} spark={days.map(day => day.phone)} tone="purple" />
    </div>
    <div className="activity-metric-grid activity-metric-grid--compact">
      <MetricCard title="Daily average" value={formatDuration(days.length ? summary.combined / days.length : 0)} note="Across calendar days in range" />
      <MetricCard title="Peak day" value={peakDay && peakDay.combined > 0 ? formatDuration(peakDay.combined) : "0m"} note={peakDay && peakDay.combined > 0 ? peakDay.label : "No recorded activity"} />
      <MetricCard title="Recorded overlap" value={formatDuration(summary.overlap)} note="Time both devices were active" />
    </div>
    <SectionHeading eyebrow="Selected period" title={singleDay ? "Usage through the day" : "Usage through the period"} detail={periodLabel} />
    <ChartPanel title={singleDay ? "Hourly activity" : "Combined activity"} subtitle="Combined active time, with overlap counted once" rows={singleDay ? hours : dailyRows(days, "combined")} tone="blue" kind={singleDay ? "bar" : "area"} />
    <SectionHeading eyebrow="Applications" title="Where your time went" detail={periodLabel} />
    <AppList apps={apps.slice(0, 8)} title="Most used apps" subtitle="Ranked by recorded app time" />
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
        {total > 0 && <PieChart config={config} data={data.filter(row => row.value > 0)} dataKey="value" nameKey="name" innerRadius={0.68} margins={{ top: 8, right: 8, bottom: 8, left: 8 }} bloom="low" animate={false} expandOnHover={false}>
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

type SourceGroup = {
  device: ActivityDevice;
  buckets: ActivityWatchBucket[];
  hostnames: string[];
  eventCount: number;
  lastUpdated: string | null;
  errors: string[];
};

/** One card per device: every bucket a device reports collapses into it. */
function groupSources(buckets: ActivityWatchBucket[]): SourceGroup[] {
  return (["computer", "phone"] as const).flatMap(device => {
    const matched = buckets.filter(bucket => bucket.device === device);
    if (!matched.length) return [];
    const times = matched.map(bucket => (bucket.lastUpdated ? Date.parse(bucket.lastUpdated) : NaN)).filter(time => Number.isFinite(time));
    return [{
      device,
      buckets: matched,
      hostnames: [...new Set(matched.map(bucket => bucket.hostname))],
      eventCount: matched.reduce((sum, bucket) => sum + bucket.eventCount, 0),
      lastUpdated: times.length ? new Date(Math.max(...times)).toISOString() : null,
      errors: [...new Set(matched.map(bucket => bucket.error).filter((error): error is string => Boolean(error)))],
    }];
  });
}

function SourceRow({ label, values }: { label: string; values: string[] }): React.JSX.Element {
  return <div><dt>{label}</dt><dd>{values.map(value => <span key={value}>{value}</span>)}</dd></div>;
}

function SourcesView({ snapshot, device }: { snapshot: ActivityWatchSnapshot | null; device: DeviceFilter }): React.JSX.Element {
  const buckets = snapshot?.buckets.filter(bucket => device === "all" || bucket.device === device) ?? [];
  const groups = groupSources(buckets);
  return <>
    <SectionHeading eyebrow="Local connections" title="Connected watchers" detail={`${groups.length} ${groups.length === 1 ? "device" : "devices"} reporting`} />
    <div className="activity-source-grid">{groups.map(group => {
      const warning = group.errors.length > 0;
      const state = warning && !group.eventCount ? "Unavailable" : group.eventCount ? "Records available" : "No records in range";
      return <article className="activity-glass-card activity-source-card" key={group.device}>
        <div className="activity-source-card__top"><span className={`activity-source-tag activity-source-tag--${group.device}`}><DeviceIcon phone={group.device === "phone"} />{group.device === "phone" ? "Phone watcher" : "Computer watcher"}</span><span className={`activity-source-state${warning ? " is-warning" : group.eventCount ? "" : " is-idle"}`}><i />{state}</span></div>
        <h3>{group.hostnames.join(" · ")}</h3>
        <dl>
          <SourceRow label={group.buckets.length === 1 ? "Bucket" : "Buckets"} values={group.buckets.map(bucket => bucket.id)} />
          <SourceRow label={group.buckets.length === 1 ? "Watcher type" : "Watcher types"} values={[...new Set(group.buckets.map(bucket => bucket.type))]} />
          <div><dt>Events in selected range</dt><dd>{group.eventCount.toLocaleString()}</dd></div>
          <div><dt>Last updated</dt><dd>{group.lastUpdated ? new Date(group.lastUpdated).toLocaleString() : "Not provided by ActivityWatch"}</dd></div>
        </dl>
        {group.errors.map(error => <p className="activity-source-error" key={error}>{error}</p>)}
      </article>;
    })}</div>
    {snapshot && !groups.length && <p className="activity-empty">No activity sources match the selected device.</p>}
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
  const android = window.ActivityUsageAndroid;
  return <div className="activity-settings-grid">
    <section className="activity-glass-card activity-privacy-card"><p className="activity-eyebrow">PRIVACY</p><h2>Local activity controls</h2>
      <PreferenceToggle checked={showTitles} label="Show window titles" note="Window titles may reveal document or page names." onChange={onShowTitles} />
      <PreferenceToggle checked={includeLabels} label="Include app labels in exports" note="Off by default; exports contain totals and daily activity only." onChange={onIncludeLabels} />
      <PreferenceToggle checked={autoRefresh} label="Refresh automatically" note="Updates every minute and when you return to the app. Days start at midnight." onChange={onAutoRefresh} />
      <p className="activity-privacy-note">ActivityWatch data stays in its local database. Activity Usage does not upload device activity.</p>
    </section>
    <section className="activity-glass-card activity-privacy-card"><p className="activity-eyebrow">DISPLAY</p><h2>Reporting time zone</h2>
      <div className="activity-timezone-row"><span>System time zone</span><strong>{timeZone}</strong></div>
      <p className="activity-privacy-note">Day boundaries and chart labels use your {android ? "phone’s" : "computer’s"} current time zone.</p>
    </section>
    {android && <section className="activity-glass-card activity-privacy-card">
      <h2>ActivityWatch connection</h2>
      <button className="activity-button android-reconnect" type="button" onClick={() => android.connectActivityWatch()}>Change API key</button>
    </section>}
    {android && <section className="activity-glass-card activity-privacy-card">
      <h2>PDF reading</h2>
      <p className="activity-explainer">Record the filename and viewing time in Samsung Notes’ PDF reader. ActivityWatch sync sends these records to your computer.</p>
      <button className="activity-button android-reconnect" type="button" onClick={() => android.openPdfTrackingSettings()}>
        Open accessibility settings
      </button>
    </section>}
    {android && <section className="activity-glass-card activity-privacy-card">
      <h2>Desktop sync</h2>
      <p className="activity-explainer">Choose the Activity Usage folder that Syncthing receives from your computer.</p>
      <button className="activity-button android-reconnect" type="button" onClick={() => android.chooseSyncFolder()}>
        {android.hasSyncFolder() ? "Change sync folder" : "Choose sync folder"}
      </button>
    </section>}
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
  const maximum = Math.max(1, apps[0]?.seconds ?? 0);
  return <section className="activity-glass-card activity-app-list"><div className="activity-chart-panel__header"><div><h3>{title}</h3><p>{subtitle}</p></div></div>
    {apps.length ? <ol>{apps.map((app, index) => <li key={app.label}>
        <span className="activity-app-rank">{String(index + 1).padStart(2, "0")}</span>
        <div className="activity-app-detail">
          <div className="activity-app-row"><span title={app.label}>{app.label}</span><b>{formatDuration(app.seconds)}</b></div>
          <div className="activity-app-track"><i style={{ width: `${app.seconds / maximum * 100}%` }} /></div>
          <small>{app.events.toLocaleString()} recorded events</small>
        </div>
      </li>)}</ol> : <p className="activity-empty">No app-level events in this range.</p>}
  </section>;
}

function PreferenceToggle({ checked, label, note, onChange }: { checked: boolean; label: string; note: string; onChange(value: boolean): void }): React.JSX.Element {
  return <label className="activity-preference"><span><strong>{label}</strong><small>{note}</small></span><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /></label>;
}

function labelPeriod(period: Period, range: ActivityRange, today: string): string {
  const day = todayDay(period.start);
  if (range === 1 && day === today) return "Today";
  if (range === 1 && day === shiftDay(today, -1)) return "Yesterday";
  const last = new Date(period.end);
  last.setDate(last.getDate() - 1);
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (last.getFullYear() !== Number(today.slice(0, 4)) || period.start.getFullYear() !== last.getFullYear()) {
    options.year = "numeric";
  }
  const label = period.start.toLocaleDateString([], options);
  return day === todayDay(last) ? label : `${label} – ${last.toLocaleDateString([], options)}`;
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

function buildDays(events: ActivityWatchRecord[], period: Period): DayActivity[] {
  const ranges = [];
  for (let start = new Date(period.start); start < period.end;) {
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    end.setHours(0, 0, 0, 0);
    ranges.push({ start, end, key: todayDay(start), label: start.toLocaleDateString([], { month: "short", day: "numeric" }) });
    start = end;
  }
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
      key: `${todayDay(dayStart)}-${hour}`,
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
  const labels = new Map<string | null, string>();
  for (const event of events) {
    let app = labels.get(event.app);
    if (!app) { app = appLabel(event.app); labels.set(event.app, app); }
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

function readPreference(key: string, fallback = false): boolean {
  try { const value = window.localStorage.getItem(key); return value === null ? fallback : value === "1"; } catch { return fallback; }
}
