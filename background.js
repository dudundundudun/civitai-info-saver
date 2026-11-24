import { buildGeneratedFiles } from "./src/exporters/index.js";
import {
  buildTargetSubfolder,
  getRelativeLoraFolderParts,
  isCivitaiModelUrl
} from "./src/shared/folders.js";
import { sanitizeDescriptionHtml } from "./src/shared/htmlSanitizer.js";
import { getMessagesForLang, resolveLang } from "./src/shared/i18n.js";
import {
  buildLoraTag,
  buildSafeMediaFilename,
  getFileStem,
  sanitizeFilenamePreservingExt,
  sanitizeSegment
} from "./src/shared/sanitize.js";
import { getSettings, migrateSettings, updateSettings } from "./src/shared/settings.js";
import {
  buildCsvExport,
  buildStandaloneCatalogHtml,
  deleteRecord,
  getAllRecords,
  importRecords,
  restoreRecord,
  updateRecordMeta,
  upsertRecord
} from "./src/storage/databaseRepo.js";

const PENDING_SESSION_KEY = "cisPendingDownloads";
const ACTIVE_JOBS_SESSION_KEY = "cisActiveJobs";

const pendingById = new Map();
const pendingByUrl = new Map();
let pendingHydrated = false;
let offscreenCreatePromise = null;
const cancelledDownloadJobs = new Set();

async function hydratePendingFromSession() {
  if (pendingHydrated) return;
  try {
    const data = await chrome.storage.session.get([PENDING_SESSION_KEY]);
    const saved = data?.[PENDING_SESSION_KEY];
    if (saved) {
      if (Array.isArray(saved.byId)) {
        for (const [id, fn] of saved.byId) pendingById.set(Number(id), fn);
      }
      if (Array.isArray(saved.byUrl)) {
        for (const [url, list] of saved.byUrl) {
          if (Array.isArray(list) && list.length > 0) pendingByUrl.set(url, [...list]);
        }
      }
    }
  } catch (e) {
    // Ignore session storage errors
  }
  pendingHydrated = true;
}

function persistPendingToSession() {
  const byId = Array.from(pendingById.entries()).slice(-200);
  const byUrl = Array.from(pendingByUrl.entries()).slice(-200);
  chrome.storage.session.set({ [PENDING_SESSION_KEY]: { byId, byUrl } }).catch(() => {});
}

function removeFromPendingUrlQueue(url, normalizedFilename) {
  if (!url) return;
  const queue = pendingByUrl.get(url);
  if (!Array.isArray(queue)) return;
  const idx = queue.indexOf(normalizedFilename);
  if (idx >= 0) queue.splice(idx, 1);
  if (queue.length === 0) pendingByUrl.delete(url);
}

function matchPendingDownload(item) {
  let forcedPath = null;
  if (pendingById.has(item.id)) {
    forcedPath = pendingById.get(item.id);
    pendingById.delete(item.id);
    removeFromPendingUrlQueue(item.url, forcedPath);
    removeFromPendingUrlQueue(item.finalUrl, forcedPath);
  } else if (item.url && pendingByUrl.has(item.url)) {
    const queue = pendingByUrl.get(item.url);
    if (Array.isArray(queue) && queue.length > 0) {
      forcedPath = queue.shift();
      if (queue.length === 0) pendingByUrl.delete(item.url);
    }
  } else if (item.finalUrl && pendingByUrl.has(item.finalUrl)) {
    const queue = pendingByUrl.get(item.finalUrl);
    if (Array.isArray(queue) && queue.length > 0) {
      forcedPath = queue.shift();
      if (queue.length === 0) pendingByUrl.delete(item.finalUrl);
    }
  }
  if (forcedPath) persistPendingToSession();
  return forcedPath;
}

