import { Buffer } from "buffer";
import { EventEmitter } from "events";

if (typeof (globalThis as any).process === "undefined") {
  (globalThis as any).process = {
    env: { NODE_ENV: "production" },
    browser: true,
    version: "v20.0.0",
    versions: {},
    platform: "browser",
    nextTick: (fn: (...args: any[]) => void, ...args: any[]) =>
      setTimeout(() => fn(...args), 0),
  };
}

if (typeof window !== "undefined") {
  (window as any).Buffer = (window as any).Buffer ?? Buffer;
  (window as any).global = (window as any).global ?? window;
  (window as any).EventEmitter = (window as any).EventEmitter ?? EventEmitter;
  if ((window as any).process === undefined) {
    (window as any).process = (globalThis as any).process;
  }
}

if (typeof globalThis !== "undefined") {
  (globalThis as any).Buffer = (globalThis as any).Buffer ?? Buffer;
  (globalThis as any).EventEmitter = (globalThis as any).EventEmitter ?? EventEmitter;
}
