declare const ACTIVITY_USAGE_CLOUD_URL: string;

/** The usageatlas.com origin, or a local one for development builds. */
export const CLOUD_URL =
  typeof ACTIVITY_USAGE_CLOUD_URL === "string"
    ? ACTIVITY_USAGE_CLOUD_URL
    : "https://usageatlas.com";
