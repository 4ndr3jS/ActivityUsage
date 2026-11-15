import { useCallback, useEffect, useState } from "react";
import type { AppRoute } from "../shared/desktop-api";
import { useDesktopUpdates } from "./update-state";
import { ActivityDashboard, type ActivityView } from "./components/ActivityDashboard";
import { AppShell } from "./components/AppShell";
import { UpdateTag } from "./components/UpdateControls";

export function App(): React.JSX.Element {
  const updates = useDesktopUpdates();
  const [route, setRoute] = useState<AppRoute>(() => routeFromHash(location.hash));

  const navigate = useCallback((next: AppRoute): void => {
    location.hash = next;
    setRoute(next);
  }, []);

  useEffect(() => {
    const onHashChange = (): void => setRoute(routeFromHash(location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return (
    <AppShell route={route} onNavigate={navigate} updateControl={<UpdateTag state={updates.state} onCheck={updates.check} onInstall={updates.install} />}>
      <ActivityDashboard view={viewForRoute(route)} />
    </AppShell>
  );
}

function routeFromHash(hash: string): AppRoute {
  const candidate = hash.replace(/^#/, "");
  if (candidate === "day" || candidate === "trends" || candidate === "activity" || candidate === "statistics" || candidate === "insights" || candidate === "sources" || candidate === "settings") {
    return candidate;
  }
  return "day";
}

function viewForRoute(route: AppRoute): ActivityView {
  if (route === "trends") return "history";
  if (route === "activity") return "breakdown";
  if (route === "statistics") return "statistics";
  if (route === "insights") return "insights";
  if (route === "sources") return "sources";
  if (route === "settings") return "settings";
  return "overview";
}
