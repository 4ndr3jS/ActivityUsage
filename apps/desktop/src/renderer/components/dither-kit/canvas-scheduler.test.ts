import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleCanvas } from "./canvas-scheduler";

describe("canvas scheduling", () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let intersect: (visible: boolean) => void;
  let page: EventTarget & { hidden: boolean };
  let disconnect: () => void;

  function tick(): void {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(100));
  }

  beforeEach(() => {
    frames = new Map();
    nextFrame = 0;
    page = Object.assign(new EventTarget(), { hidden: false });
    disconnect = vi.fn();
    vi.stubGlobal("document", page);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
        intersect = visible => callback([{ isIntersecting: visible }]);
      }
      observe() { /* Visibility is controlled by each test. */ }
      disconnect() { disconnect(); }
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("coalesces updates and schedules no more frames after a static draw", () => {
    const draw = vi.fn();
    const scheduler = scheduleCanvas({} as HTMLCanvasElement, draw);
    scheduler.invalidate();
    expect(frames.size).toBe(0);
    intersect(true);
    scheduler.invalidate();
    scheduler.invalidate();
    expect(frames.size).toBe(1);
    tick();
    expect(draw).toHaveBeenCalledExactlyOnceWith(100, true);
    expect(frames.size).toBe(0);
    scheduler.invalidate();
    tick();
    expect(draw).toHaveBeenCalledTimes(2);
    expect(frames.size).toBe(0);
    scheduler.dispose();
  });

  it("runs only until an animation settles", () => {
    const draw = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false);
    const scheduler = scheduleCanvas({} as HTMLCanvasElement, draw);
    intersect(true);
    tick();
    tick();
    expect(frames.size).toBe(1);
    tick();
    expect(draw.mock.calls.map(call => call[1])).toEqual([true, false, false]);
    expect(frames.size).toBe(0);
    scheduler.dispose();
  });

  it("pauses offscreen and while hidden, resumes with current data, and cancels on disposal", () => {
    const draw = vi.fn().mockReturnValue(true);
    const scheduler = scheduleCanvas({} as HTMLCanvasElement, draw);
    intersect(true);
    intersect(false);
    expect(frames.size).toBe(0);
    scheduler.invalidate();
    expect(frames.size).toBe(0);
    intersect(true);
    tick();
    expect(frames.size).toBe(1);
    page.hidden = true;
    page.dispatchEvent(new Event("visibilitychange"));
    expect(frames.size).toBe(0);
    scheduler.invalidate();
    expect(frames.size).toBe(0);
    page.hidden = false;
    page.dispatchEvent(new Event("visibilitychange"));
    tick();
    expect(draw).toHaveBeenLastCalledWith(100, true);
    scheduler.dispose();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    scheduler.invalidate();
    page.dispatchEvent(new Event("visibilitychange"));
    intersect(true);
    expect(frames.size).toBe(0);
  });
});
