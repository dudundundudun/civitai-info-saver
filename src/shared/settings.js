export const SETTINGS_VERSION = 4;

export const VALID_SAVE_MODES = new Set(["direct_documents", "downloads_subfolder"]);
export const VALID_FOLDER_PRESETS = new Set([
  "lora_title_only",
  "lora_title_version",
  "base_and_lora_title",
  "filename_only"
]);
export const VALID_LANGUAGES = new Set(["auto", "en", "ru"]);

export const DEFAULT_SETTINGS = Object.freeze({
  settingsVersion: SETTINGS_VERSION,
  saveHtml: true,
  saveMd: true,
  saveTxt: true,
  saveJson: true,
  saveCivitaiInfo: true,
  saveMedia: true,
  includeVideos: true,
  skipExistingMedia: true,
  saveWebuiPreview: false,
  obsidianFrontmatter: true,
  saveMode: "direct_documents",
  folderPreset: "lora_title_only",
  rootFolder: "civitred",
  language: "auto"
});

const BOOLEAN_KEYS = [
  "saveHtml",
  "saveMd",
  "saveTxt",
  "saveJson",
  "saveCivitaiInfo",
  "saveMedia",
  "includeVideos",
  "skipExistingMedia",
  "saveWebuiPreview",
  "obsidianFrontmatter"
];

/**
 * Non-destructively migrates persisted settings to SETTINGS_VERSION.
 * Always preserves existing user choices from older versions.
 */
export function migrateSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const merged = { ...DEFAULT_SETTINGS };

  for (const key of BOOLEAN_KEYS) {
    if (typeof src[key] === "boolean") {
      merged[key] = src[key];
    }
  }

  if (typeof src.saveMode === "string" && VALID_SAVE_MODES.has(src.saveMode)) {
    merged.saveMode = src.saveMode;
  }
  if (typeof src.folderPreset === "string" && VALID_FOLDER_PRESETS.has(src.folderPreset)) {
    merged.folderPreset = src.folderPreset;
  }
  if (typeof src.rootFolder === "string" && src.rootFolder.trim()) {
    merged.rootFolder = src.rootFolder.trim();
  }
  if (typeof src.language === "string" && VALID_LANGUAGES.has(src.language)) {
    merged.language = src.language;
  }

  merged.settingsVersion = SETTINGS_VERSION;
  return merged;
}

let settingsQueue = Promise.resolve();

function getStorageArea(storageOverride) {
  if (storageOverride) return storageOverride;
  return globalThis.chrome?.storage?.local;
}

export async function getSettings(storageOverride = null) {
  const storage = getStorageArea(storageOverride);
  if (!storage) return { ...DEFAULT_SETTINGS };

  const stored = await storage.get(["cisSettings"]);
  const raw = stored?.cisSettings;
  const migrated = migrateSettings(raw);

  if (!raw || raw.settingsVersion !== SETTINGS_VERSION) {
    await storage.set({ cisSettings: migrated });
  }
  return migrated;
}

export function updateSettings(patch, storageOverride = null) {
  const run = settingsQueue.then(async () => {
    const storage = getStorageArea(storageOverride);
    const current = await getSettings(storage);
    const next = migrateSettings({ ...current, ...(patch || {}) });
    if (storage) {
      await storage.set({ cisSettings: next });
    }
    return next;
  });
  settingsQueue = run.catch(() => {});
  return run;
}