// Register ALL Chrome listeners synchronously at the top level of the service worker
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (item.byExtensionId !== chrome.runtime.id) return false;

  if (pendingHydrated) {
    const forcedPath = matchPendingDownload(item);
    if (forcedPath) {
      suggest({ filename: forcedPath, conflictAction: "overwrite" });
    }
    return false;
  }

  (async () => {
    await hydratePendingFromSession();
    const forcedPath = matchPendingDownload(item);
    if (forcedPath) {
      suggest({ filename: forcedPath, conflictAction: "overwrite" });
    } else {
      suggest();
    }
  })();
  return true;
});

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta?.state?.current) return;
  if (delta.state.current === "complete" || delta.state.current === "interrupted") {
    if (pendingById.has(delta.id)) {
      pendingById.delete(delta.id);
      persistPendingToSession();
    }
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await getSettings();
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "save-current-model") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isCivitaiModelUrl(tab.url)) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "CIS_TRIGGER_SAVE_FROM_POPUP" });
  } catch (e) {
    // Content script not ready
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    if (tab?.url && !isCivitaiModelUrl(tab.url)) {
      chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
    }
  }
});

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL("offscreen.html");
  if (chrome.runtime.getContexts) {
    const existing = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });
    if (existing.length > 0) return;
  }

  if (!offscreenCreatePromise) {
    offscreenCreatePromise = chrome.offscreen
      .createDocument({
        url: "offscreen.html",
        reasons: ["BLOBS"],
        justification: "Stream Civitai media files to the user-selected local directory via File System Access API."
      })
      .catch((err) => {
        if (!String(err?.message || "").includes("Only a single offscreen")) {
          throw err;
        }
      })
      .finally(() => {
        offscreenCreatePromise = null;
      });
  }
  await offscreenCreatePromise;
}

function downloadWithForcedSubfolder(url, filename) {
  const parts = String(filename || "").split("/").filter(Boolean);
  const normalizedFilename = parts
    .map((part, idx) =>
      idx === parts.length - 1 ? sanitizeFilenamePreservingExt(part, 95) : sanitizeSegment(part, 85)
    )
    .filter(Boolean)
    .join("/");

  const existingQueue = pendingByUrl.get(url) || [];
  existingQueue.push(normalizedFilename);
  pendingByUrl.set(url, existingQueue);
  persistPendingToSession();

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
          persistPendingToSession();
          resolve({
            ok: false,
            error: chrome.runtime.lastError ? chrome.runtime.lastError.message : "Download failed"
          });
        } else {
          pendingById.set(downloadId, normalizedFilename);
          persistPendingToSession();
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
  return `data:${mimeType};base64,${btoa(binary)}`;
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

async function updateTabBadge(tabId, status) {
  if (!tabId) return;
  try {
    if (status === "saved") {
      await chrome.action.setBadgeText({ tabId, text: "✓" });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: "#0ca678" });
    } else if (status === "other_version") {
      await chrome.action.setBadgeText({ tabId, text: "v" });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: "#fab005" });
    } else {
      await chrome.action.setBadgeText({ tabId, text: "" });
    }
  } catch (e) {
    // Ignore badge errors on closed tabs
  }
}

function notifyProgress(jobId, originTabId, progress) {
  if (originTabId) {
    chrome.tabs.sendMessage(originTabId, { type: "CIS_SAVE_PROGRESS", jobId, progress }).catch(() => {});
  }
  chrome.runtime
    .sendMessage({ target: "ui", type: "CIS_SAVE_PROGRESS", jobId, originTabId, progress })
    .catch(() => {});
}

function notifySaveDone(jobId, originTabId, payloadSummary) {
  if (originTabId) {
    chrome.tabs.sendMessage(originTabId, { type: "CIS_SAVE_DONE", jobId, ...payloadSummary }).catch(() => {});
  }
  chrome.runtime
    .sendMessage({ target: "ui", type: "CIS_SAVE_DONE", jobId, originTabId, ...payloadSummary })
    .catch(() => {});
}

async function setSessionJobState(jobId, state) {
  try {
    const data = await chrome.storage.session.get([ACTIVE_JOBS_SESSION_KEY]);
    const jobs = data?.[ACTIVE_JOBS_SESSION_KEY] || {};
    if (state === null) delete jobs[jobId];
    else jobs[jobId] = state;
    await chrome.storage.session.set({ [ACTIVE_JOBS_SESSION_KEY]: jobs });
  } catch (e) {
    // Ignore session state errors
  }
}

