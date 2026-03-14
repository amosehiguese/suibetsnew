import { Buffer } from "buffer";
import { EventEmitter } from "events";

if (typeof window !== "undefined") {
  (window as any).Buffer = (window as any).Buffer ?? Buffer;
  (window as any).global = (window as any).global ?? window;
  (window as any).EventEmitter = (window as any).EventEmitter ?? EventEmitter;
}

if (typeof globalThis !== "undefined") {
  (globalThis as any).Buffer = (globalThis as any).Buffer ?? Buffer;
  (globalThis as any).EventEmitter = (globalThis as any).EventEmitter ?? EventEmitter;
}
