import {
  detectMediaMagicBytes,
  inferExtFromContentTypeOrUrl,
  isValidMediaContentType
} from "../shared/folders.js";
import {
  buildSafeMediaFilename,
  sanitizeFilenamePreservingExt,
  sanitizeSegment
} from "../shared/sanitize.js";

const IDB_NAME = "CivitaiInfoSaverExtFS";
const IDB_STORE = "handles";
const ROOT_CONFIG_KEY = "rootConfig";
const WEIGHT_EXT_RE = /\.(safetensors|ckpt|pt|bin|pth|gguf|onnx)$/i;
const MEDIA_EXT_RE = /\.(jpe?g|png|webp|gif|avif|mp4|webm|mov)$/i;

let cachedDbPromise = null;

function openExtHandleDb() {
  if (cachedDbPromise) return cachedDbPromise;
  cachedDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        cachedDbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      cachedDbPromise = null;
      reject(req.error);
    };
  });
  return cachedDbPromise;
}

export async function loadRootConfig() {
  try {
    const db = await openExtHandleDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(ROOT_CONFIG_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

export async function saveRootConfig(config) {
  const db = await openExtHandleDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(config, ROOT_CONFIG_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function computeDisplayRootPath(pickedName, rootFolderName) {
  const safeRoot = sanitizeSegment(rootFolderName || "civitred", 50);
  if (!pickedName) return safeRoot;
  if (pickedName.toLowerCase() === safeRoot.toLowerCase()) {
    return pickedName;
  }
  return `${pickedName}/${safeRoot}`;
}

/**
 * Prompts the user via File System Access API inside the extension origin.
 */
export async function pickRootDirectory(rootFolderName = "civitred") {
  if (!globalThis.showDirectoryPicker) {
    throw new Error("File System Access API is unavailable in this browser context.");
  }
  const pickedHandle = await globalThis.showDirectoryPicker({
    id: "civitred_archive_root",
    mode: "readwrite",
    startIn: "documents"
  });
  const safeRoot = sanitizeSegment(rootFolderName || "civitred", 50);
  const config = {
    pickedHandle,
    pickedName: pickedHandle.name,
    savedAt: new Date().toISOString()
  };
  await saveRootConfig(config);

  // Ensure target root subfolder exists right away while user gesture is active
  await resolveTargetRootHandle(safeRoot, { create: true });

  return {
    pickedName: pickedHandle.name,
    rootName: safeRoot,
    displayRootPath: computeDisplayRootPath(pickedHandle.name, safeRoot)
  };
}

export async function getStoredDirInfo(rootFolderName = "civitred") {
  const safeRoot = sanitizeSegment(rootFolderName || "civitred", 50);
  const config = await loadRootConfig();
  if (!config || !config.pickedHandle) {
    return {
      configured: false,
      permission: "none",
      pickedName: "",
      displayRootPath: safeRoot
    };
  }
  try {
    const rwPerm = await config.pickedHandle.queryPermission({ mode: "readwrite" });
    const rPerm = rwPerm === "granted" ? "granted" : await config.pickedHandle.queryPermission({ mode: "read" });
    return {
      configured: true,
      permission: rwPerm === "granted" ? "readwrite" : rPerm === "granted" ? "read" : rwPerm,
      pickedName: config.pickedName || config.pickedHandle.name,
      displayRootPath: computeDisplayRootPath(config.pickedName || config.pickedHandle.name, safeRoot)
    };
  } catch (e) {
    return {
      configured: false,
      permission: "none",
      pickedName: "",
      displayRootPath: safeRoot
    };
  }
}

export async function authorizeStoredDir() {
  const config = await loadRootConfig();
  if (!config || !config.pickedHandle) {
    throw new Error("No stored folder handle found.");
  }
  const perm = await config.pickedHandle.requestPermission({ mode: "readwrite" });
  return perm === "granted";
}

export async function resolveTargetRootHandle(rootFolderName = "civitred", { create = false } = {}) {
  const config = await loadRootConfig();
  if (!config || !config.pickedHandle) {
    return { handle: null, permission: "none", displayRootPath: "" };
  }
  const mode = create ? "readwrite" : "read";
  let perm;
  try {
    perm = await config.pickedHandle.queryPermission({ mode });
  } catch (e) {
    return { handle: null, permission: "none", displayRootPath: "" };
  }
  if (perm !== "granted") {
    return {
      handle: null,
      permission: perm,
      displayRootPath: computeDisplayRootPath(config.pickedName || config.pickedHandle.name, rootFolderName)
    };
  }

  const safeRoot = sanitizeSegment(rootFolderName || "civitred", 50);
  const pickedHandle = config.pickedHandle;
  const targetHandle =
    pickedHandle.name.toLowerCase() === safeRoot.toLowerCase()
      ? pickedHandle
      : await pickedHandle.getDirectoryHandle(safeRoot, { create });

  return {
    handle: targetHandle,
    permission: "granted",
    displayRootPath: computeDisplayRootPath(pickedHandle.name, safeRoot)
  };
}

export async function ensureSubfolderChain(rootHandle, folderParts, { create = false } = {}) {
  let dir = rootHandle;
  for (const part of folderParts) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

export async function writeTextFileToDir(dirHandle, filename, textContent) {
  const safeName = sanitizeFilenamePreservingExt(filename, 95);
  const fileHandle = await dirHandle.getFileHandle(safeName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(textContent);
    await writable.close();
    return safeName;
  } catch (err) {
    await writable.abort().catch(() => {});
    throw err;
  }
}

function replaceFilenameExtension(filename, newExt) {
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const cleanExt = String(newExt || "jpeg").replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "jpeg";
  return sanitizeFilenamePreservingExt(`${stem}.${cleanExt}`, 95);
}

/**
 * Streams a fetch Response directly into FileSystemWritableFileStream with Content-Type and magic-byte validation.
 * Avoids full-file memory buffering and supports AbortSignal + incremental byte progress.
 */
export async function streamResponseToDir(
  dirHandle,
  baseFilename,
  response,
  { isVideo = false, defaultExt = "jpeg", signal = null, onChunk = null } = {}
) {
  const contentType = response.headers.get("content-type") || "";
  if (!isValidMediaContentType(contentType, isVideo)) {
    throw new Error(`Invalid Content-Type (${contentType}) for media`);
  }
  if (!response.body) {
    throw new Error("Empty response body");
  }

  const reader = response.body.getReader();
  let writable = null;
  let finalFilename = null;
  let actualExt = defaultExt;
  let totalBytes = 0;

  try {
    const first = await reader.read();
    if (first.done || !first.value || first.value.byteLength === 0) {
      throw new Error("Empty media response");
    }
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const firstChunk = first.value;
    const magic = detectMediaMagicBytes(firstChunk);
    if (!magic.valid) {
      throw new Error(magic.reason || "Invalid media file signature");
    }

    actualExt = inferExtFromContentTypeOrUrl(contentType, response.url, defaultExt, isVideo, magic.ext);
    finalFilename = replaceFilenameExtension(baseFilename, actualExt);

    const fileHandle = await dirHandle.getFileHandle(finalFilename, { create: true });
    writable = await fileHandle.createWritable();

    await writable.write(firstChunk);
    totalBytes += firstChunk.byteLength;
    if (onChunk) onChunk(firstChunk.byteLength);

    while (true) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        await writable.write(value);
        totalBytes += value.byteLength;
        if (onChunk) onChunk(value.byteLength);
      }
    }

    if (totalBytes <= 128) {
      throw new Error("Downloaded media is unexpectedly small");
    }

    await writable.close();
    return { writtenName: finalFilename, actualExt, totalBytes };
  } catch (err) {
    await reader.cancel().catch(() => {});
    if (writable) {
      await writable.abort().catch(() => {});
    }
    if (finalFilename) {
      await dirHandle.removeEntry(finalFilename).catch(() => {});
    }
    throw err;
  }
}

export async function readCisManifest(dirHandle) {
  try {
    const fh = await dirHandle.getFileHandle(".cis-manifest.json", { create: false });
    const f = await fh.getFile();
    const parsed = JSON.parse(await f.text());
    if (parsed && typeof parsed === "object") {
      return {
        schemaVersion: 1,
        modelId: parsed.modelId || null,
        versionId: parsed.versionId || null,
        versionName: parsed.versionName || "",
        savedAt: parsed.savedAt || "",
        mediaByUuid: parsed.mediaByUuid && typeof parsed.mediaByUuid === "object" ? parsed.mediaByUuid : {}
      };
    }
  } catch (e) {
    // Missing or unreadable manifest
  }
  return { schemaVersion: 1, modelId: null, versionId: null, versionName: "", savedAt: "", mediaByUuid: {} };
}

export async function writeCisManifest(dirHandle, manifest) {
  await writeTextFileToDir(dirHandle, ".cis-manifest.json", JSON.stringify(manifest, null, 2));
}

export async function findExistingMediaInDir(dirHandle, indexZeroBased, loraStem, preferredExt, isVideo, uuid, manifest) {
  if (uuid && manifest?.mediaByUuid?.[uuid]) {
    const mappedName = manifest.mediaByUuid[uuid];
    try {
      const fh = await dirHandle.getFileHandle(mappedName, { create: false });
      const file = await fh.getFile();
      if (file && file.size > 128) {
        const dot = mappedName.lastIndexOf(".");
        const ext = dot > 0 ? mappedName.slice(dot + 1).toLowerCase() : preferredExt;
        return { filename: mappedName, ext, matchedBy: "uuid" };
      }
    } catch (e) {
      // Mapped file was removed; continue to stem check
    }
  }

  const exts = isVideo
    ? [preferredExt || "mp4", "mp4", "webm", "mov"]
    : [preferredExt || "jpeg", "jpeg", "jpg", "png", "webp", "gif", "avif"];
  const uniqueExts = Array.from(new Set(exts.filter(Boolean)));
  for (const ext of uniqueExts) {
    const candidate = buildSafeMediaFilename(indexZeroBased, loraStem, ext);
    try {
      const fh = await dirHandle.getFileHandle(candidate, { create: false });
      const file = await fh.getFile();
      if (file && file.size > 128) {
        return { filename: candidate, ext, matchedBy: "index" };
      }
    } catch (e) {
      // Not found
    }
  }
  return null;
}

export async function inspectExistingFolderFiles(rootFolderName, folderParts) {
  const resolved = await resolveTargetRootHandle(rootFolderName, { create: false });
  if (!resolved.handle) {
    return {
      configured: Boolean(resolved.displayRootPath),
      permissionRequired: true,
      displayRootPath: resolved.displayRootPath,
      exists: false,
      totalFiles: 0,
      infoExts: [],
      mediaCount: 0,
      hasWeights: false
    };
  }

  let dir;
  try {
    dir = await ensureSubfolderChain(resolved.handle, folderParts, { create: false });
  } catch (e) {
    return {
      configured: true,
      permissionRequired: false,
      displayRootPath: resolved.displayRootPath,
      displayPath: `${resolved.displayRootPath}/${folderParts.join("/")}`,
      exists: false,
      totalFiles: 0,
      infoExts: [],
      mediaCount: 0,
      hasWeights: false
    };
  }

  let totalFiles = 0;
  let mediaCount = 0;
  let hasWeights = false;
  const infoExts = [];
  let manifest = null;

  try {
    for await (const entry of dir.values()) {
      if (entry.kind !== "file") continue;
      if (entry.name === ".cis-manifest.json") {
        manifest = await readCisManifest(dir);
        continue;
      }
      totalFiles++;
      const low = entry.name.toLowerCase();
      if (low.endsWith(".html")) infoExts.push("HTML");
      else if (low.endsWith(".md")) infoExts.push("MD");
      else if (low.endsWith(".txt")) infoExts.push("TXT");
      else if (low.endsWith(".json")) infoExts.push("JSON");
      else if (low.endsWith(".civitai.info")) infoExts.push(".info");
      else if (MEDIA_EXT_RE.test(low)) mediaCount++;
      else if (WEIGHT_EXT_RE.test(low)) hasWeights = true;
    }
  } catch (e) {
    return {
      configured: true,
      permissionRequired: false,
      displayRootPath: resolved.displayRootPath,
      displayPath: `${resolved.displayRootPath}/${folderParts.join("/")}`,
      exists: true,
      totalFiles: 0,
      infoExts: [],
      mediaCount: 0,
      hasWeights: false
    };
  }

  return {
    configured: true,
    permissionRequired: false,
    displayRootPath: resolved.displayRootPath,
    displayPath: `${resolved.displayRootPath}/${folderParts.join("/")}`,
    exists: totalFiles > 0,
    totalFiles,
    infoExts: Array.from(new Set(infoExts)),
    mediaCount,
    hasWeights,
    manifestVersionId: manifest?.versionId || null
  };
}

/**
 * Scans the local archive root (up to 2 levels deep) to discover saved models and weight files for DB sync.
 */
export async function scanRootFolderForSync(rootFolderName = "civitred") {
  const resolved = await resolveTargetRootHandle(rootFolderName, { create: false });
  if (!resolved.handle) {
    throw new Error("Local archive folder is not authorized.");
  }

  const discovered = [];

  async function inspectModelDir(dirHandle, relPath) {
    const files = [];
    for await (const entry of dirHandle.values()) {
      if (entry.kind === "file") files.push(entry);
    }
    if (files.length === 0) return;

    const jsonEntry =
      files.find((f) => f.name.endsWith(".json") && !f.name.startsWith(".cis-manifest")) ||
      files.find((f) => f.name.endsWith(".civitai.info"));
    if (!jsonEntry) return;

    try {
      const file = await jsonEntry.getFile();
      const raw = JSON.parse(await file.text());
      const hasWeightsOnDisk = files.some((f) => WEIGHT_EXT_RE.test(f.name));
      const mediaFiles = files.filter((f) => MEDIA_EXT_RE.test(f.name));
      const videoFiles = files.filter((f) => /\.(mp4|webm|mov)$/i.test(f.name));

      // Normalize both full payload JSON and .civitai.info format
      const isFullPayload = Boolean(raw.title || raw.versionName || raw.media);
      const modelId = raw.modelId || raw.model?.id || null;
      const versionId = raw.versionId || raw.id || null;

      const candidate = isFullPayload
        ? {
            ...raw,
            hasWeightsOnDisk,
            mediaCount: Array.isArray(raw.media) ? raw.media.length : mediaFiles.length,
            videoCount: Array.isArray(raw.media)
              ? raw.media.filter((m) => m.isVideo).length
              : videoFiles.length
          }
        : {
            modelId,
            versionId,
            title: raw.model?.name || dirHandle.name,
            versionName: raw.name || "v1.0",
            fileName: raw.files?.[0]?.name || "",
            triggerWords: raw.trainedWords || [],
            modelType: raw.model?.type || "LORA",
            baseModel: raw.baseModel || "Unknown",
            hashes: raw.files?.[0]?.hashes || {},
            tags: raw.model?.tags || [],
            media: (raw.images || []).map((img) => ({
              displayUrl: img.url,
              downloadUrl: img.url,
              isVideo: img.type === "video"
            })),
            hasWeightsOnDisk,
            pageUrl: modelId ? `https://civitai.com/models/${modelId}?modelVersionId=${versionId || ""}` : ""
          };

      discovered.push({
        payload: candidate,
        subfolder: `${resolved.displayRootPath}/${relPath}`
      });
    } catch (e) {
      // Skip malformed JSON
    }
  }

  for await (const entry of resolved.handle.values()) {
    if (entry.kind !== "directory") continue;
    await inspectModelDir(entry, entry.name);
    for await (const sub of entry.values()) {
      if (sub.kind === "directory") {
        await inspectModelDir(sub, `${entry.name}/${sub.name}`);
      }
    }
  }

  return {
    displayRootPath: resolved.displayRootPath,
    discovered
  };
}
