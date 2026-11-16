// Background Service Worker for Civitai Model Info & Media Saver v1.6

const SETTINGS_VERSION = 3;

const DEFAULT_SETTINGS = {
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
  saveMode: "direct_documents",
  folderPreset: "lora_title_only",
  rootFolder: "civitred",
  updateMasterCatalogOnSave: true
};

const pendingDownloadById = new Map();
const pendingDownloadByUrl = new Map();

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  let forcedPath = null;

  if (pendingDownloadById.has(item.id)) {
    forcedPath = pendingDownloadById.get(item.id);
    pendingDownloadById.delete(item.id);
  } else if (item.url && pendingDownloadByUrl.has(item.url)) {
    const queue = pendingDownloadByUrl.get(item.url);
    if (Array.isArray(queue) && queue.length > 0) {
      forcedPath = queue.shift();
      if (queue.length === 0) pendingDownloadByUrl.delete(item.url);
    }
  } else if (item.finalUrl && pendingDownloadByUrl.has(item.finalUrl)) {
    const queue = pendingDownloadByUrl.get(item.finalUrl);
    if (Array.isArray(queue) && queue.length > 0) {
      forcedPath = queue.shift();
      if (queue.length === 0) pendingDownloadByUrl.delete(item.finalUrl);
    }
  }

  if (forcedPath) {
    suggest({
      filename: forcedPath,
      conflictAction: "overwrite"
    });
  }
});

async function ensureMigratedSettings() {
  const stored = await chrome.storage.local.get(["cisSettings", "cisDatabase"]);
  let settings = stored.cisSettings;
  if (!settings || settings.settingsVersion !== SETTINGS_VERSION) {
    settings = {
      ...DEFAULT_SETTINGS,
      ...(settings || {}),
      settingsVersion: SETTINGS_VERSION,
      rootFolder: "civitred",
      folderPreset: "lora_title_only",
      saveMode: "direct_documents"
    };
    await chrome.storage.local.set({ cisSettings: settings });
  } else {
    settings = { ...DEFAULT_SETTINGS, ...settings };
  }
  if (!stored.cisDatabase) {
    await chrome.storage.local.set({ cisDatabase: [] });
  }
  return settings;
}

chrome.runtime.onInstalled.addListener(() => {
  ensureMigratedSettings();
});

function sanitizeSegment(str, maxLen = 100) {
  if (!str) return "Unknown";
  const cleaned = String(str)
    .replace(/[<>:"/\\|?*#%&+\x00-\x1F\x7F]/g, " - ")
    .replace(/[\[\]]/g, "(")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s-]+|[.\s-]+$/g, "");
  return (cleaned || "Unknown").slice(0, maxLen).trim().replace(/[.\s-]+$/g, "");
}

function sanitizeFilenamePreservingExt(filename, maxStemLen = 85) {
  if (!filename) return "file";
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === filename.length - 1) {
    return sanitizeSegment(filename, maxStemLen);
  }
  const stem = sanitizeSegment(filename.slice(0, lastDot), maxStemLen);
  const ext = filename
    .slice(lastDot + 1)
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()
    .slice(0, 10);
  return ext ? `${stem}.${ext}` : stem;
}

function getFileStem(filename) {
  if (!filename) return "model";
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0) return sanitizeSegment(filename, 80);
  return sanitizeSegment(filename.slice(0, lastDot), 80);
}

function buildTargetSubfolder(payload, settings) {
  const root = sanitizeSegment(settings.rootFolder || "civitred", 50);
  const baseModel = sanitizeSegment(payload.baseModel || "Unknown_Base", 40);
  const title = sanitizeSegment(payload.title || "Untitled_Model", 80);
  const versionName = sanitizeSegment(payload.versionName || "v1", 35);
  const fileStem = getFileStem(payload.fileName || `${title}_${versionName}`);

  switch (settings.folderPreset) {
    case "lora_title_version":
      return `${root}/${title} (${versionName})`;
    case "base_and_lora_title":
      return `${root}/${baseModel}/${title}`;
    case "filename_only":
      return `${root}/${fileStem}`;
    case "lora_title_only":
    default:
      return `${root}/${title}`;
  }
}

