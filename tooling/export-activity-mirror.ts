import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { readActivityWatchCategories, readActivityWatchData } from "../apps/desktop/src/shared/activitywatch";
import type { ActivityMirror } from "../apps/desktop/src/shared/activity-mirror";

const folder = process.argv[2];
if (!folder) throw new Error("Pass the path to your private Activity Usage sync folder.");
const end = new Date().toISOString();
const [snapshot, categories] = await Promise.all([
  readActivityWatchData({ start: null, end, includeBrowserTabs: true }),
  readActivityWatchCategories()
]);
if (!snapshot.buckets.length || snapshot.buckets.some(bucket => bucket.error)) {
  throw new Error("ActivityWatch did not return all watchers. The previous copy is still available.");
}
const mirror: ActivityMirror = { version: 1, snapshot, categories };
const directory = resolve(folder);
const temp = resolve(directory, ".syncthing.activityusage-history.json.gz.tmp");
await mkdir(directory, { recursive: true });
try {
  await writeFile(temp, gzipSync(JSON.stringify(mirror), { level: 3 }));
  await rename(temp, resolve(directory, "activityusage-history.json.gz"));
} finally {
  await rm(temp, { force: true });
}
