import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "static",
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, "src/ime.ts"),
      formats: ["iife"],
      name: "v7Ime",
      fileName: () => "script.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
