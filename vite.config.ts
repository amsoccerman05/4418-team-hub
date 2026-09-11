import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  build: {
    rollupOptions: {
      input: { main: "index.html", "suite-auth": "suite-auth.html" },
    },
  },
  plugins: [react()],
  base: "./",
  server: { port: 4420, strictPort: true },
});
