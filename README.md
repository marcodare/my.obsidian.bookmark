# My Obsidian Bookmark

Obsidian plugin for **named bookmarks at precise positions** inside Markdown notes
(e.g. “Policy routing” at line 42 of `Linux/modulo00/lezione01/lesson.md`), without ever
modifying the notes. Bookmarks appear in a right sidebar, grouped by path, and can carry a
free-form note.

- Fully local: no network requests, telemetry or external services.
- Data in `.obsidian/plugins/my-obsidian-bookmark/data.json` (versioned format).
- Desktop, iPadOS and iOS.

## Installation

Development requirements: Node.js ≥ 21.2 and pnpm (version pinned in `package.json`;
`corepack enable` sets it up).

1. Point `.env` at your vault (not versioned; start from `.env.example`):

   ```bash
   cp .env.example .env
   # OBSIDIAN_VAULT_PATH=/absolute/path/to/vault   (the folder that contains .obsidian/)
   ```

2. Install dependencies, build and copy into the vault:

   ```bash
   pnpm install
   pnpm run install:vault
   ```

   The script builds and copies `main.js`, `manifest.json` and `styles.css` into
   `<VAULT>/.obsidian/plugins/my-obsidian-bookmark/`. If the path has no `.obsidian/` it stops
   with an error without creating anything.

3. In Obsidian: _Settings → Community plugins_ → turn off restricted mode if asked → reload the
   list → enable **My Obsidian Bookmark**.

**Manual install** (no `.env`): after `pnpm build`, copy the three files into
`<VAULT>/.obsidian/plugins/my-obsidian-bookmark/`.

To update: `pnpm run install:vault`, then reload the plugin. Never copy or delete `data.json`:
it holds the bookmarks.

On iPhone/iPad the plugin arrives through vault sync (Obsidian Sync, iCloud…), as long as sync
includes community plugins.

Requires Obsidian **1.7.2** or later.

### Upgrading from `lesson-bookmarks`

Earlier builds used the plugin id `lesson-bookmarks`. On first load, if
`my-obsidian-bookmark/data.json` does not exist yet, the plugin copies
`.obsidian/plugins/lesson-bookmarks/data.json` over and shows a notice. Then disable and delete
the old `lesson-bookmarks` plugin. Links copied earlier (`obsidian://lesson-bookmarks?…`) keep
working.

## Usage

| Action            | How                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------- |
| Create a bookmark | 🔖+ button in the note header, “Add bookmark at current position” command, + in sidebar |
| Open the sidebar  | 🔖 ribbon icon or the “Open panel” command                                              |
| Go to a bookmark  | Click it in the sidebar, or the “Go to bookmark…” command                               |
| Rename            | Double-click the name, F2, or menu → Edit name and note                                 |
| Move here         | In the “New bookmark” dialog, click an existing bookmark of the same branch to move it  |
| More actions      | Right-click or the `⋯` button on the bookmark                                           |

Bookmark menu: Go to bookmark · Update to current position · Edit name and note · Duplicate ·
Move up/down (manual order) · Open note · Copy link · Copy path · Show details · Delete.

**Search:** free text (name, path, preview and note; case- and accent-insensitive), or
`name:"to review"` and `path:linux` (alias `file:`). Terms are combined with AND.

**Grouping** (sidebar button or settings): path tree (default), full path, top-level folder,
file name, modified date, none.

**Copy link** produces `obsidian://my-obsidian-bookmark?vault=…&id=…`: pasted into a note or
opened from a browser, it jumps straight to the bookmark position.

### Duplicate names

A name identifies the bookmark within its note (case-insensitive). Creating a bookmark with a
name already used in the same note offers to move the existing one to the current position.

## How the position is found again

Each bookmark stores line, column, offset, ~64 characters before and after, the whole line and
the headings that contain it (`# Routing › ## Policy routing`).

1. **Live tracking** (can be turned off): while you type in Obsidian, the offsets of the note's
   bookmarks move with the text and the context is recomputed.
2. **Context recovery** (when the note opens and when a bookmark is clicked), useful when the
   note changed outside Obsidian or on another device:
   1. checks that the saved context is still at the saved position;
   2. otherwise looks for the full context, then the preceding text alone, then the following
      text alone, then short versions (24 characters), then the whole line, also tolerating
      whitespace and line-ending differences;
   3. a match is accepted **only if it is unique** (possibly after filtering by headings);
   4. if the text occurs in several places, the user is asked to choose;
   5. if it is not found, the bookmark **is not moved**: a notice offers “Open at the saved
      line” and “Update to the current cursor position”.

In the sidebar: ⚠ = position needs checking, red icon = file not found.

### Renamed, moved, deleted files

