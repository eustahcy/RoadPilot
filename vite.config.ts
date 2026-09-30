import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// API kont i synchronizacji (server/, roadpilot-api.service) — w dev/preview przekierowane jak w Nginx.
const api = { "/roadpilot/api": { target: "http://127.0.0.1:7781", rewrite: (p: string) => p.replace(/^\/roadpilot/, "") } };

// Aplikacja jest serwowana przez Nginx z podkatalogu /roadpilot/.
export default defineConfig({
  base: "/roadpilot/",
  plugins: [react()],
  server: { proxy: api },
  preview: { proxy: api },
});
