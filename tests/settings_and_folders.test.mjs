import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTargetSubfolder,
  detectMediaMagicBytes,
  getRelativeLoraFolderParts,
  inferExtFromContentTypeOrUrl,
  isCivitaiModelUrl,
  isValidMediaContentType
} from "../src/shared/folders.js";
import { migrateSettings, SETTINGS_VERSION } from "../src/shared/settings.js";

test("migrateSettings preserves existing user settings from older versions", () => {
  const legacy = {
    settingsVersion: 3,
    rootFolder: "my_loras",
    folderPreset: "base_and_lora_title",
    saveMode: "downloads_subfolder",
    saveHtml: false,
    saveWebuiPreview: true
  };
  const migrated = migrateSettings(legacy);
  assert.equal(migrated.settingsVersion, SETTINGS_VERSION);
  assert.equal(migrated.rootFolder, "my_loras");
  assert.equal(migrated.folderPreset, "base_and_lora_title");
  assert.equal(migrated.saveMode, "downloads_subfolder");
  assert.equal(migrated.saveHtml, false);
  assert.equal(migrated.saveWebuiPreview, true);
  assert.equal(migrated.obsidianFrontmatter, true);

  // Even when settingsVersion is missing (e.g. legacy partial write)
  const noVer = migrateSettings({ rootFolder: "custom_dir", saveMd: false });
  assert.equal(noVer.rootFolder, "custom_dir");
  assert.equal(noVer.saveMd, false);
  assert.equal(noVer.settingsVersion, SETTINGS_VERSION);
});

test("folder presets and model URL detection work across civitai mirrors", () => {
  assert.equal(isCivitaiModelUrl("https://civitai.com/models/12345/demo"), true);
  assert.equal(isCivitaiModelUrl("https://civitai.red/models/99"), true);
  assert.equal(isCivitaiModelUrl("https://civitai.green/models/1"), true);
  assert.equal(isCivitaiModelUrl("https://civitai.com/images"), false);

  const payload = { title: "[Flux] Neon", baseModel: "Flux.1 D", versionName: "v2", fileName: "neon_v2.safetensors" };
  assert.deepEqual(getRelativeLoraFolderParts(payload, { folderPreset: "lora_title_only" }), ["(Flux) Neon"]);
  assert.deepEqual(getRelativeLoraFolderParts(payload, { folderPreset: "base_and_lora_title" }), ["Flux.1 D", "(Flux) Neon"]);
  assert.equal(buildTargetSubfolder(payload, { rootFolder: "archive", folderPreset: "lora_title_version" }), "archive/(Flux) Neon (v2)");
});

test("isValidMediaContentType and detectMediaMagicBytes reject HTML error payloads", () => {
  assert.equal(isValidMediaContentType("text/html; charset=utf-8", false), false);
  assert.equal(isValidMediaContentType("application/json", true), false);
  assert.equal(isValidMediaContentType("image/webp", false), true);
  assert.equal(isValidMediaContentType("video/mp4", true), true);

  const htmlBytes = new TextEncoder().encode("<!DOCTYPE html><html><body>Cloudflare</body></html>");
  assert.equal(detectMediaMagicBytes(htmlBytes).valid, false);

  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
  const jpgSig = detectMediaMagicBytes(jpegBytes);
  assert.equal(jpgSig.valid, true);
  assert.equal(jpgSig.ext, "jpeg");

  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  assert.equal(detectMediaMagicBytes(pngBytes).ext, "png");

  const mp4Bytes = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  assert.equal(detectMediaMagicBytes(mp4Bytes).ext, "mp4");

  assert.equal(inferExtFromContentTypeOrUrl("image/jpeg", "https://cdn/pic", "png", false, "webp"), "webp");
});
