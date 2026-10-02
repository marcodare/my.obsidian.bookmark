// pnpm run install:vault → build già eseguita, copia i file nel vault configurato in .env.
import process from "node:process";
import { copyToVault, loadEnv, PLUGIN_FILES, resolvePluginDir } from "./vault.mjs";

try {
  loadEnv();
  const pluginDir = await resolvePluginDir();
  if (!pluginDir) {
    console.error(
      "OBSIDIAN_VAULT_PATH non impostata: copia .env.example in .env e indica il percorso del vault.",
    );
    process.exit(1);
  }
  await copyToVault(pluginDir);
  console.log(`Installati ${PLUGIN_FILES.join(", ")} in ${pluginDir}`);
  console.log("In Obsidian: ricarica il plugin (o riavvia) per usare la nuova versione.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
