<p align="center">
  <img src="branding/activityusage-logo.png" width="144" height="144" alt="Activity Usage app icon">
</p>

<h1 align="center">Activity Usage</h1>

<p align="center">
  Private device-activity analytics for your computer and Android phone.<br>
  Activity data stays on your computer.
</p>

## What it does

Activity Usage reads local ActivityWatch records and turns them into a desktop dashboard:

- Today and historical activity across your computer and phone
- Computer, phone, and combined active-time charts
- App breakdowns, websites and pages recorded by ActivityWatch’s browser watcher, observed patterns, and source health
- Date ranges, prior-period comparison, and JSON export
- Privacy controls for window titles and exported app labels

## Setup

Activity Usage reads the local ActivityWatch API at `http://127.0.0.1:5600/api/0`. It does not open or modify ActivityWatch's database files.

For phone activity, install ActivityWatch on Android, grant its Usage Access permission, and sync the phone's data to the desktop instance. Activity Usage reads the synced buckets from the desktop API; it does not connect to Samsung Account, use ADB, or collect phone data directly.

Totals are calculated from the intervals ActivityWatch records. Combined time counts overlapping computer and phone intervals once. These records do not measure attention or productivity.

## Privacy

Activity records are read locally and are not uploaded. Window titles are hidden by default. Select **Pages** in Activity Breakdown to see recorded browser tab titles and addresses with query strings and fragments removed. Exported summaries omit app labels unless you enable them and do not include visited pages.

## Build

Requires Bun 1.3.14 and Node.js 22.13 or newer.

```bash
git clone https://github.com/4ndr3jS/ActivityUsage.git
cd ActivityUsage
bun ci
bun run desktop:start
```

For everyday use on Windows, build once with `bun run desktop:package`, then open `apps/desktop/out/ActivityUsage-win32-x64/ActivityUsage.exe`. Rebuild after changing the source. Create a platform installer with `bun run desktop:make`.

## Credits

An independent adaptation of [SRX9/UsageAtlas](https://github.com/SRX9/UsageAtlas). The original commit history and MIT license are preserved.

## License

Source code is available under the [MIT License](LICENSE).
