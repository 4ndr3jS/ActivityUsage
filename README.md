<p align="center">
  <img src="branding/activityusage-logo.png" width="144" height="144" alt="Activity Usage app icon">
</p>

<h1 align="center">Activity Usage</h1>

<p align="center">
  Private device-activity analytics for your computer and Android phone.<br>
  The dashboard reads activity data on the device where it runs.
</p>

## What it does

Activity Usage reads local ActivityWatch records and turns them into a desktop dashboard:

- Today and historical activity across your computer and phone
- Computer, phone, and combined active-time charts
- Interactive category statistics, app and window title rankings, observed patterns, and source health
- Date ranges, prior-period comparison, and JSON export
- Privacy controls for window titles and exported app labels

## Setup

Activity Usage reads the local ActivityWatch API at `http://127.0.0.1:5600/api/0`. It does not open or modify ActivityWatch's database files.

For phone activity, install ActivityWatch on Android, grant its Usage Access permission, and sync the phone's data to the desktop instance. Activity Usage reads the synced buckets from the desktop API; it does not connect to Samsung Account, use ADB, or collect phone data directly.

Totals are calculated from the intervals ActivityWatch records. Combined time counts overlapping computer and phone intervals once. These records do not measure attention or productivity.

## Privacy

Activity records are read locally. If you enable the optional desktop sync below, the history file is sent to your paired phone through your chosen sync tool. Window titles are hidden by default and can be shown under **Statistics → Top window titles**. Exported summaries omit app labels unless you enable them and do not include visited pages.

## Build

Requires Bun 1.3.14 and Node.js 22.13 or newer.

```bash
git clone https://github.com/4ndr3jS/ActivityUsage.git
cd ActivityUsage
bun ci
bun run desktop:start
```

For everyday use on Windows, build once with `bun run desktop:package`, then open `apps/desktop/out/ActivityUsage-win32-x64/ActivityUsage.exe`. Rebuild after changing the source. Create a platform installer with `bun run desktop:make`.

### Android

On Windows, use JDK 21, Android platform 36 and Build Tools 36 to build the Android app.

```powershell
.\apps\android\Build.ps1
adb -s DEVICE_SERIAL install -r .\apps\android\out\ActivityUsage.apk
```

The script uses `ANDROID_HOME` and `JAVA_HOME` by default. Keep the generated `apps/android/out/local.keystore` for in-place updates.

Open ActivityWatch on the phone and copy its key from **API Authentication**. In Activity Usage, select **Connect** and paste the key for access to local phone activity.

For combined history on Android, first arrange for ActivityWatch phone records to be imported on the PC. Run `bun tooling/export-activity-mirror.ts <private-sync-folder>` on the PC after imports, for example every few minutes using the same local import job. Share this separate folder with just the phone in Syncthing, using Send Only on the PC, Receive Only on Android, and no file versioning. The folder contains a compressed copy of your recorded activity, including window titles, browser details and category rules. Keep it outside the repository. In Android Activity Usage, open **Settings → Desktop sync** and choose the received folder. The app reads the most recent copy while offline and shows when the PC last exported it.

## Credits

An independent adaptation of [SRX9/UsageAtlas](https://github.com/SRX9/UsageAtlas). The original commit history and MIT license are preserved.

## License

Source code is available under the [MIT License](LICENSE).