function removeFromPendingUrlQueue(url, normalizedFilename) {
  const queue = pendingDownloadByUrl.get(url);
  if (!Array.isArray(queue)) return;
  const idx = queue.indexOf(normalizedFilename);
  if (idx >= 0) queue.splice(idx, 1);
  if (queue.length === 0) pendingDownloadByUrl.delete(url);
}

function downloadWithForcedSubfolder(url, filename) {
  const parts = filename.split("/").filter(Boolean);
  const normalizedFilename = parts
    .map((part, idx) =>
      idx === parts.length - 1 ? sanitizeFilenamePreservingExt(part, 95) : sanitizeSegment(part, 85)
    )
    .filter(Boolean)
    .join("/");

  const existingQueue = pendingDownloadByUrl.get(url) || [];
  existingQueue.push(normalizedFilename);
  pendingDownloadByUrl.set(url, existingQueue);

  return new Promise((resolve) => {
    chrome.downloads.download(
      {
        url,
        filename: normalizedFilename,
        conflictAction: "overwrite",
        saveAs: false
      },
      (downloadId) => {
        if (chrome.runtime.lastError || !downloadId) {
          removeFromPendingUrlQueue(url, normalizedFilename);
          resolve({
            ok: false,
            error: chrome.runtime.lastError ? chrome.runtime.lastError.message : "Download failed"
          });
        } else {
          pendingDownloadById.set(downloadId, normalizedFilename);
          resolve({ ok: true, downloadId });
        }
      }
    );
  });
}

function encodeTextAsDataUrl(text, mimeType = "text/plain;charset=utf-8") {
  const utf8Bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < utf8Bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, utf8Bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);
  return `data:${mimeType};base64,${base64}`;
}

async function fetchUrlAsBase64(url) {
  const resp = await fetch(url, { credentials: "omit" });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  const contentLen = Number(resp.headers.get("content-length") || "0");
  if (contentLen > 35 * 1024 * 1024) {
    throw new Error("FILE_TOO_LARGE_FOR_IPC");
  }
  const buf = await resp.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes.length < 128) {
    throw new Error("Empty or invalid media response");
  }
  if (bytes.length > 35 * 1024 * 1024) {
    throw new Error("FILE_TOO_LARGE_FOR_IPC");
  }
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return {
    base64: btoa(binary),
    contentType: resp.headers.get("content-type") || "application/octet-stream"
  };
}

async function saveRecordToLocalDatabase(payload, subfolder) {
  const stored = await chrome.storage.local.get(["cisDatabase"]);
  const db = Array.isArray(stored.cisDatabase) ? stored.cisDatabase : [];
  const recordKey = `${payload.modelId || "dom"}_${payload.versionId || payload.versionName || "v1"}`;

  const compactRecord = {
    key: recordKey,
    savedAt: new Date().toISOString(),
    modelId: payload.modelId,
    versionId: payload.versionId,
    title: payload.title,
    versionName: payload.versionName,
    fileName: payload.fileName,
    rawStorageFileName: payload.rawStorageFileName || payload.fileName,
    fileSizeFormatted: payload.fileSizeFormatted,
    fileFormat: payload.fileFormat,
    triggerWords: payload.triggerWords || [],
    modelType: payload.modelType,
    baseModel: payload.baseModel,
    training: payload.training,
    usageTips: payload.usageTips,
    hashes: payload.hashes || {},
    air: payload.air,
    publishedAt: payload.publishedAt,
    stats: payload.stats || {},
    reviews: payload.reviews,
    creator: payload.creator,
    tags: payload.tags || [],
    pageUrl: payload.pageUrl,
    descriptionText: (payload.descriptionText || "").slice(0, 8000),
    versionDescriptionText: (payload.versionDescriptionText || "").slice(0, 4000),
    detailsTableExtras: payload.detailsTableExtras || {},
    mediaCount: (payload.media || []).length,
    videoCount: (payload.media || []).filter((m) => m.isVideo).length,
    previewUrl: payload.media && payload.media[0] ? payload.media[0].displayUrl || payload.media[0].downloadUrl : "",
    localSubfolder: subfolder
  };

  const existingIdx = db.findIndex((item) => item.key === recordKey);
  if (existingIdx >= 0) {
    db[existingIdx] = compactRecord;
  } else {
    db.unshift(compactRecord);
  }

  await chrome.storage.local.set({ cisDatabase: db });
  return db.length;
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIdx = 0;

  async function runWorker() {
    while (nextIdx < items.length) {
      const i = nextIdx++;
      results[i] = await worker(items[i], i);
    }
  }

  const workers = [];
  const count = Math.min(concurrency, items.length);
  for (let w = 0; w < count; w++) {
    workers.push(runWorker());
  }
  await Promise.all(workers);
  return results;
}

