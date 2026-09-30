import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Aplikacja jest serwowana przez Nginx z podkatalogu /roadpilot/.
export default defineConfig({
  base: "/roadpilot/",
  plugins: [react()],
});
