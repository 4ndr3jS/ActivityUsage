import type {
  ActivityDevice,
  ActivityWatchBucket,
  ActivityWatchRange,
  ActivityWatchRecord,
  ActivityWatchSnapshot
} from "../shared/desktop-api";

const ACTIVITYWATCH_API = "http://127.0.0.1:5600/api/0";
const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

interface RawBucket extends Record<string, unknown> {
  id?: unknown;
  type?: unknown;
  hostname?: unknown;
  last_updated?: unknown;
}

interface RawEvent extends Record<string, unknown> {
  timestamp?: unknown;
  duration?: unknown;
  data?: unknown;
}

interface BucketReadResult {
  bucket: ActivityWatchBucket;
  events: ActivityWatchRecord[];
}

/** Read the local ActivityWatch API without exposing its HTTP surface to the renderer. */
export async function readActivityWatchData(value: unknown): Promise<ActivityWatchSnapshot> {
  const range = validateRange(value);
  const [start, end] = [Date.parse(range.start), Date.parse(range.end)];
  const bucketPayload = await requestJson(`${ACTIVITYWATCH_API}/buckets/`);
  const rawBuckets = Array.isArray(bucketPayload)
    ? bucketPayload
    : isRecord(bucketPayload)
      ? Object.values(bucketPayload)
      : [];
  const buckets = rawBuckets.filter(isRecord).map(bucket => bucket as RawBucket).filter(bucket => typeof bucket.id === "string");
  const sources = buckets.filter(isTrackedBucket);
  const results = await Promise.all(sources.map(bucket => readBucket(bucket, start, end)));

  return {
    connected: true,
    fetchedAt: new Date().toISOString(),
    buckets: results.map(result => result.bucket),
    events: results.flatMap(result => result.events).sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
  };
}

function validateRange(value: unknown): ActivityWatchRange {
  if (!isRecord(value) || typeof value.start !== "string" || typeof value.end !== "string") {
    throw new Error("Choose a valid ActivityWatch date range.");
  }
  const start = Date.parse(value.start);
  const end = Date.parse(value.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > MAX_RANGE_MS) {
    throw new Error("The ActivityWatch date range is invalid or too large.");
  }
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

async function requestJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`ActivityWatch returned HTTP ${response.status}.`);
  return response.json() as Promise<unknown>;
}

function isTrackedBucket(bucket: RawBucket): boolean {
  const id = asString(bucket.id) ?? "";
  const type = asString(bucket.type) ?? "";
  return /currentwindow|aw-watcher-android|android/i.test(`${id} ${type}`);
}

async function readBucket(bucket: RawBucket, start: number, end: number): Promise<BucketReadResult> {
  const id = asString(bucket.id) ?? "";
  const device = bucketDevice(bucket);
  const type = asString(bucket.type) ?? "Unknown watcher";
  const hostname = asString(bucket.hostname) ?? id;
  const lastUpdated = asString(bucket.last_updated);
  const base: ActivityWatchBucket = { id, type, hostname, lastUpdated, device, eventCount: 0, error: null };
  const query = new URLSearchParams({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), limit: "-1" });

  try {
    const payload = await requestJson(`${ACTIVITYWATCH_API}/buckets/${encodeURIComponent(id)}/events?${query.toString()}`);
    if (!Array.isArray(payload)) return { bucket: { ...base, error: "ActivityWatch returned an unexpected event format." }, events: [] };
    const events = payload.filter(isRecord).map(row => normalizeEvent(row as RawEvent, id, device, start, end)).filter((record): record is ActivityWatchRecord => record !== null);
    return { bucket: { ...base, eventCount: events.length }, events };
  } catch {
    return { bucket: { ...base, error: "Could not read events from this watcher." }, events: [] };
  }
}

function normalizeEvent(
  event: RawEvent,
  bucketId: string,
  device: ActivityDevice,
  rangeStart: number,
  rangeEnd: number
): ActivityWatchRecord | null {
  if (typeof event.timestamp !== "string") return null;
  const rawStart = Date.parse(event.timestamp);
  const duration = typeof event.duration === "number" ? event.duration : Number(event.duration);
  if (!Number.isFinite(rawStart) || !Number.isFinite(duration) || duration <= 0) return null;
  const start = Math.max(rawStart, rangeStart);
  const end = Math.min(rawStart + duration * 1000, rangeEnd);
  if (end <= start) return null;
  const data = isRecord(event.data) ? event.data : {};
  return {
    timestamp: new Date(start).toISOString(),
    duration: (end - start) / 1000,
    device,
    bucketId,
    app: firstString(data.app, data.app_name, data.application, data.package_name, data.package),
    title: firstString(data.title, data.window_title)
  };
}

function bucketDevice(bucket: RawBucket): ActivityDevice {
  const text = [bucket.id, bucket.hostname, bucket.type].map(value => asString(value) ?? "").join(" ").toLowerCase();
  return /android|phone|samsung|synced-from/.test(text) ? "phone" : "computer";
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 500);
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
