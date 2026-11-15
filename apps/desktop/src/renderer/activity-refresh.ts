/** Refresh on return to the app as well as periodically; never poll hidden windows. */
export function subscribeActivityRefresh(refresh: () => void, page: Document = document, host: Window = window): () => void {
  const check = (): void => { if (!page.hidden) refresh(); };
  const timer = host.setInterval(check, 60_000);
  page.addEventListener("visibilitychange", check);
  host.addEventListener("focus", check);
  return () => {
    host.clearInterval(timer);
    page.removeEventListener("visibilitychange", check);
    host.removeEventListener("focus", check);
  };
}
