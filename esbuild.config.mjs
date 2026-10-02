import esbuild from "esbuild";
import process from "node:process";
import { builtinModules } from "node:module";
import { copyToVault, loadEnv, resolvePluginDir } from "./scripts/vault.mjs";

const banner = `/*
My Obsidian Bookmark — bundle generato da esbuild.
Il sorgente è disponibile nel repository del plugin.
*/`;

const production = process.argv[2] === "production";

// In sviluppo, se .env indica un vault, ogni rebuild viene copiata nel vault.
loadEnv();
const devPluginDir = production ? null : await resolvePluginDir();

/** @type {import("esbuild").Plugin} */
const copyToVaultPlugin = {
  name: "copy-to-vault",
  setup(build) {
    build.onEnd(async (result) => {
      if (!devPluginDir || result.errors.length > 0) return;
      try {
        await copyToVault(devPluginDir);
        console.log(`[vault] copiato in ${devPluginDir}`);
      } catch (error) {
        console.error(
          `[vault] copia non riuscita: ${error instanceof Error ? error.message : error}`,
        );
      }
    });
  },
};

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules,
  ],
  format: "cjs",
  target: "es2021",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  minify: production,
  outfile: "main.js",
  plugins: [copyToVaultPlugin],
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
