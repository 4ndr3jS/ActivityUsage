// Labels are presentation only; ActivityWatch's source records remain intact.
const APP_NAMES: Record<string, string> = {
  brave: "Brave", chrome: "Google Chrome", msedge: "Microsoft Edge", firefox: "Firefox",
  explorer: "File Explorer", windowsterminal: "Windows Terminal", powershell: "PowerShell",
  pwsh: "PowerShell", cmd: "Command Prompt", code: "Visual Studio Code",
  chatgpt: "ChatGPT", usageatlas: "UsageAtlas", rocketleague: "Rocket League", rocketleagueeac: "Rocket League",
  fortnite: "Fortnite", fortniteclient: "Fortnite", spotify: "Spotify",
  syncthingfork: "Syncthing Fork", onedrive: "OneDrive", onenote: "OneNote",
  steamwebhelper: "Steam", discord: "Discord", obs64: "OBS Studio", obs: "OBS Studio",
  tiktok: "TikTok", mangafire: "MangaFire", oneuihome: "One UI Home",
  youtube: "YouTube", whatsapp: "WhatsApp", activitywatch: "ActivityWatch", awqt: "ActivityWatch",
  github: "GitHub", opencode: "OpenCode", opencodedesktop: "OpenCode",
  cs2: "Counter Strike 2", codeblocks: "Code::Blocks", epicgameslauncher: "Epic Games Launcher",
  taskmgr: "Task Manager", winword: "Microsoft Word", excel: "Microsoft Excel",
  powerpnt: "Microsoft PowerPoint", mspaint: "Paint", msteams: "Microsoft Teams", teams: "Microsoft Teams",
  devenv: "Visual Studio", msedgewebview2: "Microsoft Edge WebView2", javaw: "Java", java: "Java",
};

export function appLabel(raw: string | null): string {
  if (!raw?.trim()) return "Unlabelled application";
  let name = raw.trim().split(/[\\/]/).pop()!;
  const executable = /\.(exe|app|bin|desktop|com|tmp)$/i.test(name);
  name = name.replace(/(?:\.(?:exe|app|bin|desktop|com|tmp))+$/i, "");
  // Android package IDs sometimes arrive without an app's friendly label.
  if (/^(com|org|net|io)\.[\w.]+$/.test(name)) name = name.split('.').pop()!;
  if (/^fortnite(?:client)?(?:$|[-_ ])/i.test(name)) return "Fortnite";
  name = name.replace(/(?:[-_ ](?:win(?:32|64)?|x64|x86|shipping|release|debug))+$/i, "");
  const known = APP_NAMES[name.replace(/[-_\s]/g, "").toLowerCase()];
  if (typeof known === "string") return known;
  // Android often supplies a proper display name already (e.g. LingoDeer).
  if (executable) name = name.replace(/([a-z\d])([A-Z])/g, "$1 $2");
  return name.replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ").trim().replace(/(^|\s)\p{Ll}/gu, letter => letter.toUpperCase()) || "Unlabelled application";
}
