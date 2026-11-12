<p align="center">
  <img src="branding/usageatlas-logo.png" width="144" height="144" alt="UsageAtlas app icon">
</p>

<h1 align="center">UsageAtlas ActivityWatch</h1>

<p align="center">
  Private device-activity analytics for your computer and Android phone.<br>
  Activity data stays on your computer.
</p>

<p align="center">
  <a href="#build-from-source"><strong>Build the ActivityWatch app</strong></a>
  ·
  <a href="https://github.com/SRX9/UsageAtlas">Original UsageAtlas</a>
</p>

Based on [SRX9/UsageAtlas](https://github.com/SRX9/UsageAtlas). This independent adaptation replaces AI-usage pages with local computer and Android activity analytics. The original commit history and MIT license are preserved.

## What it does

UsageAtlas reads local ActivityWatch records and turns them into a desktop dashboard:

- Today and historical activity across the computer and phone
- Computer, phone, and combined active-time charts
- App breakdowns, observed patterns, and source health
- Date ranges, prior-period comparison, and JSON export
- Privacy controls for window titles and exported app labels

## ActivityWatch setup

UsageAtlas reads the local ActivityWatch API at `http://127.0.0.1:5600/api/0`. It does not open or modify ActivityWatch's database files.

For phone activity, install and configure ActivityWatch on Android, grant its Usage Access permission, and sync the phone's ActivityWatch data to the desktop ActivityWatch instance. UsageAtlas reads the synced buckets from the desktop API; it does not connect to Samsung Account, use ADB, or collect phone data directly.

Activity totals are calculated from the intervals recorded by ActivityWatch. Combined time counts overlapping computer and phone intervals once. These records do not measure attention or productivity, and they may differ from Android Digital Wellbeing's screen-on totals.

## Privacy

Activity records are read locally and are not uploaded by UsageAtlas. Window titles are hidden by default. Exported summaries omit app labels unless you enable them. ActivityWatch itself remains the source of the raw history.

## Build from source

Requirements: Bun 1.3.14 and Node.js 22.13 or newer.

```bash
git clone https://github.com/4ndr3jS/UsageAtlas-ActivityWatch.git
cd UsageAtlas-ActivityWatch
bun ci
bun run desktop:start
```

`desktop:start` runs the development tools and file watchers. For everyday use on Windows, build once with `bun run desktop:package`, then open `apps/desktop/out/UsageAtlas-win32-x64/UsageAtlas.exe`. Rebuild after changing the source. Create a platform installer with `bun run desktop:make`.

Charts redraw when their data or interaction changes and stop drawing while idle, offscreen, or minimized. The optional five-minute refresh also pauses while minimized. App labels are cleaned up for display; the original ActivityWatch records remain unchanged. Electron still has a baseline memory cost even in the packaged app.

## History

The ActivityWatch changes were reconstructed into 28 commits on November 13, 2026, with synthetic dates spanning November 7–13. This is a backfilled development sequence, not a record of work performed on those dates. Upstream commits retain their original authors and dates.

## License

Source code is available under the [MIT License](LICENSE). The UsageAtlas name and logo are not covered by it; see [TRADEMARKS.md](TRADEMARKS.md).