async function handleSaveModelPackageViaDownloads(payload, customSettings) {
  const baseSettings = await ensureMigratedSettings();
  const settings = { ...baseSettings, ...(customSettings || {}) };
  const subfolder = buildTargetSubfolder(payload, settings);
  const loraStem = sanitizeSegment(payload.title || "LoRA_Model", 75);
  const fileStem = getFileStem(payload.fileName || `${payload.title}_${payload.versionName}`);

  const results = {
    subfolder: `Downloads/${subfolder}`,
    filesSaved: 0,
    mediaSaved: 0,
    skippedMedia: 0,
    errors: []
  };

  if (settings.saveMedia && Array.isArray(payload.media)) {
    const mediaTasks = [];
    for (let i = 0; i < payload.media.length; i++) {
      const item = payload.media[i];
      if (item.isVideo && !settings.includeVideos) continue;
      mediaTasks.push({ item, index: i });
    }

    await runWithConcurrency(mediaTasks, 4, async ({ item, index }) => {
      const idxStr = String(index + 1).padStart(2, "0");
      const ext = item.extension || (item.isVideo ? "mp4" : "jpeg");
      const mediaFilename = item.localFileName || `${idxStr}_${loraStem}.${ext}`;

      const candidates =
        Array.isArray(item.candidateUrls) && item.candidateUrls.length > 0
          ? item.candidateUrls
          : [item.downloadUrl, item.fallbackUrl, item.displayUrl].filter(Boolean);

      let dlRes = { ok: false, error: "No URL" };
      for (const candUrl of candidates) {
        dlRes = await downloadWithForcedSubfolder(candUrl, `${subfolder}/${mediaFilename}`);
        if (dlRes.ok) break;
      }

      if (dlRes.ok) {
        results.mediaSaved++;
      } else {
        results.errors.push(`Media #${idxStr}: ${dlRes.error}`);
      }
    });

    if (settings.saveWebuiPreview) {
      const firstImg = payload.media.find((m) => !m.isVideo) || payload.media[0];
      if (firstImg) {
        const previewUrl = firstImg.downloadUrl || firstImg.posterUrl || firstImg.displayUrl;
        const previewExt = firstImg.isVideo ? "jpeg" : firstImg.extension || "jpeg";
        if (previewUrl) {
          await downloadWithForcedSubfolder(previewUrl, `${subfolder}/${fileStem}.preview.${previewExt}`);
        }
      }
    }
  }

  if (settings.saveTxt && payload.generatedFiles && payload.generatedFiles.txt) {
    const url = encodeTextAsDataUrl(payload.generatedFiles.txt, "text/plain;charset=utf-8");
    const res = await downloadWithForcedSubfolder(url, `${subfolder}/${loraStem}.txt`);
    if (res.ok) results.filesSaved++;
    else results.errors.push(`TXT: ${res.error}`);
  }

  if (settings.saveMd && payload.generatedFiles && payload.generatedFiles.md) {
    const url = encodeTextAsDataUrl(payload.generatedFiles.md, "text/markdown;charset=utf-8");
    const res = await downloadWithForcedSubfolder(url, `${subfolder}/${loraStem}.md`);
    if (res.ok) results.filesSaved++;
    else results.errors.push(`MD: ${res.error}`);
  }

  if (settings.saveJson && payload.generatedFiles && payload.generatedFiles.json) {
    const url = encodeTextAsDataUrl(payload.generatedFiles.json, "application/json;charset=utf-8");
    const res = await downloadWithForcedSubfolder(url, `${subfolder}/${loraStem}.json`);
    if (res.ok) results.filesSaved++;
    else results.errors.push(`JSON: ${res.error}`);

    if (settings.saveCivitaiInfo && payload.generatedFiles.civitaiInfo) {
      const civUrl = encodeTextAsDataUrl(payload.generatedFiles.civitaiInfo, "application/json;charset=utf-8");
      const civRes = await downloadWithForcedSubfolder(civUrl, `${subfolder}/${fileStem}.civitai.info`);
      if (civRes.ok) results.filesSaved++;
    }
  }

  if (settings.saveHtml && payload.generatedFiles && payload.generatedFiles.html) {
    const url = encodeTextAsDataUrl(payload.generatedFiles.html, "text/html;charset=utf-8");
    const res = await downloadWithForcedSubfolder(url, `${subfolder}/${loraStem}.html`);
    if (res.ok) results.filesSaved++;
    else results.errors.push(`HTML: ${res.error}`);
  }

  const totalInDb = await saveRecordToLocalDatabase(payload, results.subfolder);
  results.totalInDb = totalInDb;

  return results;
}

