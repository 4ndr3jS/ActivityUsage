import type { AppRoute, EngineStatus } from "../../shared/desktop-api";
import { useLayoutEffect, useRef } from "react";
import { DayIcon, DeviceActivityIcon, InsightsIcon, PulseIcon, SettingsIcon, TrendsIcon } from "../icons";

interface AppShellProps {
  route: AppRoute;
  onNavigate(route: AppRoute): void;
  updateControl?: React.ReactNode;
  children: React.ReactNode;
  /** Kept optional for callers compiled from older local builds. */
  engineStatus?: EngineStatus;
  noticeCount?: number;
  profileBadge?: boolean;
  activityControl?: React.ReactNode;
}

const primaryNavigation: Array<{
  route: AppRoute;
  label: string;
  icon: (props: React.SVGProps<SVGSVGElement>) => React.JSX.Element;
}> = [
  { route: "day", label: "Today", icon: DayIcon },
  { route: "trends", label: "History", icon: TrendsIcon },
  { route: "activity", label: "Breakdown", icon: DeviceActivityIcon },
  { route: "insights", label: "Insights", icon: InsightsIcon },
  { route: "sources", label: "Sources", icon: PulseIcon }
];

const routeTitles: Record<AppRoute, string> = {
  day: "Today",
  trends: "History",
  activity: "Breakdown",
  insights: "Insights",
  sources: "Sources",
  limits: "Device limits",
  alerts: "Activity alerts",
  profile: "Device profile",
  settings: "Settings",
  diagnostics: "Activity sources"
};

export function AppShell({ route, onNavigate, updateControl, children }: AppShellProps): React.JSX.Element {
  const workspaceRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    workspace.scrollTop = 0;
    workspace.scrollLeft = 0;
    workspace.removeAttribute("data-scrolled");
  }, [route]);

  return (
    <div className="atlas-app-shell">
      <header aria-label="UsageAtlas" className="atlas-app-shell__titlebar drag-region">
        <div className="atlas-app-shell__brand">
          <span aria-hidden="true" className="atlas-app-shell__brand-mark"><img alt="" src="./usageatlas.png" /></span>
          <span className="atlas-app-shell__brand-name">UsageAtlas</span>
          {updateControl}
          <span aria-hidden="true" className="atlas-app-shell__brand-divider" />
          <span className="atlas-app-shell__route-name">{routeTitles[route]}</span>
        </div>
      </header>

      <aside aria-label="Primary navigation" className="atlas-app-shell__rail no-drag">
        <nav aria-label="Device activity pages" className="atlas-app-shell__navigation">
          {primaryNavigation.map(item => (
            <RailButton key={item.route} icon={item.icon} isCurrent={route === item.route} label={item.label} onPress={() => onNavigate(item.route)} />
          ))}
        </nav>
        <nav aria-label="App settings" className="atlas-app-shell__navigation atlas-app-shell__navigation--footer">
          <RailButton icon={SettingsIcon} isCurrent={route === "settings"} label="Settings" onPress={() => onNavigate("settings")} />
        </nav>
      </aside>

      <main className="atlas-app-shell__workspace no-drag" onScroll={handleWorkspaceScroll} ref={workspaceRef}>
        {children}
      </main>
    </div>
  );
}

function handleWorkspaceScroll(event: React.UIEvent<HTMLElement>): void {
  event.currentTarget.toggleAttribute("data-scrolled", event.currentTarget.scrollTop > 12);
}

function RailButton({
  icon: Icon,
  isCurrent,
  label,
  onPress
}: {
  icon: (props: React.SVGProps<SVGSVGElement>) => React.JSX.Element;
  isCurrent: boolean;
  label: string;
  onPress(): void;
}): React.JSX.Element {
  return (
    <button aria-current={isCurrent ? "page" : undefined} aria-label={label} className="atlas-app-shell__rail-button" onClick={onPress} title={label} type="button">
      <span className="atlas-app-shell__rail-icon"><Icon aria-hidden="true" /></span>
      <span className="sr-only">{label}</span>
    </button>
  );
}
