import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  resolve: {
    alias: [
      {
        find: "use-sync-external-store/shim",
        replacement: path.resolve(
          __dirname,
          "./src/shims/use-sync-external-store/shim"
        ),
      },
      {
        find: "@",
        replacement: path.resolve(__dirname, "./src"),
      },
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (id.includes("@xyflow/react")) {
            return "react-flow";
          }

          if (
            id.includes("@tiptap") ||
            id.includes("/prosemirror") ||
            id.includes("@tiptap/pm")
          ) {
            return "rich-text";
          }

          if (id.includes("react-konva") || id.includes("konva")) {
            return "konva";
          }

          if (
            id.includes("pdfjs-dist") ||
            id.includes("mammoth") ||
            id.includes("docx")
          ) {
            return "document-tools";
          }

          if (id.includes("@tauri-apps")) {
            return "tauri";
          }

          if (
            id.includes("react") ||
            id.includes("react-dom") ||
            id.includes("scheduler")
          ) {
            return "react-core";
          }

          if (
            id.includes("zustand") ||
            id.includes("i18next") ||
            id.includes("react-i18next") ||
            id.includes("@tanstack/react-query")
          ) {
            return "app-core";
          }

          return undefined;
        },
      },
    },
  },
  optimizeDeps: {
    exclude: [
      "@tiptap/react",
      "@tiptap/starter-kit",
      "@tiptap/pm",
      "@tiptap/extension-text-style",
    ],
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore generated artifacts and bundled runtimes
      ignored: [
        "**/src-tauri/**",
        "**/src-tauri/target/**",
        "**/dist/**",
        "**/build/**",
        "**/extension-packages/**",
      ],
    },
  },
}));