function enrichPayloadHtml(payload) {
  let baseOrigin = "https://civitai.com";
  try {
    if (payload.pageUrl) baseOrigin = new URL(payload.pageUrl).origin;
  } catch {}
  if (payload.rawDescriptionHtml && !payload.descriptionHtml) {
    payload.descriptionHtml = sanitizeDescriptionHtml(payload.rawDescriptionHtml, baseOrigin);
  }
  if (payload.rawVersionDescriptionHtml && !payload.versionDescriptionHtml) {
    payload.versionDescriptionHtml = sanitizeDescriptionHtml(payload.rawVersionDescriptionHtml, baseOrigin);
  }
  return payload;
}

async function checkExistingDownloadForFile(subfolder, filename) {
  try {
    const normSub = subfolder.replace(/\\/g, "/").toLowerCase();
    const stem = getFileStem(filename).toLowerCase();
    const found = await chrome.downloads.search({
      query: [stem],
      exists: true,
      state: "complete",
      limit: 25
    });
    return (found || []).some((d) => {
      const fn = String(d.filename || "").replace(/\\/g, "/").toLowerCase();
      return fn.includes(normSub) && fn.includes(stem);
    });
  } catch (e) {
    return false;
  }
}

async function handleSaveViaDownloads({ jobId, payload, settings, originTabId, onlyMediaIndices }) {
  await hydratePendingFromSession();
  const subfolder = buildTargetSubfolder(payload, settings);
  const loraStem = sanitizeSegment(payload.title || "LoRA_Model", 75);
  const fileStem = getFileStem(payload.fileName || `${payload.title}_${payload.versionName}`);

  const results = {
    subfolder: `Downloads/${subfolder}`,
    filesSaved: 0,
    mediaSaved: 0,
    skippedMedia: 0,
    bytesDownloaded: 0,
    errors: [],
    failedIndices: []
  };

  const indexFilterSet =
    Array.isArray(onlyMediaIndices) && onlyMediaIndices.length > 0
      ? new Set(onlyMediaIndices.map(Number))
      : null;

  if (settings.saveMedia && Array.isArray(payload.media)) {
    const mediaTasks = [];
    for (let i = 0; i < payload.media.length; i++) {
      const item = payload.media[i];
      if (item.isVideo && !settings.includeVideos) continue;
      if (indexFilterSet && !indexFilterSet.has(i)) continue;
      mediaTasks.push({ item, index: i });
    }

    const total = mediaTasks.length;
    let done = 0;
    const skipExisting = settings.skipExistingMedia !== false && !indexFilterSet;

    await runWithConcurrency(mediaTasks, 4, async ({ item, index }) => {
      if (cancelledDownloadJobs.has(jobId)) return;
      const idxStr = String(index + 1).padStart(2, "0");
      const ext = item.extension || (item.isVideo ? "mp4" : "jpeg");
      const mediaFilename = item.localFileName || buildSafeMediaFilename(index, loraStem, ext);

      if (skipExisting) {
        const exists = await checkExistingDownloadForFile(subfolder, mediaFilename);
        if (exists) {
          item.localFileName = mediaFilename;
          results.skippedMedia++;
          done++;
          notifyProgress(jobId, originTabId, { done, total, skippedMedia: results.skippedMedia, bytesDownloaded: 0 });
          return;
        }
      }

      const candidates =
        Array.isArray(item.candidateUrls) && item.candidateUrls.length > 0
          ? item.candidateUrls
          : [item.downloadUrl, item.fallbackUrl, item.displayUrl].filter(Boolean);

      let dlRes = { ok: false, error: "No valid URL" };
      for (const candUrl of candidates) {
        if (cancelledDownloadJobs.has(jobId)) break;
        dlRes = await downloadWithForcedSubfolder(candUrl, `${subfolder}/${mediaFilename}`);
        if (dlRes.ok) {
          item.localFileName = mediaFilename;
          break;
        }
      }

      if (dlRes.ok) {
        results.mediaSaved++;
      } else if (!cancelledDownloadJobs.has(jobId)) {
        results.errors.push(`Media #${idxStr}: ${dlRes.error}`);
        results.failedIndices.push(index);
      }

      done++;
      notifyProgress(jobId, originTabId, { done, total, skippedMedia: results.skippedMedia, bytesDownloaded: 0 });
    });

    if (cancelledDownloadJobs.has(jobId)) {
      return { ok: false, cancelled: true, result: results };
    }

    if (settings.saveWebuiPreview && !indexFilterSet) {
      const firstImg = payload.media.find((m) => !m.isVideo);
      if (firstImg) {
        const previewUrl = firstImg.downloadUrl || firstImg.displayUrl;
        const previewExt = firstImg.extension || "jpeg";
        if (previewUrl) {
          await downloadWithForcedSubfolder(previewUrl, `${subfolder}/${fileStem}.preview.${previewExt}`);
        }
      } else {
        const firstVideo = payload.media.find((m) => m.isVideo && m.posterUrl);
        if (firstVideo?.posterUrl) {
          await downloadWithForcedSubfolder(firstVideo.posterUrl, `${subfolder}/${fileStem}.preview.jpeg`);
        }
      }
    }
  }

  enrichPayloadHtml(payload);
  const generated = buildGeneratedFiles(payload, loraStem, settings);

  if (!indexFilterSet) {
    if (settings.saveTxt && generated.txt) {
      const res = await downloadWithForcedSubfolder(encodeTextAsDataUrl(generated.txt), `${subfolder}/${loraStem}.txt`);
      if (res.ok) results.filesSaved++;
      else results.errors.push(`TXT: ${res.error}`);
    }
    if (settings.saveMd && generated.md) {
      const res = await downloadWithForcedSubfolder(
        encodeTextAsDataUrl(generated.md, "text/markdown;charset=utf-8"),
        `${subfolder}/${loraStem}.md`
      );
      if (res.ok) results.filesSaved++;
      else results.errors.push(`MD: ${res.error}`);
    }
    if (settings.saveJson && generated.json) {
      const res = await downloadWithForcedSubfolder(
        encodeTextAsDataUrl(generated.json, "application/json;charset=utf-8"),
        `${subfolder}/${loraStem}.json`
      );
      if (res.ok) results.filesSaved++;
      else results.errors.push(`JSON: ${res.error}`);
    }
    if (settings.saveCivitaiInfo && generated.civitaiInfo) {
      const civRes = await downloadWithForcedSubfolder(
        encodeTextAsDataUrl(generated.civitaiInfo, "application/json;charset=utf-8"),
        `${subfolder}/${fileStem}.civitai.info`
      );
      if (civRes.ok) results.filesSaved++;
      else results.errors.push(`civitai.info: ${civRes.error}`);
    }
    if (settings.saveHtml && generated.html) {
      const res = await downloadWithForcedSubfolder(
        encodeTextAsDataUrl(generated.html, "text/html;charset=utf-8"),
        `${subfolder}/${loraStem}.html`
      );
      if (res.ok) results.filesSaved++;
      else results.errors.push(`HTML: ${res.error}`);
    }
  }

  return { ok: true, result: results };
}

