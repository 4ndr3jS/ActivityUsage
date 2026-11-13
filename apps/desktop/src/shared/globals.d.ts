import type { ActivityUsageDesktopAPI } from "./desktop-api";

declare global {
  interface Window {
    usageAtlas: ActivityUsageDesktopAPI;
  }
}

export {};
