import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeActivityRefresh } from "./activity-refresh";
import { createActivityPeriod } from "./activity-period";

afterEach(() => vi.useRealTimers());
describe("activity refresh", () => {
  it("refreshes each visible minute and on return, and releases all listeners", () => {
    vi.useFakeTimers();
    const page = Object.assign(new EventTarget(), { hidden: false });
    const host = Object.assign(new EventTarget(), { setInterval, clearInterval });
    const refresh = vi.fn();
    const stop = subscribeActivityRefresh(refresh, page as unknown as Document, host as unknown as Window);
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    page.hidden = true;
    vi.advanceTimersByTime(120_000);
    host.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(1);
    page.hidden = false;
    page.dispatchEvent(new Event("visibilitychange"));
    host.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(60_000);
    page.dispatchEvent(new Event("visibilitychange"));
    host.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("moves today's range to the new calendar day after midnight", () => {
    const before = createActivityPeriod(1, 0, new Date(2026, 10, 14, 23, 59));
    const after = createActivityPeriod(1, 0, new Date(2026, 10, 15, 0, 1));
    expect(after.start.getTime()).toBe(before.end.getTime());
    expect(after.start.getHours()).toBe(0);
    expect(after.end.getDate()).toBe(16);
  });
});
