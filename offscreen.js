import { buildGeneratedFiles } from "./src/exporters/index.js";
import { sanitizeDescriptionHtml } from "./src/shared/htmlSanitizer.js";
import { buildSafeMediaFilename, getFileStem, sanitizeSegment } from "./src/shared/sanitize.js";
import {
  ensureSubfolderChain,
  findExistingMediaInDir,
  getStoredDirInfo,
  inspectExistingFolderFiles,
  readCisManifest,
  resolveTargetRootHandle,
  scanRootFolderForSync,
  streamResponseToDir,
  writeCisManifest,
  writeTextFileToDir
} from "./src/storage/fsAccess.js";

const activeAbortControllers = new Map();

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

function sendProgressUpdate(jobId, originTabId, progress) {
  chrome.runtime
    .sendMessage({
      type: "CIS_OFFSCREEN_PROGRESS",
      jobId,
      originTabId,
      progress
    })
    .catch(() => {});
}

async function fetchUrlWithSignal(url, signal) {
  const resp = await fetch(url, { credentials: "omit", signal });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  return resp;
}

async function handleOffscreenSavePackage({ jobId, payload, settings, folderParts, originTabId, onlyMediaIndices }) {
  const resolved = await resolveTargetRootHandle(settings.rootFolder, { create: true });
  if (!resolved.handle) {
    return {
      ok: false,
      code: "NEEDS_FS_PERMISSION",
      displayRootPath: resolved.displayRootPath
    };
  }

  const targetDir = await ensureSubfolderChain(resolved.handle, folderParts, { create: true });
  const displaySubfolder = `${resolved.displayRootPath}/${folderParts.join("/")}`;
  const loraStem = sanitizeSegment(payload.title || "LoRA_Model", 75);
  const fileStem = getFileStem(payload.fileName || `${payload.title}_${payload.versionName}`);

  const controller = new AbortController();
  activeAbortControllers.set(jobId, controller);
  const { signal } = controller;

  const manifest = await readCisManifest(targetDir);
  manifest.modelId = payload.modelId || manifest.modelId;
  manifest.versionId = payload.versionId || manifest.versionId;
  manifest.versionName = payload.versionName || manifest.versionName;
  manifest.savedAt = new Date().toISOString();

  let filesSaved = 0;
  let mediaSaved = 0;
  let skippedMedia = 0;
  let bytesDownloaded = 0;
  const errors = [];
  const failedIndices = [];
  const indexFilterSet = Array.isArray(onlyMediaIndices) && onlyMediaIndices.length > 0
    ? new Set(onlyMediaIndices.map(Number))
    : null;

  try {
    if (settings.saveMedia && Array.isArray(payload.media)) {
      const mediaTasks = [];
      for (let i = 0; i < payload.media.length; i++) {
        const item = payload.media[i];
        if (item.isVideo && !settings.includeVideos) continue;
        if (indexFilterSet && !indexFilterSet.has(i)) continue;
        mediaTasks.push({ item, index: i });
      }

      const totalMedia = mediaTasks.length;
      let doneCount = 0;
      let lastProgressEmit = 0;
      const skipExisting = settings.skipExistingMedia !== false && !indexFilterSet;

      const emitProgress = (force = false) => {
        const now = Date.now();
        if (!force && now - lastProgressEmit < 220) return;
        lastProgressEmit = now;
        sendProgressUpdate(jobId, originTabId, {
          done: doneCount,
          total: totalMedia,
          skippedMedia,
          bytesDownloaded,
          displaySubfolder
        });
      };

      emitProgress(true);

      await runWithConcurrency(mediaTasks, 4, async ({ item, index }) => {
        if (signal.aborted) return;
        const idxStr = String(index + 1).padStart(2, "0");

        if (skipExisting) {
          const existing = await findExistingMediaInDir(
            targetDir,
            index,
            loraStem,
            item.extension,
            item.isVideo,
            item.uuid,
            manifest
          );
          if (existing) {
            item.extension = existing.ext;
            item.localFileName = existing.filename;
            if (item.uuid) manifest.mediaByUuid[item.uuid] = existing.filename;
            skippedMedia++;
            doneCount++;
            emitProgress();
            return;
          }
        }

        const candidates =
          Array.isArray(item.candidateUrls) && item.candidateUrls.length > 0
            ? item.candidateUrls
            : [item.downloadUrl, item.fallbackUrl, item.displayUrl].filter(Boolean);

        let lastErr = null;
        let savedThis = false;

        for (const candUrl of candidates) {
          if (!candUrl || signal.aborted) break;
          try {
            const resp = await fetchUrlWithSignal(candUrl, signal);
            const baseFilename = buildSafeMediaFilename(index, loraStem, item.extension || (item.isVideo ? "mp4" : "jpeg"));
            const written = await streamResponseToDir(targetDir, baseFilename, resp, {
              isVideo: Boolean(item.isVideo),
              defaultExt: item.extension || (item.isVideo ? "mp4" : "jpeg"),
              signal,
              onChunk: (n) => {
                bytesDownloaded += n;
                emitProgress();
              }
            });
            item.extension = written.actualExt;
            item.localFileName = written.writtenName;
            if (item.uuid) manifest.mediaByUuid[item.uuid] = written.writtenName;
            mediaSaved++;
            savedThis = true;
            break;
          } catch (err) {
            if (err?.name === "AbortError" || signal.aborted) {
              throw err;
            }
            lastErr = err;
          }
        }

        if (!savedThis && !signal.aborted) {
          errors.push(`Media #${idxStr}: ${lastErr?.message || "Download failed"}`);
          failedIndices.push(index);
        }

        doneCount++;
        emitProgress(doneCount === totalMedia);
      });

      if (signal.aborted) {
        return {
          ok: false,
          cancelled: true,
          result: {
            subfolder: displaySubfolder,
            filesSaved,
            mediaSaved,
            skippedMedia,
            bytesDownloaded,
            errors,
            failedIndices
          }
        };
      }

      // Deterministic WebUI preview copy (after parallel media downloads finish)
      if (settings.saveWebuiPreview && !indexFilterSet) {
        try {
          const firstImage = payload.media.find((m) => !m.isVideo);
          if (firstImage && firstImage.localFileName) {
            const fh = await targetDir.getFileHandle(firstImage.localFileName, { create: false });
            const file = await fh.getFile();
            if (file && file.size > 128) {
              const previewName = `${fileStem}.preview.${firstImage.extension || "jpeg"}`;
              const destFh = await targetDir.getFileHandle(previewName, { create: true });
              const writable = await destFh.createWritable();
              try {
                await writable.write(file);
                await writable.close();
              } catch (e) {
                await writable.abort().catch(() => {});
              }
            }
          } else {
            const firstVideo = payload.media.find((m) => m.isVideo && m.posterUrl);
            if (firstVideo?.posterUrl) {
              const resp = await fetchUrlWithSignal(firstVideo.posterUrl, signal);
              await streamResponseToDir(targetDir, `${fileStem}.preview.jpeg`, resp, {
                isVideo: false,
                defaultExt: "jpeg",
                signal
              });
            }
          }
        } catch (e) {
          // Non-fatal preview error
        }
      }
    }

    if (signal.aborted) {
      return {
        ok: false,
        cancelled: true,
        result: { subfolder: displaySubfolder, filesSaved, mediaSaved, skippedMedia, bytesDownloaded, errors, failedIndices }
      };
    }

    // Sanitize HTML descriptions & generate files after media extensions are finalized
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

    const generated = buildGeneratedFiles(payload, loraStem, settings);

    if (!indexFilterSet) {
      if (settings.saveTxt && generated.txt) {
        await writeTextFileToDir(targetDir, `${loraStem}.txt`, generated.txt);
        filesSaved++;
      }
      if (settings.saveMd && generated.md) {
        await writeTextFileToDir(targetDir, `${loraStem}.md`, generated.md);
        filesSaved++;
      }
      if (settings.saveJson && generated.json) {
        await writeTextFileToDir(targetDir, `${loraStem}.json`, generated.json);
        filesSaved++;
      }
      if (settings.saveCivitaiInfo && generated.civitaiInfo) {
        await writeTextFileToDir(targetDir, `${fileStem}.civitai.info`, generated.civitaiInfo);
        filesSaved++;
      }
      if (settings.saveHtml && generated.html) {
        await writeTextFileToDir(targetDir, `${loraStem}.html`, generated.html);
        filesSaved++;
      }
    }

    await writeCisManifest(targetDir, manifest);

    const inspected = await inspectExistingFolderFiles(settings.rootFolder, folderParts);

    return {
      ok: true,
      result: {
        subfolder: displaySubfolder,
        filesSaved,
        mediaSaved,
        skippedMedia,
        bytesDownloaded,
        errors,
        failedIndices,
        hasWeightsOnDisk: Boolean(inspected.hasWeights)
      }
    };
  } finally {
    activeAbortControllers.delete(jobId);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== "offscreen") return;

  (async () => {
    if (message.type === "CIS_OFFSCREEN_CHECK_DIR") {
      const [dirInfo, existing] = await Promise.all([
        getStoredDirInfo(message.rootFolder),
        message.folderParts ? inspectExistingFolderFiles(message.rootFolder, message.folderParts) : Promise.resolve(null)
      ]);
      sendResponse({ ok: true, dirInfo, existing });
      return;
    }

    if (message.type === "CIS_OFFSCREEN_SAVE_PACKAGE") {
      const res = await handleOffscreenSavePackage(message);
      sendResponse(res);
      return;
    }

    if (message.type === "CIS_OFFSCREEN_CANCEL_JOB") {
      const ctrl = activeAbortControllers.get(message.jobId);
      if (ctrl) ctrl.abort();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "CIS_OFFSCREEN_SCAN_FOLDER") {
      const scanRes = await scanRootFolderForSync(message.rootFolder);
      sendResponse({ ok: true, ...scanRes });
      return;
    }

    sendResponse({ ok: false, error: "Unknown offscreen message type" });
  })().catch((err) => {
    sendResponse({ ok: false, error: err?.message || String(err) });
  });

  return true;
});
