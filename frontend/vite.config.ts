import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      buffer: "buffer",
      "process/browser": "process/browser",
    },
  },
  define: {
    global: "globalThis",
  },
  optimizeDeps: {
    include: ["buffer", "process"],
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
    },
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      // Prevent externalization of buffer
      external: (id) => {
        // Don't externalize buffer or process
        if (id === "buffer" || id === "process" || id.startsWith("process/")) {
          return false;
        }
        return false;
      },
    },
  },
});

