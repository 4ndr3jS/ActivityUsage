/** Calendar-day boundaries keep rolling ranges in the past, including across DST. */
export function createActivityPeriod(days: number, offset: number, now = new Date()): { start: Date; end: Date } {
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1 + Math.min(0, offset) * days);
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  return { start, end };
}
