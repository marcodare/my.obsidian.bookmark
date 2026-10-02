// Copies the built plugin into the vault set by OBSIDIAN_VAULT_PATH (.env).
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

export const PLUGIN_FILES = ["main.js", "manifest.json", "styles.css"];

/** Loads .env when present; variables already set in the environment take precedence. */
export function loadEnv() {
  if (existsSync(".env")) process.loadEnvFile(".env");
}

/** Plugin folder inside the vault, or null when OBSIDIAN_VAULT_PATH is not set. */
export async function resolvePluginDir() {
  const raw = process.env.OBSIDIAN_VAULT_PATH?.trim();
  if (!raw) return null;
  // Accept shell-style escapes (e.g. "Mobile\ Documents") pasted from a terminal.
  const unescaped = raw.replace(/\\(.)/g, "$1");
  const vault = path.resolve(unescaped.replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
  const obsidianDir = path.join(vault, ".obsidian");
  const isVault = await stat(obsidianDir).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (!isVault) {
    throw new Error(`OBSIDIAN_VAULT_PATH is not an Obsidian vault (missing ${obsidianDir})`);
  }
  const { id } = JSON.parse(await readFile("manifest.json", "utf8"));
  return path.join(obsidianDir, "plugins", id);
}

export async function copyToVault(pluginDir) {
  await mkdir(pluginDir, { recursive: true });
  for (const file of PLUGIN_FILES) {
    await copyFile(file, path.join(pluginDir, file));
  }
}