async function checkExistingModel(query, tabId) {
  const settings = await getSettings();
  const folderParts = getRelativeLoraFolderParts(query, settings);
  const db = await getAllRecords();

  const exactMatch = db.find(
    (r) =>
      String(r.modelId || "") === String(query.modelId || "") &&
      (!query.versionId || String(r.versionId || "") === String(query.versionId || ""))
  );
  const otherVersionMatches = db.filter(
    (r) =>
      String(r.modelId || "") === String(query.modelId || "") &&
      query.versionId &&
      String(r.versionId || "") !== String(query.versionId || "")
  );

  let downloadMatches = [];
  try {
    const safeTitle = sanitizeSegment(query.title || "", 60);
    const safeRoot = sanitizeSegment(settings.rootFolder || "civitred", 40);
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

  let folderInfo = {
    configured: true,
    permissionRequired: false,
    displayRootPath: `Downloads/${sanitizeSegment(settings.rootFolder || "civitred", 50)}`,
    exists: false,
    totalFiles: 0,
    infoExts: [],
    mediaCount: 0,
    hasWeights: false
  };

  if (settings.saveMode === "direct_documents") {
    try {
      await ensureOffscreenDocument();
      const offRes = await chrome.runtime.sendMessage({
        target: "offscreen",
        type: "CIS_OFFSCREEN_CHECK_DIR",
        rootFolder: settings.rootFolder,
        folderParts
      });
      if (offRes?.ok) {
        folderInfo = {
          ...(offRes.dirInfo || {}),
          ...(offRes.existing || {})
        };
      }
    } catch (e) {
      folderInfo = { configured: false, permissionRequired: true, exists: false, totalFiles: 0, infoExts: [], mediaCount: 0 };
    }
  }

  const isSaved = Boolean(folderInfo.exists || exactMatch || downloadMatches.length > 0);
  if (tabId) {
    updateTabBadge(tabId, isSaved ? "saved" : otherVersionMatches.length > 0 ? "other_version" : "none");
  }

  return {
    settings,
    folderParts,
    loraTag: buildLoraTag(query.fileName, query.usageTips),
    folderInfo,
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

async function openFolderPickerWindow(tabId = null, autoResume = false) {
  const url = chrome.runtime.getURL(
    `sidepanel.html?mode=pick${tabId ? `&tabId=${tabId}` : ""}${autoResume ? "&autoResume=1" : ""}`
  );
  await chrome.windows.create({
    url,
    type: "popup",
    width: 460,
    height: 360
  });
}

async function runSaveJob({ jobId, payload, settingsOverride, originTabId, onlyMediaIndices }) {
  const baseSettings = await getSettings();
  const settings = settingsOverride ? migrateSettings({ ...baseSettings, ...settingsOverride }) : baseSettings;
  const folderParts = getRelativeLoraFolderParts(payload, settings);

  await setSessionJobState(jobId, {
    jobId,
    title: payload.title,
    startedAt: Date.now(),
    originTabId
  });

  try {
    let outcome;
    if (settings.saveMode === "direct_documents") {
      await ensureOffscreenDocument();
      outcome = await chrome.runtime.sendMessage({
        target: "offscreen",
        type: "CIS_OFFSCREEN_SAVE_PACKAGE",
        jobId,
        payload,
        settings,
        folderParts,
        originTabId,
        onlyMediaIndices
      });

      if (!outcome?.ok && outcome?.code === "NEEDS_FS_PERMISSION") {
        await openFolderPickerWindow(originTabId, true);
        return { ok: false, code: "PICKER_OPENED", jobId };
      }
    } else {
      outcome = await handleSaveViaDownloads({ jobId, payload, settings, originTabId, onlyMediaIndices });
    }

    if (outcome?.cancelled) {
      notifySaveDone(jobId, originTabId, { ok: false, cancelled: true, result: outcome.result });
      return { ok: false, cancelled: true, jobId, result: outcome.result };
    }

    if (!outcome?.ok) {
      const errMsg = outcome?.error || "Save failed";
      notifySaveDone(jobId, originTabId, { ok: false, error: errMsg });
      return { ok: false, jobId, error: errMsg };
    }

    const result = outcome.result;
    const dbRes = await upsertRecord(
      { ...payload, hasWeightsOnDisk: Boolean(result.hasWeightsOnDisk) },
      result.subfolder
    );
    result.totalInDb = dbRes.totalInDb;
    if (originTabId) updateTabBadge(originTabId, "saved");

    notifySaveDone(jobId, originTabId, { ok: true, result });
    return { ok: true, jobId, result };
  } finally {
    cancelledDownloadJobs.delete(jobId);
    await setSessionJobState(jobId, null);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target === "offscreen" || message.target === "ui") {
    return;
  }

  if (message.type === "CIS_OFFSCREEN_PROGRESS") {
    notifyProgress(message.jobId, message.originTabId, message.progress);
    return;
  }

  (async () => {
    if (message.type === "CIS_GET_BOOTSTRAP_STATE") {
      const settings = await getSettings();
      const lang = resolveLang(settings.language);
      sendResponse({
        ok: true,
        settings,
        lang,
        messages: getMessagesForLang(lang)
      });
      return;
    }

    if (message.type === "CIS_UPDATE_SETTINGS") {
      const settings = await updateSettings(message.patch || {});
      const lang = resolveLang(settings.language);
      sendResponse({ ok: true, settings, lang, messages: getMessagesForLang(lang) });
      return;
    }

    if (message.type === "CIS_CHECK_EXISTING") {
      const res = await checkExistingModel(message.query || {}, sender?.tab?.id || message.tabId || null);
      sendResponse({ ok: true, ...res });
      return;
    }

    if (message.type === "CIS_PREPARE_PREVIEW") {
      const p = message.payload || {};
      enrichPayloadHtml(p);
      const settings = await getSettings();
      const folderParts = getRelativeLoraFolderParts(p, settings);
      sendResponse({
        ok: true,
        loraTag: buildLoraTag(p.fileName, p.usageTips),
        folderPath: `${sanitizeSegment(settings.rootFolder, 50)}/${folderParts.join("/")}`,
        descriptionHtml: p.descriptionHtml || "",
        versionDescriptionHtml: p.versionDescriptionHtml || ""
      });
      return;
    }

    if (message.type === "CIS_START_SAVE") {
      const jobId = message.jobId || crypto.randomUUID();
      const originTabId = sender?.tab?.id || message.originTabId || null;
      const res = await runSaveJob({
        jobId,
        payload: message.payload,
        settingsOverride: message.settingsOverride || null,
        originTabId,
        onlyMediaIndices: message.onlyMediaIndices || null
      });
      sendResponse(res);
      return;
    }

    if (message.type === "CIS_CANCEL_SAVE") {
      const jobId = message.jobId;
      cancelledDownloadJobs.add(jobId);
      try {
        await ensureOffscreenDocument();
        await chrome.runtime.sendMessage({
          target: "offscreen",
          type: "CIS_OFFSCREEN_CANCEL_JOB",
          jobId
        });
      } catch (e) {}
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "CIS_REQUEST_FOLDER_PICK") {
      await openFolderPickerWindow(sender?.tab?.id || message.tabId || null, Boolean(message.autoResume));
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "CIS_NOTIFY_FS_UPDATED") {
      const tabs = await chrome.tabs.query({
        url: ["https://*.civitai.com/*", "https://civitai.com/*", "https://*.civitai.red/*", "https://civitai.red/*", "https://*.civitai.green/*", "https://civitai.green/*"]
      });
      for (const t of tabs) {
        if (t.id) chrome.tabs.sendMessage(t.id, { type: "CIS_FS_HANDLE_UPDATED" }).catch(() => {});
      }
      chrome.runtime.sendMessage({ target: "ui", type: "CIS_FS_HANDLE_UPDATED" }).catch(() => {});
      if (message.autoResume && message.tabId) {
        chrome.tabs.sendMessage(Number(message.tabId), { type: "CIS_TRIGGER_SAVE_FROM_POPUP" }).catch(() => {});
      }
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "CIS_DELETE_DB_RECORD") {
      const res = await deleteRecord(message.key);
      sendResponse({ ok: true, ...res });
      return;
    }

    if (message.type === "CIS_RESTORE_DB_RECORD") {
      const res = await restoreRecord(message.record, message.index || 0);
      sendResponse(res);
      return;
    }

    if (message.type === "CIS_UPDATE_DB_META") {
      const res = await updateRecordMeta(message.key, message.patch || {});
      sendResponse(res);
      return;
    }

    if (message.type === "CIS_IMPORT_DB") {
      const res = await importRecords(message.records, message.mode || "merge");
      sendResponse({ ok: true, ...res });
      return;
    }

    if (message.type === "CIS_OPEN_DATABASE") {
      await chrome.tabs.create({ url: chrome.runtime.getURL("database.html") });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "CIS_EXPORT_FILE") {
      const settings = await getSettings();
      const root = sanitizeSegment(settings.rootFolder || "civitred", 50);
      let content = message.content || "";
      let mime = message.mimeType || "text/plain;charset=utf-8";
      let filename = message.filename || `${root}/export.txt`;

      if (message.exportType === "csv") {
        const records = await getAllRecords();
        content = buildCsvExport(records);
        mime = "text/csv;charset=utf-8";
        filename = `${root}/Civitai_Master_Database.csv`;
      } else if (message.exportType === "json") {
        const records = await getAllRecords();
        content = JSON.stringify(records, null, 2);
        mime = "application/json;charset=utf-8";
        filename = `${root}/Civitai_Master_Database.json`;
      } else if (message.exportType === "html") {
        const records = await getAllRecords();
        content = buildStandaloneCatalogHtml(records);
        mime = "text/html;charset=utf-8";
        filename = `${root}/Civitai_Master_Catalog.html`;
      }

      const url = encodeTextAsDataUrl(content, mime);
      const res = await downloadWithForcedSubfolder(url, filename);
      sendResponse(res);
      return;
    }

    sendResponse({ ok: false, error: "Unhandled message type" });
  })().catch((err) => {
    sendResponse({ ok: false, error: err?.message || String(err) });
  });

  return true;
});
