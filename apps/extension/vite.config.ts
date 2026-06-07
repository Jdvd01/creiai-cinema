import { defineConfig, loadEnv } from "vite";
import { resolve } from "path";
import { copyFileSync, mkdirSync } from "fs";

function copyExtensionStatics() {
  const r = (p: string) => resolve(__dirname, p);
  return {
    name: "copy-extension-statics",
    closeBundle() {
      mkdirSync(r("dist/icons"), { recursive: true });
      copyFileSync(r("manifest.json"), r("dist/manifest.json"));
      copyFileSync(r("popup.html"), r("dist/popup.html"));
      copyFileSync(r("offscreen.html"), r("dist/offscreen.html"));
      for (const s of [16, 48, 128]) {
        copyFileSync(r(`icons/icon${s}.png`), r(`dist/icons/icon${s}.png`));
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [copyExtensionStatics()],
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: {
          background: resolve(__dirname, "src/background.ts"),
          content: resolve(__dirname, "src/content.ts"),
          offscreen: resolve(__dirname, "src/offscreen.ts"),
          popup: resolve(__dirname, "src/popup.ts"),
        },
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: "chunks/[name]-[hash].js",
          assetFileNames: "[name].[ext]",
          format: "es",
        },
      },
    },
    define: {
      __SERVER_URL__: JSON.stringify(
        env.SERVER_URL ?? "http://localhost:3001"
      ),
      __WEB_URL__: JSON.stringify(
        env.WEB_URL ?? "http://localhost:3000"
      ),
    },
  };
});
