import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  base: "./",
  plugins: [tailwindcss()],
  build: {
    outDir: "dist/extension",
    rollupOptions: { input: { settings: "index.html", popup: "popup.html" } },
  },
});
