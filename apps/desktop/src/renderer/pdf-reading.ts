import type { ActivityWatchPdf } from "../shared/desktop-api";
import { indexActivitySpans } from "./browser-activity";

const PDF_READERS = /^(?:acrobat|acrord32|adobe acrobat(?: reader)?|sumatrapdf|foxit(?:pdfreader|reader| pdf reader)|okular|evince|preview|zathura|pdfxchangeeditor|pdfxedit)(?:\.exe|\.app)?$/i;

export function isPdfReader(app: string | null): boolean {
  return PDF_READERS.test(app?.split(/[\\/]/).at(-1) ?? "");
}

export function indexPhonePdfs(pdfs: ActivityWatchPdf[]) {
  return indexActivitySpans(pdfs.map(({ timestamp, duration, filename }) => {
    const start = Date.parse(timestamp);
    return { start, end: start + duration * 1000, filename };
  }));
}
