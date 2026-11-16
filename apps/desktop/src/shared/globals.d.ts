import type { ActivityUsageDesktopAPI } from "./desktop-api";
import type { ActivityUsageAndroid } from "../renderer/android-api";

declare global {
  interface Window {
    usageAtlas: ActivityUsageDesktopAPI;
    ActivityUsageAndroid?: ActivityUsageAndroid;
  }
}

export {};
