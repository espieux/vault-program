// Polyfills for Node.js globals in browser environment
// Import buffer synchronously
import { Buffer } from "buffer";

// Make Buffer available globally immediately
if (typeof window !== "undefined") {
  (window as any).Buffer = Buffer;
  (window as any).global = window;
  (window as any).globalThis = window;
}

// Also make it available on globalThis
if (typeof globalThis !== "undefined") {
  (globalThis as any).Buffer = Buffer;
}

// Minimal process polyfill
if (typeof window !== "undefined" && typeof (window as any).process === "undefined") {
  (window as any).process = {
    env: {},
    browser: true,
    version: "v16.0.0",
    versions: {},
    nextTick: (fn: Function) => setTimeout(fn, 0),
  };
}

// Export for use in other modules
export { Buffer };

