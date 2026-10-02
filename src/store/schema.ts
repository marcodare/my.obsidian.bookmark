// zod/mini: stessa validazione di zod, senza i messaggi localizzati (bundle molto più piccolo).
import * as z from "zod/mini";
import { DEFAULT_SETTINGS } from "../types";

const isoDate = z
  .string()
  .check(z.refine((s) => !Number.isNaN(Date.parse(s)), "data ISO non valida"));
const nonNegativeInt = z.int().check(z.minimum(0));
const nonEmpty = z.string().check(z.minLength(1));

export const positionSchema = z.object({
  line: nonNegativeInt,
  ch: nonNegativeInt,
  offset: nonNegativeInt,
  contextBefore: z.string(),
  contextAfter: z.string(),
  lineText: z.string(),
  headingPath: z.array(z.string()),
  source: z.enum(["editor", "preview"]),
});

export const bookmarkSchema = z.object({
  id: nonEmpty,
  filePath: nonEmpty,
  name: nonEmpty,
  note: z.optional(z.string()),
  position: positionSchema,
  order: z.number(),
  status: z.enum(["ok", "orphan", "unresolved"]),
  createdAt: isoDate,
  updatedAt: isoDate,
  revisedAt: isoDate,
});

export const tombstoneSchema = z.object({ id: nonEmpty, deletedAt: isoDate });

/** Ogni impostazione non valida ricade sul valore predefinito invece di invalidare tutto il file. */
export const settingsSchema = z.catch(
  z.object({
    grouping: z.catch(
      z.enum(["none", "topFolder", "pathTree", "pathFlat", "fileName", "modifiedDate"]),
      DEFAULT_SETTINGS.grouping,
    ),
    sort: z.catch(z.enum(["manual", "name", "file", "updated"]), DEFAULT_SETTINGS.sort),
    showPreview: z.catch(z.boolean(), DEFAULT_SETTINGS.showPreview),
    showPath: z.catch(z.boolean(), DEFAULT_SETTINGS.showPath),
    highlightEnabled: z.catch(z.boolean(), DEFAULT_SETTINGS.highlightEnabled),
    highlightDurationMs: z.catch(
      z.int().check(z.minimum(200), z.maximum(30000)),
      DEFAULT_SETTINGS.highlightDurationMs,
    ),
    missingFileBehavior: z.catch(
      z.enum(["ask", "orphan", "delete"]),
      DEFAULT_SETTINGS.missingFileBehavior,
    ),
    openMode: z.catch(z.enum(["same", "newTab"]), DEFAULT_SETTINGS.openMode),
    liveTracking: z.catch(z.boolean(), DEFAULT_SETTINGS.liveTracking),
    collapsedGroups: z.catch(z.array(z.string()), () => [...DEFAULT_SETTINGS.collapsedGroups]),
  }),
  () => ({ ...DEFAULT_SETTINGS, collapsedGroups: [] }),
);

/** Contenitore v1: i singoli bookmark vengono validati a parte per non perdere quelli validi. */
export const storeV1Envelope = z.object({
  version: z.literal(1),
  bookmarks: z.array(z.unknown()),
  tombstones: z.catch(z.array(z.unknown()), () => []),
  settings: z.unknown(),
});

/** Formato pre-rilascio (v0): senza `version`, posizione piatta, nessun contesto. */
export const legacyV0Schema = z.object({
  bookmarks: z.array(
    z.object({
      id: z.optional(nonEmpty),
      file: z.optional(nonEmpty),
      filePath: z.optional(nonEmpty),
      name: nonEmpty,
      line: nonNegativeInt,
      ch: z.optional(nonNegativeInt),
      createdAt: z.optional(isoDate),
      updatedAt: z.optional(isoDate),
    }),
  ),
});
