import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dev server proxies the API to the local backend so that development runs
// same-origin and needs no CORS configuration. Split deployments set
// VITE_API_BASE_URL at build time instead.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_API ?? "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