- Renaming/moving files or folders **inside Obsidian** updates the paths automatically.
- Deleted file: its bookmarks become **orphaned** and are never deleted automatically.
- Opening an orphaned bookmark (configurable, default “Ask”) looks for files with the same name
  containing the bookmark text, and on request searches the whole vault; you can relink, keep it
  as orphan or delete it.

## Sync and data safety

- Before every write `data.json` is re-read and merged with the in-memory data: bookmarks
  created on another device are not lost.
- For the same bookmark the most recent user change wins; automatic fixes never undo a change
  made elsewhere.
- Deletions are recorded (for 90 days) so an outdated device cannot bring deleted bookmarks back.
- When sync changes `data.json` while Obsidian is open, the plugin reloads and refreshes the
  sidebar (`onExternalSettingsChange`). The sidebar ⟳ button forces a reload.
- Corrupt `data.json` → copy in `data.corrupt-<date>.json`, notice, start from empty.
- Migration from an older format → backup in `data.backup-v<N>-<date>.json` before saving.
- `data.json` written by a **newer** plugin version → read-only; the file is left untouched until
  you update the plugin.

## Mobile (iOS / iPadOS)

| Feature                                   | Status                                                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Create from cursor (editing/Live Preview) | ✅                                                                                                                                |
| 🔖+ button in the note header             | ✅                                                                                                                                |
| **Mobile toolbar**                        | ⚙ A plugin cannot add itself: _Settings → Mobile → Manage toolbar_ → add “My Obsidian Bookmark: Add bookmark at current position” |
| Right sidebar                             | ✅ (swipe from the right or the “Open panel” command)                                                                             |
| Context menu                              | ✅ `⋯` button always visible (long-press may vary across versions)                                                                |
| Reordering                                | ✅ “Move up/down” from the menu. Drag & drop is desktop only                                                                      |
| Rename                                    | ✅ menu → Edit name and note (double-tap is unreliable on touch)                                                                  |
| Details tooltip                           | ⚠ no hover on touch → menu → Show details                                                                                         |

## Known limitations

- **Reading view:** there is no cursor. The bookmark is created on the first visible line of
  text (the dialog says so) and navigation scrolls to the line without highlighting it. For a
  precise position use editing/Live Preview.
- **Renames done outside Obsidian** (Finder, git, another device without the plugin): they look
  like delete + create; the bookmark becomes orphaned and must be relinked (the plugin suggests
  candidates). If the rename happens on another device with the plugin enabled, the new path
  arrives with the `data.json` sync.
- **Sync service conflicts:** if the service creates conflict copies of `data.json`
  (e.g. `data 2.json` on iCloud), they are not merged automatically.
- Live tracking follows only the focused editor. Changes made by other plugins in an unfocused
  editor are handled by context recovery.

## Development

```bash
pnpm install
pnpm dev                 # watch mode; copies every rebuild into the vault if .env is set
pnpm build               # tsc --noEmit + production bundle
pnpm run install:vault   # build + copy into the .env vault
pnpm test                # unit tests (vitest)
pnpm lint                # eslint
pnpm format              # prettier
```

With `pnpm dev` and `OBSIDIAN_VAULT_PATH` set, every save rebuilds and updates the plugin in the
vault. The [Hot Reload](https://github.com/pjeby/hot-reload) plugin reloads it in Obsidian
automatically. A variable already set in the environment takes precedence over `.env`.

### Layout

```
main.ts                  registration: commands, view, events, settings, legacy import
src/types.ts             types and default settings
src/anchor/              position capture and recovery (pure, tested)
src/store/               operations, migrations, zod schema, persistence, StoreManager (pure, tested)
src/view/                sidebar, grouping and search (pure), modals
src/editor/              CodeMirror extensions (highlight, tracking), navigation
src/controller.ts        user flows (create, go to, update, relink, delete)
tests/                   vitest tests
scripts/                 vault install (install:vault, pnpm dev)
```

### `data.json` format (v1)

```jsonc
{
  "version": 1,
  "bookmarks": [
    {
      "id": "uuid",
      "filePath": "Linux/modulo00/lezione01/lesson.md",
      "name": "Policy routing",
      "note": "optional free text",
      "position": {
        "line": 41,
        "ch": 12,
        "offset": 1830,
        "contextBefore": "…",
        "contextAfter": "…",
        "lineText": "…",
        "headingPath": ["Routing", "Policy routing"],
        "source": "editor",
      },
      "order": 0,
      "status": "ok", // ok | orphan | unresolved
      "createdAt": "…",
      "updatedAt": "…", // last user change
      "revisedAt": "…", // last change of any kind (sync)
    },
  ],
  "tombstones": [{ "id": "…", "deletedAt": "…" }],
  "settings": { "grouping": "pathTree", "sort": "manual", "…": "…" },
}
```

For a new format: bump `CURRENT_STORE_VERSION` in `src/types.ts` and add the step in
`src/store/migrations.ts`. The previous file is backed up automatically.

## License

MIT — see `LICENSE`.
