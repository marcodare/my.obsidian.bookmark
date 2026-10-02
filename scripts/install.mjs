// pnpm run install:vault → after the build, copies the plugin into the vault set in .env.
import process from "node:process";
import { copyToVault, loadEnv, PLUGIN_FILES, resolvePluginDir } from "./vault.mjs";

try {
  loadEnv();
  const pluginDir = await resolvePluginDir();
  if (!pluginDir) {
    console.error(
      "OBSIDIAN_VAULT_PATH is not set: copy .env.example to .env and set the vault path.",
    );
    process.exit(1);
  }
  await copyToVault(pluginDir);
  console.log(`Installed ${PLUGIN_FILES.join(", ")} into ${pluginDir}`);
  console.log("In Obsidian: reload the plugin (or restart) to use the new version.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
