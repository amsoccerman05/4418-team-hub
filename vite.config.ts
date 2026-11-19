import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  build: {
    rollupOptions: {
      input: { main: "index.html", "suite-auth": "suite-auth.html", event: "event.html" },
    },
  },
  plugins: [react(), {
    name: "exclude-build-glob-toolchain-from-runtime",
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        for (const id of Object.keys(output.modules)) {
          if (/node_modules[\\/](?:picomatch|micromatch|tinyglobby|fdir|vite)[\\/]/.test(id)) {
            throw new Error("Build-only glob dependency in runtime bundle: " + id);
          }
        }
      }
    },
  }],
  base: "./",
  server: { port: 4420, strictPort: true },
});
