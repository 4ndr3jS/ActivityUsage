import { useCallback, useEffect, useState } from "react";
import type { AppRoute } from "../shared/desktop-api";
import { useDesktopUpdates } from "./update-state";
import { ActivityDashboard, type ActivityView } from "./components/ActivityDashboard";
import { AppShell } from "./components/AppShell";
import { UpdateTag } from "./components/UpdateControls";
import { ANDROID_CONNECTED_EVENT } from "./android-api";

export function App(): React.JSX.Element {
  const updates = useDesktopUpdates();
  const [route, setRoute] = useState<AppRoute>(() => routeFromHash(location.hash));
  const [connectionVersion, setConnectionVersion] = useState(0);
  const android = window.ActivityUsageAndroid;

  const navigate = useCallback((next: AppRoute): void => {
    location.hash = next;
    setRoute(next);
  }, []);

  useEffect(() => {
    const onHashChange = (): void => setRoute(routeFromHash(location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (!android) return;
    const onConnect = () => setConnectionVersion(version => version + 1);
    window.addEventListener(ANDROID_CONNECTED_EVENT, onConnect);
    return () => window.removeEventListener(ANDROID_CONNECTED_EVENT, onConnect);
  }, [android]);

  return (
    <AppShell route={route} onNavigate={navigate} updateControl={android ? undefined : <UpdateTag state={updates.state} onCheck={updates.check} onInstall={updates.install} />}>
      {android && !android.hasConnection() && !android.hasSyncFolder() ? <div className="activity-dashboard">
        <section className="activity-glass-card android-connect-card">
          <h1>Connect ActivityWatch</h1>
          <p>In ActivityWatch, open API Authentication from its menu and copy the API key. Then return here to paste it.</p>
          <div>
            <button className="activity-button" type="button" onClick={() => android.openActivityWatch()}>Open ActivityWatch</button>
            <button className="activity-button" type="button" onClick={() => android.connectActivityWatch()}>Connect</button>
            <button className="activity-button" type="button" onClick={() => android.chooseSyncFolder()}>Choose desktop sync folder</button>
          </div>
        </section>
      </div> : <ActivityDashboard key={connectionVersion} view={viewForRoute(route)} />}
    </AppShell>
  );
}

function routeFromHash(hash: string): AppRoute {
  const candidate = hash.replace(/^#/, "");
  if (candidate === "day" || candidate === "trends" || candidate === "statistics" || candidate === "insights" || candidate === "sources" || candidate === "settings") {
    return candidate;
  }
  return "day";
}

function viewForRoute(route: AppRoute): ActivityView {
  if (route === "trends") return "history";
  if (route === "statistics") return "statistics";
  if (route === "insights") return "insights";
  if (route === "sources") return "sources";
  if (route === "settings") return "settings";
  return "overview";
}
