/** Display addresses omit credentials, query strings, fragments and local paths. */
export function pageAddress(value: string | null): { site: string; page: string } | null {
  if (!value) return null;
  const address = value.trim();
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(address) ? address : `https://${address}`);
    if (url.protocol === "http:" || url.protocol === "https:") {
      if (!url.hostname.includes(".") && url.hostname !== "localhost" && !url.hostname.startsWith("[")) return null;
      const site = url.hostname.replace(/^www\./, "");
      return { site, page: `${site}${url.pathname.replace(/\/$/, "")}`.slice(0, 1000) };
    }
    if (url.protocol === "file:") return { site: "Local files", page: "Local file" };
    if (["about:", "chrome:", "brave:", "edge:"].includes(url.protocol)) {
      return { site: "Browser pages", page: url.hostname || url.pathname || "Browser page" };
    }
  } catch {
    // An invalid address does not identify a page.
  }
  return null;
}
