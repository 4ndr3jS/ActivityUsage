import { describe, expect, it } from "vitest";
import { SHEEN_PEAK, sheenAt } from "./dither-paint";

const COLS = 480;

describe("idle light sweep", () => {
  it("keeps the band soft and bounded", () => {
    for (let t = 0; t < 40_000; t += 137) {
      const band = sheenAt(t, COLS, 0.3);
      expect(band.peak).toBeGreaterThan(SHEEN_PEAK * 0.55);
      expect(band.peak).toBeLessThanOrEqual(SHEEN_PEAK + 1e-9);
      expect(band.width).toBeGreaterThanOrEqual(22);
      expect(band.x).toBeLessThan(COLS + band.width);
    }
  });

  it("starts and finishes off-canvas so the repeat never jumps", () => {
    const start = sheenAt(0, COLS, 0);
    expect(start.x + start.width).toBeLessThanOrEqual(0.0001);
    const end = sheenAt(14_999, COLS, 0);
    expect(end.x).toBeGreaterThanOrEqual(COLS);
  });

  it("offsets charts by phase so they do not sweep in lockstep", () => {
    expect(sheenAt(5000, COLS, 0)).not.toEqual(sheenAt(5000, COLS, 0.5));
  });

  it("breathes rather than holding one brightness", () => {
    const samples = new Set<string>();
    for (let t = 0; t < 6000; t += 250) {
      samples.add(sheenAt(t, COLS, 0).peak.toFixed(4));
    }
    expect(samples.size).toBeGreaterThan(4);
  });
});