async function checkExistingModelInDbAndDownloads({ modelId, versionId, title, rootFolder }) {
  const stored = await chrome.storage.local.get(["cisDatabase"]);
  const db = Array.isArray(stored.cisDatabase) ? stored.cisDatabase : [];

  const exactMatch = db.find(
    (r) =>
      String(r.modelId || "") === String(modelId || "") &&
      (!versionId || String(r.versionId || "") === String(versionId || ""))
  );
  const otherVersionMatches = db.filter(
    (r) =>
      String(r.modelId || "") === String(modelId || "") &&
      versionId &&
      String(r.versionId || "") !== String(versionId || "")
  );

  let downloadMatches = [];
  try {
    const safeTitle = sanitizeSegment(title || "", 60);
    const safeRoot = sanitizeSegment(rootFolder || "civitred", 40);
    if (safeTitle && safeTitle !== "Unknown") {
      const found = await chrome.downloads.search({
        query: [safeTitle],
        exists: true,
        state: "complete",
        limit: 40
      });
      const rootLower = safeRoot.toLowerCase();
      const titleLower = safeTitle.toLowerCase();
      downloadMatches = (found || []).filter((d) => {
        const fn = String(d.filename || "").toLowerCase();
        return fn.includes(titleLower) && (fn.includes(rootLower) || fn.includes("civitai"));
      });
    }
  } catch (e) {
    // Ignore downloads search errors
  }

  return {
    inDbExact: exactMatch || null,
    inDbOtherVersions: otherVersionMatches.map((m) => ({
      versionId: m.versionId,
      versionName: m.versionName,
      savedAt: m.savedAt,
      localSubfolder: m.localSubfolder
    })),
    downloadFilesCount: downloadMatches.length
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CIS_SAVE_PACKAGE") {
    handleSaveModelPackageViaDownloads(message.payload, message.settings)
      .then((res) => sendResponse({ ok: true, result: res }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (message.type === "CIS_RECORD_DB_ONLY") {
    saveRecordToLocalDatabase(message.payload, message.subfolder)
      .then((totalInDb) => sendResponse({ ok: true, totalInDb }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (message.type === "CIS_CHECK_EXISTING") {
    checkExistingModelInDbAndDownloads(message.query || {})
      .then((res) => sendResponse({ ok: true, ...res }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (message.type === "CIS_DELETE_DB_RECORD") {
    chrome.storage.local.get(["cisDatabase"], async (stored) => {
      const db = Array.isArray(stored.cisDatabase) ? stored.cisDatabase : [];
      const nextDb = db.filter((item) => item.key !== message.key);
      await chrome.storage.local.set({ cisDatabase: nextDb });
      sendResponse({ ok: true, totalInDb: nextDb.length });
    });
    return true;
  }

  if (message.type === "CIS_FETCH_MEDIA_BASE64") {
    fetchUrlAsBase64(message.url)
      .then((res) => sendResponse({ ok: true, ...res }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (message.type === "CIS_OPEN_DATABASE") {
    chrome.tabs.create({ url: chrome.runtime.getURL("database.html") });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "CIS_EXPORT_FILE") {
    const url = encodeTextAsDataUrl(message.content, message.mimeType || "text/plain;charset=utf-8");
    downloadWithForcedSubfolder(url, message.filename).then((res) => sendResponse(res));
    return true;
  }
});
