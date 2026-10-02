// Copia del plugin compilato nel vault indicato da OBSIDIAN_VAULT_PATH (.env).
import { copyFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

export const PLUGIN_FILES = ["main.js", "manifest.json", "styles.css"];
const PLUGIN_ID = "lesson-bookmarks";

/** Carica .env se presente; le variabili già definite nell'ambiente hanno la precedenza. */
export function loadEnv() {
  if (existsSync(".env")) process.loadEnvFile(".env");
}

/** Cartella del plugin nel vault, oppure null se OBSIDIAN_VAULT_PATH non è impostata. */
export async function resolvePluginDir() {
  const raw = process.env.OBSIDIAN_VAULT_PATH?.trim();
  if (!raw) return null;
  const vault = path.resolve(raw.replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
  const obsidianDir = path.join(vault, ".obsidian");
  const isVault = await stat(obsidianDir).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (!isVault) {
    throw new Error(`OBSIDIAN_VAULT_PATH non punta a un vault Obsidian (manca ${obsidianDir})`);
  }
  return path.join(obsidianDir, "plugins", PLUGIN_ID);
}

export async function copyToVault(pluginDir) {
  await mkdir(pluginDir, { recursive: true });
  for (const file of PLUGIN_FILES) {
    await copyFile(file, path.join(pluginDir, file));
  }
}
