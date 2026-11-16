// Content Script for Civitai Model Info & Media Saver v1.6
// Direct Save to Documents/civitred/<LoRA Title>/ + Duplicate Folder Check + Offline Civitai HTML
(() => {
  console.log("[Civitai Info Saver v1.6] Content script loaded on:", location.href);

  const SETTINGS_VERSION = 3;

  let currentSettings = {
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
    rootFolder: "civitred"
  };

  let cachedModelApiData = {};
  let lastUrl = location.href;
  let lastCheckedUrl = "";
  let forceFloatingMode = false;
  let cachedRootDirHandle = null;

  function openHandleDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("CivitaiInfoSaverFS", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("handles")) {
          db.createObjectStore("handles");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function loadStoredDirHandle() {
    try {
      const db = await openHandleDb();
      return await new Promise((resolve) => {
        const tx = db.transaction("handles", "readonly");
        const req = tx.objectStore("handles").get("civitredRoot");
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (e) {
      return null;
    }
  }

  async function saveStoredDirHandle(handle) {
    try {
      const db = await openHandleDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction("handles", "readwrite");
        tx.objectStore("handles").put(handle, "civitredRoot");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.warn("[Civitai Info Saver] Could not store directory handle:", e);
    }
  }

  async function pickCivitredDirectory() {
    if (!window.showDirectoryPicker) {
      throw new Error("Ваш браузер не поддерживает прямой выбор папки (используется режим Downloads/civitred).");
    }
    const pickedHandle = await window.showDirectoryPicker({
      id: "civitred_archive_root",
      mode: "readwrite",
      startIn: "documents"
    });

    const rootFolderName = sanitizeSegment(currentSettings.rootFolder || "civitred", 50);
    let targetRootHandle = pickedHandle;
    if (pickedHandle.name.toLowerCase() !== rootFolderName.toLowerCase()) {
      targetRootHandle = await pickedHandle.getDirectoryHandle(rootFolderName, { create: true });
    }

    cachedRootDirHandle = targetRootHandle;
    await saveStoredDirHandle(targetRootHandle);
    updateDirStatusUi();
    return targetRootHandle;
  }

  async function ensureWritableCivitredHandle() {
    if (!cachedRootDirHandle) {
      cachedRootDirHandle = await loadStoredDirHandle();
    }
    if (cachedRootDirHandle) {
      try {
        let perm = await cachedRootDirHandle.queryPermission({ mode: "readwrite" });
        if (perm !== "granted") {
          perm = await cachedRootDirHandle.requestPermission({ mode: "readwrite" });
        }
        if (perm === "granted") {
          updateDirStatusUi();
          return cachedRootDirHandle;
        }
      } catch (e) {
        cachedRootDirHandle = null;
      }
    }
    return await pickCivitredDirectory();
  }

  // Strip filesystem-unsafe AND URL-fragment-unsafe characters (#, %, ?, &)
  function sanitizeSegment(str, maxLen = 90) {
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

  function buildSafeMediaFilename(indexZeroBased, loraStem, ext) {
    const idxStr = String(indexZeroBased + 1).padStart(2, "0");
    const cleanStem = sanitizeSegment(loraStem || "LoRA_Model", 75);
    const cleanExt = String(ext || "jpeg").replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "jpeg";
    return `${idxStr}_${cleanStem}.${cleanExt}`;
  }

  function getRelativeLoraFolderParts(payload, settings) {
    const baseModel = sanitizeSegment(payload.baseModel || "Unknown_Base", 40);
    const title = sanitizeSegment(payload.title || "Untitled_Model", 80);
    const versionName = sanitizeSegment(payload.versionName || "v1", 35);
    const fileStem = getFileStem(payload.fileName || `${title}_${versionName}`);

    switch (settings.folderPreset) {
      case "lora_title_version":
        return [`${title} (${versionName})`];
      case "base_and_lora_title":
        return [baseModel, title];
      case "filename_only":
        return [fileStem];
      case "lora_title_only":
      default:
        return [title];
    }
  }

  async function writeTextFileToDir(dirHandle, filename, textContent) {
    const safeName = sanitizeFilenamePreservingExt(filename, 95);
    const fileHandle = await dirHandle.getFileHandle(safeName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(textContent);
    await writable.close();
  }

  async function writeBinaryFileToDir(dirHandle, filename, uint8OrBuffer) {
    const safeName = sanitizeFilenamePreservingExt(filename, 95);
    const fileHandle = await dirHandle.getFileHandle(safeName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(uint8OrBuffer);
    await writable.close();
    return safeName;
  }

  async function fetchBinaryFromUrl(url) {
    try {
      const resp = await fetch(url, { credentials: "omit" });
      if (resp.ok) {
        const buf = await resp.arrayBuffer();
        const bytes = new Uint8Array(buf);
        if (bytes.length > 128) {
          return {
            bytes,
            contentType: resp.headers.get("content-type") || ""
          };
        }
      }
    } catch (e) {
      // Fallback to background service worker
    }
    const bgRes = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "CIS_FETCH_MEDIA_BASE64", url }, (r) => resolve(r));
    });
    if (!bgRes || !bgRes.ok || !bgRes.base64) {
      throw new Error(bgRes?.error || "Failed to fetch media");
    }
    const binStr = atob(bgRes.base64);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }
    if (bytes.length <= 128) {
      throw new Error("Downloaded media is empty");
    }
    return {
      bytes,
      contentType: bgRes.contentType || ""
    };
  }

  async function fetchMediaWithCandidates(item) {
    const candidates = Array.isArray(item.candidateUrls) && item.candidateUrls.length > 0
      ? item.candidateUrls
      : [item.downloadUrl, item.fallbackUrl, item.displayUrl].filter(Boolean);

    let lastErr = null;
    for (const url of candidates) {
      if (!url) continue;
      try {
        const res = await fetchBinaryFromUrl(url);
        return { ...res, usedUrl: url };
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("All media candidate URLs failed");
  }

  function inferExtFromContentTypeOrUrl(contentType, url, defaultExt, isVideo) {
    const ct = String(contentType || "").toLowerCase();
    if (ct.includes("video/mp4")) return "mp4";
    if (ct.includes("video/webm")) return "webm";
    if (ct.includes("video/quicktime")) return "mov";
    if (ct.includes("image/jpeg")) return "jpeg";
    if (ct.includes("image/png")) return "png";
    if (ct.includes("image/webp")) return "webp";
    if (ct.includes("image/gif")) return "gif";
    if (ct.includes("image/avif")) return "avif";

    const m = String(url || "").match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
    if (m) {
      const ext = m[1].toLowerCase();
      if (isVideo && ["mp4", "webm", "mov"].includes(ext)) return ext;
      if (!isVideo && ["jpg", "jpeg", "png", "webp", "gif", "avif"].includes(ext)) return ext;
    }
    return defaultExt || (isVideo ? "mp4" : "jpeg");
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

  async function findExistingMediaInDir(dirHandle, indexZeroBased, loraStem, preferredExt, isVideo) {
    const exts = isVideo
      ? [preferredExt || "mp4", "mp4", "webm", "mov"]
      : [preferredExt || "jpeg", "jpeg", "jpg", "png", "webp", "gif", "avif"];
    const uniqueExts = Array.from(new Set(exts.filter(Boolean)));
    for (const ext of uniqueExts) {
      const candidate = sanitizeFilenamePreservingExt(buildSafeMediaFilename(indexZeroBased, loraStem, ext), 95);
      try {
        const fh = await dirHandle.getFileHandle(candidate, { create: false });
        const file = await fh.getFile();
        if (file && file.size > 128) {
          return { filename: candidate, ext };
        }
      } catch (e) {
        // Not found
      }
    }
    return null;
  }

  // Save media first so any extension adjustments are reflected in the generated HTML/MD/TXT files!
  async function savePackageDirectlyToDir(rootDirHandle, payload, settings, onStatus) {
    const folderParts = getRelativeLoraFolderParts(payload, settings);
    let targetDir = rootDirHandle;
    for (const part of folderParts) {
      targetDir = await targetDir.getDirectoryHandle(part, { create: true });
    }

    const loraStem = sanitizeSegment(payload.title || "LoRA_Model", 75);
    const fileStem = getFileStem(payload.fileName || `${payload.title}_${payload.versionName}`);
    const displaySubfolder = `Documents/${rootDirHandle.name}/${folderParts.join("/")}`;

    let filesSaved = 0;
    let mediaSaved = 0;
    let skippedMedia = 0;
    const errors = [];
    let firstImageBytes = null;
    let firstImageExt = "jpeg";

    if (settings.saveMedia && Array.isArray(payload.media)) {
      const mediaTasks = [];
      for (let i = 0; i < payload.media.length; i++) {
        const item = payload.media[i];
        if (item.isVideo && !settings.includeVideos) continue;
        mediaTasks.push({ item, index: i });
      }

      const totalMedia = mediaTasks.length;
      let doneCount = 0;
      const skipExisting = settings.skipExistingMedia !== false;

      await runWithConcurrency(mediaTasks, 4, async ({ item, index }) => {
        const idxStr = String(index + 1).padStart(2, "0");

        if (skipExisting) {
          const existing = await findExistingMediaInDir(targetDir, index, loraStem, item.extension, item.isVideo);
          if (existing) {
            item.extension = existing.ext;
            item.localFileName = existing.filename;
            skippedMedia++;
            doneCount++;
            if (onStatus) {
              onStatus(`Проверка/сохранение медиа ${doneCount}/${totalMedia} (пропущено: ${skippedMedia})...`);
            }
            return;
          }
        }

        try {
          const fetched = await fetchMediaWithCandidates(item);
          const actualExt = inferExtFromContentTypeOrUrl(
            fetched.contentType,
            fetched.usedUrl,
            item.extension,
            item.isVideo
          );
          item.extension = actualExt;
          const mediaFilename = buildSafeMediaFilename(index, loraStem, actualExt);
          const writtenName = await writeBinaryFileToDir(targetDir, mediaFilename, fetched.bytes);
          item.localFileName = writtenName;
          if (!item.isVideo && !firstImageBytes) {
            firstImageBytes = fetched.bytes;
            firstImageExt = actualExt;
          }
          mediaSaved++;
        } catch (err) {
          errors.push(`Media #${idxStr}: ${err.message || err}`);
        } finally {
          doneCount++;
          if (onStatus) {
            onStatus(`Сохранение медиа ${doneCount}/${totalMedia} в ${displaySubfolder}...`);
          }
        }
      });

      if (settings.saveWebuiPreview) {
        try {
          if (firstImageBytes) {
            await writeBinaryFileToDir(targetDir, `${fileStem}.preview.${firstImageExt}`, firstImageBytes);
          } else {
            const firstImg = payload.media.find((m) => !m.isVideo) || payload.media[0];
            if (firstImg && firstImg.localFileName) {
              const fh = await targetDir.getFileHandle(firstImg.localFileName, { create: false });
              const f = await fh.getFile();
              const buf = new Uint8Array(await f.arrayBuffer());
              if (buf.length > 128) {
                await writeBinaryFileToDir(targetDir, `${fileStem}.preview.${firstImg.extension || "jpeg"}`, buf);
              }
            }
          }
        } catch (e) {
          // Non-fatal preview copy error
        }
      }
    }

    // Regenerate files after media download so local filenames & extensions match 100%
    payload.generatedFiles = buildGeneratedFiles(payload, loraStem);

    if (settings.saveTxt && payload.generatedFiles?.txt) {
      await writeTextFileToDir(targetDir, `${loraStem}.txt`, payload.generatedFiles.txt);
      filesSaved++;
    }
    if (settings.saveMd && payload.generatedFiles?.md) {
      await writeTextFileToDir(targetDir, `${loraStem}.md`, payload.generatedFiles.md);
      filesSaved++;
    }
    if (settings.saveJson && payload.generatedFiles?.json) {
      await writeTextFileToDir(targetDir, `${loraStem}.json`, payload.generatedFiles.json);
      filesSaved++;
      if (settings.saveCivitaiInfo && payload.generatedFiles?.civitaiInfo) {
        await writeTextFileToDir(targetDir, `${fileStem}.civitai.info`, payload.generatedFiles.civitaiInfo);
        filesSaved++;
      }
    }
    if (settings.saveHtml && payload.generatedFiles?.html) {
      await writeTextFileToDir(targetDir, `${loraStem}.html`, payload.generatedFiles.html);
      filesSaved++;
    }

    const dbRes = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "CIS_RECORD_DB_ONLY", payload, subfolder: displaySubfolder },
        (r) => resolve(r)
      );
    });

    return {
      subfolder: displaySubfolder,
      filesSaved,
      mediaSaved,
      skippedMedia,
      totalInDb: dbRes?.totalInDb || 1,
      errors
    };
  }

  chrome.storage.local.get(["cisSettings"], async (res) => {
    let s = res && res.cisSettings ? res.cisSettings : null;
    if (!s || s.settingsVersion !== SETTINGS_VERSION) {
      s = {
        ...currentSettings,
        ...(s || {}),
        settingsVersion: SETTINGS_VERSION,
        rootFolder: "civitred",
        folderPreset: "lora_title_only",
        saveMode: "direct_documents"
      };
      chrome.storage.local.set({ cisSettings: s });
    }
    currentSettings = { ...currentSettings, ...s };
    cachedRootDirHandle = await loadStoredDirHandle();
    syncWidgetInputs();
    updateDirStatusUi();
    checkExistingLoraStatus();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.cisSettings && changes.cisSettings.newValue) {
      currentSettings = { ...currentSettings, ...changes.cisSettings.newValue };
      syncWidgetInputs();
      updateDirStatusUi();
      checkExistingLoraStatus();
    }
  });

  function saveSettings() {
    chrome.storage.local.set({ cisSettings: currentSettings });
  }

  function getModelIdFromUrl() {
    const match = location.pathname.match(/^\/models\/(\d+)/);
    return match ? match[1] : null;
  }

  function detectActiveVersionId(apiData) {
    const params = new URLSearchParams(location.search);
    if (params.get("modelVersionId")) {
      return String(params.get("modelVersionId"));
    }

    const dlLinks = Array.from(document.querySelectorAll('a[href*="/api/download/models/"]'));
    for (const link of dlLinks) {
      const m = link.getAttribute("href").match(/\/api\/download\/models\/(\d+)/);
      if (m) return String(m[1]);
    }

    const bodyText = document.body ? document.body.innerText : "";
    const airMatch = bodyText.match(/civitai\s*:\s*\d+\s*@\s*(\d+)/i);
    if (airMatch) return String(airMatch[1]);

    if (apiData && Array.isArray(apiData.modelVersions) && apiData.modelVersions.length > 0) {
      const activeBtns = Array.from(
        document.querySelectorAll('button[data-active="true"], a[data-active="true"], button[aria-selected="true"]')
      );
      for (const btn of activeBtns) {
        const txt = (btn.innerText || "").replace(/\s+/g, " ").trim();
        const exactVer = apiData.modelVersions.find((v) => v.name && txt === v.name.trim());
        if (exactVer) return String(exactVer.id);
      }
      return String(apiData.modelVersions[0].id);
    }
    return null;
  }

  function extractFromNextData(modelId) {
    try {
      const nextScript = document.getElementById("__NEXT_DATA__");
      if (!nextScript || !nextScript.textContent) return null;
      const nextJson = JSON.parse(nextScript.textContent);
      const queries = nextJson?.props?.pageProps?.trpcState?.json?.queries;
      if (!Array.isArray(queries)) return null;

      let modelData = null;
      const infiniteImagesByVersion = {};

      for (const q of queries) {
        const keyArr = q?.queryKey?.[0];
        const input = q?.queryKey?.[1]?.input;
        const data = q?.state?.data;
        if (!data) continue;

        if (Array.isArray(keyArr) && keyArr[0] === "model" && keyArr[1] === "getById") {
          if (!modelId || String(data.id) === String(modelId) || String(input?.id) === String(modelId)) {
            modelData = data;
          }
        } else if (Array.isArray(keyArr) && keyArr[0] === "image" && keyArr[1] === "getInfinite") {
          const verId = input?.modelVersionId ? String(input.modelVersionId) : "all";
          const pages = Array.isArray(data.pages) ? data.pages : [];
          const items = pages.flatMap((p) => (Array.isArray(p?.items) ? p.items : []));
          if (items.length > 0) {
            infiniteImagesByVersion[verId] = (infiniteImagesByVersion[verId] || []).concat(items);
          }
        }
      }

      if (!modelData && Object.keys(infiniteImagesByVersion).length === 0) return null;
      return { modelData, infiniteImagesByVersion };
    } catch (e) {
      return null;
    }
  }

  function detectCdnBaseFromDom() {
    const els = document.querySelectorAll(
      "img[src*='image.civitai.'], video source[src*='image.civitai.'], video[src*='image.civitai.']"
    );
    for (const el of els) {
      const src = el.getAttribute("src") || el.currentSrc || "";
      const m = src.match(/^(https:\/\/image\.civitai\.[a-z]+\/[^/]+)/i);
      if (m) return m[1];
    }
    const hostTldMatch = location.hostname.match(/civitai\.([a-z]+)$/i);
    const tld = hostTldMatch ? hostTldMatch[1] : "com";
    return `https://image.civitai.${tld}/xG1nkqKTMzGDvpLrqFT7WA`;
  }

  function extractCivitaiUuid(urlOrStr) {
    if (!urlOrStr) return null;
    const m = String(urlOrStr).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    return m ? m[1].toLowerCase() : null;
  }

  // Inspect live DOM carousel/gallery to capture exact working URLs and video elements
  function collectLiveDomMedia() {
    const byUuid = new Map();
    const orderedItems = [];
    const seenKeys = new Set();

    // Prioritize top carousel slides, then fall back to main showcase media
    let containers = Array.from(
      document.querySelectorAll('.mantine-Carousel-slide, [class*="Carousel-slide"], [class*="carousel"] [class*="slide"]')
    );
    if (containers.length === 0) {
      const mainEl = document.querySelector("main") || document.body;
      containers = mainEl ? [mainEl] : [];
    }

    function registerEntry(entry) {
      const key = entry.uuid || entry.displayUrl || entry.videoUrl;
      if (!key) return;
      if (entry.uuid) {
        const existing = byUuid.get(entry.uuid);
        if (existing) {
          if (entry.isVideo && !existing.isVideo) existing.isVideo = true;
          if (entry.videoUrl && !existing.videoUrl) existing.videoUrl = entry.videoUrl;
          if (entry.webmUrl && !existing.webmUrl) existing.webmUrl = entry.webmUrl;
          if (entry.posterUrl && !existing.posterUrl) existing.posterUrl = entry.posterUrl;
          if (entry.displayUrl && !existing.displayUrl) existing.displayUrl = entry.displayUrl;
          return;
        }
        byUuid.set(entry.uuid, entry);
      }
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        orderedItems.push(entry);
      }
    }

    for (const container of containers) {
      // 1. Videos in container
      const videos = container.querySelectorAll("video");
      videos.forEach((vid) => {
        if (vid.closest('[class*="TypographyStylesProvider"], [class*="RenderHtml"], footer')) return;
        const sources = Array.from(vid.querySelectorAll("source"))
          .map((s) => s.getAttribute("src") || s.src || "")
          .filter(Boolean);
        const directSrc = vid.getAttribute("src") || vid.currentSrc || "";
        const allSrcs = [directSrc, ...sources].filter((u) => /image\.civitai\.|cloudflare/i.test(u));
        if (allSrcs.length === 0) return;

        const mp4Url = allSrcs.find((u) => /\.mp4(\?|$)/i.test(u)) || allSrcs[0];
        const webmUrl = allSrcs.find((u) => /\.webm(\?|$)/i.test(u)) || "";
        const posterUrl = vid.getAttribute("poster") || "";
        const uuid = extractCivitaiUuid(mp4Url) || extractCivitaiUuid(posterUrl);

        registerEntry({
          uuid,
          isVideo: true,
          videoUrl: mp4Url,
          webmUrl,
          posterUrl,
          displayUrl: mp4Url,
          width: vid.videoWidth || null,
          height: vid.videoHeight || null
        });
      });

      // 2. Images in container
      const imgs = container.querySelectorAll("img[src*='image.civitai.']");
      imgs.forEach((img) => {
        if (img.closest('[class*="TypographyStylesProvider"], [class*="RenderHtml"], footer, header')) return;
        const src = img.currentSrc || img.getAttribute("src") || "";
        if (!src) return;
        // Skip small avatars/icons/badges
        if (/\/width=(16|20|24|32|40|48|56|64|72|80|96|120|128)\b/i.test(src)) return;
        if (/avatar/i.test(src) || /avatar/i.test(img.className || "") || /avatar/i.test(img.alt || "")) return;
        if (img.width > 0 && img.width < 110 && img.height > 0 && img.height < 110) return;

        const uuid = extractCivitaiUuid(src);
        const isVidUrl = /\.(mp4|webm|mov)(\?|$)/i.test(src);

        registerEntry({
          uuid,
          isVideo: isVidUrl,
          videoUrl: isVidUrl ? src : "",
          webmUrl: "",
          posterUrl: isVidUrl ? "" : src,
          displayUrl: src,
          width: img.naturalWidth || null,
          height: img.naturalHeight || null
        });
      });
    }

    return { byUuid, orderedItems };
  }

  function normalizeHashes(rawHashes) {
    const out = {};
    if (!rawHashes) return out;
    if (Array.isArray(rawHashes)) {
      rawHashes.forEach((h) => {
        if (h && h.type && h.hash) {
          out[h.type] = h.hash;
        }
      });
    } else if (typeof rawHashes === "object") {
      Object.assign(out, rawHashes);
    }
    return out;
  }

  function htmlToCleanText(html) {
    if (!html) return "";
    const temp = document.createElement("div");
    temp.innerHTML = html;

    temp.querySelectorAll("br").forEach((el) => el.replaceWith("\n"));
    temp.querySelectorAll("p, div, h1, h2, h3, h4, h5, h6, blockquote").forEach((el) => {
      el.prepend(document.createTextNode("\n"));
      el.append(document.createTextNode("\n"));
    });
    temp.querySelectorAll("li").forEach((el) => {
      el.prepend(document.createTextNode("\n• "));
    });
    temp.querySelectorAll("a").forEach((el) => {
      const href = el.getAttribute("href");
      const text = (el.textContent || "").trim();
      if (href && href.startsWith("http") && text && text !== href) {
        el.replaceWith(`${text} (${href})`);
      }
    });

    return (temp.textContent || "")
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function normalizeDescriptionHtmlUrls(html) {
    if (!html) return "";
    const temp = document.createElement("div");
    temp.innerHTML = html;
    temp.querySelectorAll("script, iframe, object, embed, style").forEach((el) => el.remove());
    temp.querySelectorAll("*").forEach((el) => {
      Array.from(el.attributes).forEach((attr) => {
        if (/^on/i.test(attr.name)) {
          el.removeAttribute(attr.name);
        } else if ((attr.name === "href" || attr.name === "src") && /^\s*javascript:/i.test(attr.value)) {
          el.removeAttribute(attr.name);
        }
      });
    });
    temp.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (href.startsWith("/")) {
        a.setAttribute("href", `${location.origin}${href}`);
      }
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener");
    });
    temp.querySelectorAll("img").forEach((img) => {
      const dataSrc = img.getAttribute("data-src") || img.getAttribute("src") || "";
      if (dataSrc.startsWith("/")) {
        img.setAttribute("src", `${location.origin}${dataSrc}`);
      }
    });
    return temp.innerHTML;
  }

  function scrapeDetailsTableFromDom() {
    const detailsMap = {};
    const triggerWordsFromDom = [];

    function processKeyValue(rawKey, valueEl) {
      const key = (rawKey || "").replace(/\s+/g, " ").trim();
      if (!key || !valueEl) return;

      let val = (valueEl.innerText || "").replace(/\s+/g, " ").trim();
      if (/^Stats$/i.test(key)) {
        val = val.replace(/(?:\b0\s*1\s*2\s*3\s*4\s*5\s*6\s*7\s*8\s*9\b\s*)+/g, " ").replace(/\s+/g, " ").trim();
      }
      if (!val) return;

      detailsMap[key] = val;

      if (/trigger\s*word/i.test(key)) {
        const badges = valueEl.querySelectorAll("[class*='Badge-label'], [class*='Badge'], [class*='badge'], button, span");
        if (badges.length > 0) {
          badges.forEach((b) => {
            const t = (b.innerText || "").replace(/\s+/g, " ").trim();
            if (t && t.length > 1 && !/^(copy|trigger words)$/i.test(t) && !triggerWordsFromDom.includes(t)) {
              triggerWordsFromDom.push(t);
            }
          });
        }
        if (triggerWordsFromDom.length === 0 && val) {
          triggerWordsFromDom.push(val);
        }
      }
    }

    const detailRows = document.querySelectorAll('[class*="detailRow"]');
    detailRows.forEach((row) => {
      const labelEl = row.querySelector('[class*="detailLabel"]') || row.children[0];
      const valueEl = row.querySelector('[class*="detailValue"]') || row.children[1];
      if (labelEl && valueEl) {
        processKeyValue(labelEl.innerText || labelEl.textContent, valueEl);
      }
    });

    const tableRows = document.querySelectorAll("table tr");
    tableRows.forEach((tr) => {
      const cells = tr.querySelectorAll("td, th");
      if (cells.length >= 2) {
        processKeyValue(cells[0].innerText || cells[0].textContent, cells[1]);
      }
    });

    let domFilename = "";
    const dlCard = findDownloadCardContainer();
    if (dlCard) {
      const textLines = (dlCard.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean);
      const fileLine = textLines.find((line) => /\.(safetensors|ckpt|pt|bin|pth|gguf|onnx|zip)|safet\.\.\./i.test(line));
      if (fileLine) domFilename = fileLine;
    }

    let domDescriptionHtml = "";
    let domDescriptionText = "";
    const allProse = Array.from(
      document.querySelectorAll("[class*='TypographyStylesProvider'], [class*='RenderHtml']")
    ).filter((el) => !el.closest('.mantine-Accordion-root, [class*="Accordion"], [class*="Comment"], footer'));
    const proseBlocks = allProse.length > 0
      ? allProse
      : Array.from(document.querySelectorAll("[class*='TypographyStylesProvider'], [class*='RenderHtml']"));

    if (proseBlocks.length > 0) {
      domDescriptionHtml = proseBlocks.map((el) => el.innerHTML).join("\n");
      domDescriptionText = proseBlocks.map((el) => (el.innerText || "").trim()).filter(Boolean).join("\n\n");
    }

    return {
      detailsMap,
      triggerWordsFromDom,
      domFilename,
      domDescriptionHtml,
      domDescriptionText
    };
  }

  function uniqueNonEmptyUrls(list) {
    const out = [];
    const seen = new Set();
    for (const u of list) {
      if (!u || typeof u !== "string") continue;
      const trimmed = u.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
    }
    return out;
  }

  function resolveCivitaiMediaItem(imgObj, index, cdnBase, domMediaByUuid, loraStem) {
    const base = cdnBase || "https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA";
    let rawUrl = imgObj.url || imgObj.displayUrl || imgObj.videoUrl || "";
    const itemName = imgObj.name || "";
    const uuid = extractCivitaiUuid(rawUrl) || (rawUrl && !rawUrl.startsWith("http") ? rawUrl : null);
    const domMatch = uuid && domMediaByUuid ? domMediaByUuid.get(uuid.toLowerCase()) : null;

    const isVideo = Boolean(
      imgObj.isVideo ||
      imgObj.type === "video" ||
      domMatch?.isVideo ||
      /\.(mp4|webm|mov)(\?|$)/i.test(rawUrl) ||
      /\.(mp4|webm|mov)(\?|$)/i.test(itemName) ||
      /transcode=true/i.test(rawUrl) ||
      (imgObj.mimeType && String(imgObj.mimeType).startsWith("video/"))
    );

    const fileStem = itemName
      ? itemName.replace(/\.[a-zA-Z0-9]+$/, "")
      : uuid || `media_${index + 1}`;

    if (rawUrl && !rawUrl.startsWith("http")) {
      const defaultExt = isVideo ? "mp4" : "jpeg";
      const fallbackName = itemName || `${rawUrl}.${defaultExt}`;
      const mod = isVideo ? "anim=true,transcode=true,width=450,optimized=true" : "width=450";
      rawUrl = `${base}/${rawUrl}/${mod}/${encodeURIComponent(fallbackName)}`;
    }

    // Align CDN domain with active page's CDN domain if needed
    let pageAlignedRawUrl = rawUrl;
    if (/^https:\/\/image\.civitai\.[a-z]+\/[^/]+/i.test(rawUrl) && base) {
      pageAlignedRawUrl = rawUrl.replace(/^https:\/\/image\.civitai\.[a-z]+\/[^/]+/i, base);
    }

    if (isVideo) {
      const candidateUrls = [];
      if (uuid) {
        candidateUrls.push(`${base}/${uuid}/original=true/${encodeURIComponent(fileStem)}.mp4`);
        candidateUrls.push(`${base}/${uuid}/transcode=true,original=true/${encodeURIComponent(fileStem)}.mp4`);
        candidateUrls.push(`${base}/${uuid}/anim=true,transcode=true,width=1080,optimized=true/${encodeURIComponent(fileStem)}.mp4`);
      }
      if (domMatch?.videoUrl) {
        candidateUrls.push(domMatch.videoUrl);
      }
      if (uuid) {
        candidateUrls.push(`${base}/${uuid}/anim=true,transcode=true,width=450,optimized=true/${encodeURIComponent(fileStem)}.mp4`);
        candidateUrls.push(`${base}/${uuid}/transcode=true,width=450/${encodeURIComponent(fileStem)}.mp4`);
      }
      if (pageAlignedRawUrl) {
        candidateUrls.push(pageAlignedRawUrl.replace(/\.[a-zA-Z0-9]+(\?|$)/, ".mp4$1"));
      }
      if (domMatch?.webmUrl) {
        candidateUrls.push(domMatch.webmUrl);
      }

      const dedupCandidates = uniqueNonEmptyUrls(candidateUrls);
      const displayVideoUrl =
        domMatch?.videoUrl ||
        (uuid ? `${base}/${uuid}/anim=true,transcode=true,width=450,optimized=true/${encodeURIComponent(fileStem)}.mp4` : "") ||
        dedupCandidates[0] ||
        "";
      const posterUrl =
        domMatch?.posterUrl ||
        (uuid ? `${base}/${uuid}/anim=false,transcode=true,width=450/${encodeURIComponent(fileStem)}.jpeg` : "");

      const ext = "mp4";
      const localFileName = buildSafeMediaFilename(index, loraStem, ext);

      return {
        index: index + 1,
        id: imgObj.id || uuid || index + 1,
        uuid: uuid || null,
        isVideo: true,
        type: "video",
        extension: ext,
        fallbackExtension: "mp4",
        localFileName,
        downloadUrl: dedupCandidates[0] || displayVideoUrl,
        fallbackUrl: displayVideoUrl,
        displayUrl: displayVideoUrl,
        posterUrl,
        candidateUrls: dedupCandidates,
        width: imgObj.width || domMatch?.width || null,
        height: imgObj.height || domMatch?.height || null,
        meta: imgObj.meta || imgObj.metadata || null
      };
    }

    const extMatch = (itemName || pageAlignedRawUrl).match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
    let ext = extMatch ? extMatch[1].toLowerCase() : "jpeg";
    if (!["jpg", "jpeg", "png", "webp", "gif", "avif"].includes(ext)) {
      ext = "jpeg";
    }

    const candidateUrls = [];
    if (uuid) {
      candidateUrls.push(`${base}/${uuid}/original=true/${encodeURIComponent(fileStem)}.${ext}`);
    }
    if ( pageAlignedRawUrl && /image\.civitai\./i.test(pageAlignedRawUrl) ) {
      candidateUrls.push(pageAlignedRawUrl.replace(/\/(width=[^/]+|anim=[^/]+)\//, "/original=true/"));
    }
    if (domMatch?.displayUrl) {
      candidateUrls.push(domMatch.displayUrl);
    }
    if (uuid) {
      candidateUrls.push(`${base}/${uuid}/width=1080/${encodeURIComponent(fileStem)}.${ext}`);
      candidateUrls.push(`${base}/${uuid}/width=450/${encodeURIComponent(fileStem)}.${ext}`);
    }
    candidateUrls.push(pageAlignedRawUrl, rawUrl);

    const dedupCandidates = uniqueNonEmptyUrls(candidateUrls);
    const displayImgUrl = domMatch?.displayUrl || pageAlignedRawUrl || dedupCandidates[0] || "";
    const localFileName = buildSafeMediaFilename(index, loraStem, ext);

    return {
      index: index + 1,
      id: imgObj.id || uuid || index + 1,
      uuid: uuid || null,
      isVideo: false,
      type: "image",
      extension: ext,
      fallbackExtension: ext,
      localFileName,
      downloadUrl: dedupCandidates[0] || displayImgUrl,
      fallbackUrl: displayImgUrl,
      displayUrl: displayImgUrl,
      posterUrl: "",
      candidateUrls: dedupCandidates,
      width: imgObj.width || domMatch?.width || null,
      height: imgObj.height || domMatch?.height || null,
      meta: imgObj.meta || imgObj.metadata || null
    };
  }

  async function fetchModelDataFromApi(modelId) {
    if (!modelId) return null;
    if (cachedModelApiData[modelId]) return cachedModelApiData[modelId];
    try {
      const resp = await fetch(`${location.origin}/api/v1/models/${modelId}`, {
        credentials: "include"
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      cachedModelApiData[modelId] = data;
      return data;
    } catch (e) {
      return null;
    }
  }

  function formatSizeKB(sizeKB) {
    if (!sizeKB || isNaN(sizeKB)) return "";
    if (sizeKB >= 1024 * 1024) {
      return `${(sizeKB / (1024 * 1024)).toFixed(2)} GB`;
    }
    if (sizeKB >= 1024) {
      return `${(sizeKB / 1024).toFixed(2)} MB`;
    }
    return `${sizeKB.toFixed(0)} KB`;
  }

  function formatCompactNumber(num) {
    if (num === undefined || num === null || num === "-" || isNaN(Number(num))) return String(num || "0");
    const n = Number(num);
    if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
    return n.toLocaleString("en-US");
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeJsStr(str) {
    return String(str || "")
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\r/g, "")
      .replace(/\n/g, " ");
  }

  function escapeJsAttr(str) {
    return escapeHtml(escapeJsStr(str));
  }

  function renderStaticMediaCardHtml(item) {
    const firstSrc = item.localSrc || item.displaySrc || item.cdnSrc || "";
    const posterAttr = item.posterSrc ? ` poster="${escapeHtml(item.posterSrc)}"` : "";
    const mediaEl = item.isVideo
      ? `<video src="${escapeHtml(firstSrc)}"${posterAttr} preload="metadata" autoplay loop muted playsinline controls data-fb-idx="0" onerror="handleMediaError(this, ${item.idx})"></video>`
      : `<img src="${escapeHtml(firstSrc)}" alt="Example #${escapeHtml(item.idxStr)}" loading="eager" data-fb-idx="0" onclick="openLightbox(${item.idx})" onerror="handleMediaError(this, ${item.idx})" />`;

    const hasPrompt = Boolean(item.prompt || item.negativePrompt || item.steps || item.sampler);
    const promptBlock = item.prompt
      ? `<div>
          <div class="civ-prompt-hdr">
            <span>PROMPT</span>
            <button type="button" class="civ-copy-mini" onclick="copyPromptByIdx(${item.idx})">Copy 📋</button>
          </div>
          <div class="civ-prompt-box">${escapeHtml(item.prompt)}</div>
        </div>`
      : "";
    const negBlock = item.negativePrompt
      ? `<div>
          <div class="civ-prompt-hdr">
            <span>NEGATIVE PROMPT</span>
            <button type="button" class="civ-copy-mini" onclick="copyNegPromptByIdx(${item.idx})">Copy 📋</button>
          </div>
          <div class="civ-prompt-box">${escapeHtml(item.negativePrompt)}</div>
        </div>`
      : "";

    return `
      <div class="civ-media-card" data-card-idx="${item.idx}">
        ${mediaEl}
        <div class="civ-media-top-right">
          ${item.prompt ? `<button type="button" class="civ-media-icon-btn" onclick="copyPromptByIdx(${item.idx})" title="Copy Generation Prompt">📋</button>` : ""}
          <a href="${escapeHtml(item.cdnSrc || item.displaySrc)}" target="_blank" rel="noopener" class="civ-media-icon-btn" title="Open Original on Civitai CDN">🔗</a>
        </div>
        <div class="civ-media-bottom-bar">
          <div class="civ-reactions-pill">
            <span>+ 😊</span>
            <span>👍</span>
            <span>❤️</span>
            <span style="color:#ffd43b;">⚡ #${escapeHtml(item.idxStr)}</span>
          </div>
          ${hasPrompt ? `<button type="button" class="civ-info-i-btn" onclick="togglePromptOverlay(${item.idx})" title="Show Generation Prompt & Parameters">i</button>` : ""}
        </div>
        <div class="civ-prompt-overlay" id="prompt-ov-${item.idx}">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong style="color:#74c0fc;">Generation Data (#${escapeHtml(item.idxStr)})</strong>
            <button type="button" class="civ-btn-top" style="padding:2px 8px;font-size:11px;" onclick="togglePromptOverlay(${item.idx})">✕ Close</button>
          </div>
          ${promptBlock}
          ${negBlock}
          <div style="font-size:11.5px;color:#adb5bd;">
            Steps: <strong>${escapeHtml(item.steps || "-")}</strong> | Sampler: <strong>${escapeHtml(item.sampler || "-")}</strong> | CFG: <strong>${escapeHtml(item.cfgScale || "-")}</strong> | Seed: <strong>${escapeHtml(item.seed || "-")}</strong>
          </div>
        </div>
      </div>`;
  }

  // Build TXT, MD, JSON, .civitai.info, and an authentic Civitai-Replica HTML page!
  function buildGeneratedFiles(payload, loraStem) {
    const cleanLoraStem = sanitizeSegment(loraStem || payload.title || "LoRA_Model", 75);
    const triggerList = Array.isArray(payload.triggerWords) && payload.triggerWords.length > 0
      ? payload.triggerWords
      : [];
    const triggerStr = triggerList.length > 0
      ? triggerList.join(", ")
      : "None (No trigger words required)";

    const extraRowsText = Object.entries(payload.detailsTableExtras || {})
      .map(([k, v]) => `- ${k}: ${v}`)
      .join("\n");

    const mediaPromptsMd = (payload.media || [])
      .map((m, idx) => {
        const label = m.isVideo ? `Video #${idx + 1}` : `Image #${idx + 1}`;
        const localFile = m.localFileName || buildSafeMediaFilename(idx, cleanLoraStem, m.extension);
        const meta = m.meta || {};
        const promptLine = meta.prompt ? `\n  - **Prompt:** \`${meta.prompt}\`` : "";
        const negLine = meta.negativePrompt ? `\n  - **Negative Prompt:** \`${meta.negativePrompt}\`` : "";
        const paramsLine =
          meta.steps || meta.sampler || meta.cfgScale || meta.seed
            ? `\n  - **Params:** Steps: ${meta.steps || "-"} | Sampler: ${meta.sampler || "-"} | CFG: ${meta.cfgScale || "-"} | Seed: ${meta.seed || "-"}`
            : "";
        return `- **${label}** ([Local File](${encodeURI(localFile)}) | [Civitai CDN](${m.downloadUrl}))${promptLine}${negLine}${paramsLine}`;
      })
      .join("\n");

    const txt = [
      "================================================================================",
      `MODEL TITLE:   ${payload.title}`,
      `VERSION:       ${payload.versionName}`,
      `FILENAME:      ${payload.fileName}`,
      payload.rawStorageFileName && payload.rawStorageFileName !== payload.fileName
        ? `STORAGE NAME:  ${payload.rawStorageFileName}`
        : null,
      `TRIGGER WORDS: ${triggerStr}`,
      "================================================================================",
      "",
      "[MODEL DETAILS]",
      `Page URL:      ${payload.pageUrl}`,
      `Model Type:    ${payload.modelType}`,
      `Base Model:    ${payload.baseModel}`,
      `File Format:   ${payload.fileFormat || "SafeTensor"} (${payload.fileSizeFormatted || "Unknown size"})`,
      `Training:      ${payload.training || "N/A"}`,
      `Usage Tips:    ${payload.usageTips || "N/A"}`,
      `Hash (AutoV2): ${payload.hashes?.AutoV2 || payload.hashes?.SHA256 || "N/A"}`,
      `SHA256:        ${payload.hashes?.SHA256 || "N/A"}`,
      `AIR ID:        ${payload.air || "N/A"}`,
      `Published:     ${payload.publishedAt || "N/A"}`,
      `Creator:       ${payload.creator || "N/A"}`,
      `Reviews/Stats: ${payload.reviews || ""} | ${payload.statsSummary || ""}`,
      `Tags:          ${(payload.tags || []).join(", ") || "N/A"}`,
      "",
      "[RAW DETAILS TABLE]",
      extraRowsText || "N/A",
      "",
      "================================================================================",
      "[DESCRIPTION]",
      "================================================================================",
      payload.descriptionText || "No description provided.",
      payload.versionDescriptionText
        ? `\n--- ABOUT THIS VERSION (${payload.versionName}) ---\n${payload.versionDescriptionText}`
        : "",
      "",
      "================================================================================",
      `[EXAMPLE MEDIA (${(payload.media || []).length} total)]`,
      "================================================================================",
      ...(payload.media || []).map((m, i) => {
        const localFile = m.localFileName || buildSafeMediaFilename(i, cleanLoraStem, m.extension);
        const p = m.meta?.prompt ? ` | Prompt: ${m.meta.prompt}` : "";
        return `#${String(i + 1).padStart(2, "0")} [${m.isVideo ? "VIDEO" : "IMAGE"}] ${localFile} -> ${m.downloadUrl}${p}`;
      })
    ]
      .filter((line) => line !== null)
      .join("\n");

    const md = [
      `# ${payload.title}`,
      "",
      `> **Version:** \`${payload.versionName}\` | **Base Model:** \`${payload.baseModel}\` | **Type:** \`${payload.modelType}\``,
      "",
      "## Quick Copy Reference",
      "",
      "| Field | Value |",
      "| :--- | :--- |",
      `| **Model Title** | ${payload.title} |`,
      `| **Active Version** | ${payload.versionName} |`,
      `| **Full Filename** | \`${payload.fileName}\` |`,
      `| **Trigger Words** | \`${triggerStr}\` |`,
      `| **Base Model** | ${payload.baseModel} |`,
      `| **Model Type** | ${payload.modelType} |`,
      `| **Training** | ${payload.training || "N/A"} |`,
      `| **Usage Tips** | ${payload.usageTips || "N/A"} |`,
      `| **Hash (AutoV2)** | \`${payload.hashes?.AutoV2 || "N/A"}\` |`,
      `| **Hash (SHA256)** | \`${payload.hashes?.SHA256 || "N/A"}\` |`,
      `| **AIR** | \`${payload.air || "N/A"}\` |`,
      `| **File Info** | ${payload.fileFormat || "SafeTensor"} (${payload.fileSizeFormatted || "N/A"}) |`,
      `| **Published** | ${payload.publishedAt || "N/A"} |`,
      `| **Creator** | ${payload.creator || "N/A"} |`,
      `| **Reviews & Stats** | ${payload.reviews || "N/A"} — ${payload.statsSummary || ""} |`,
      `| **Tags** | ${(payload.tags || []).join(", ") || "N/A"} |`,
      `| **Civitai Page URL** | [${payload.pageUrl}](${payload.pageUrl}) |`,
      "",
      "## Description",
      "",
      payload.descriptionText || "_No description provided._",
      payload.versionDescriptionText
        ? `\n### About Version: ${payload.versionName}\n\n${payload.versionDescriptionText}`
        : "",
      "",
      `## Example Images & Videos (${(payload.media || []).length})`,
      "",
      mediaPromptsMd || "_No media items found._",
      ""
    ].join("\n");

    const jsonStr = JSON.stringify(payload, null, 2);

    const civitaiInfoObj = payload.rawVersionApiData || {
      id: payload.versionId,
      modelId: payload.modelId,
      name: payload.versionName,
      trainedWords: payload.triggerWords,
      baseModel: payload.baseModel,
      description: payload.versionDescriptionHtml || payload.descriptionHtml,
      model: {
        name: payload.title,
        type: payload.modelType,
        tags: payload.tags
      },
      files: [
        {
          name: payload.fileName,
          primary: true,
          hashes: payload.hashes
        }
      ],
      images: (payload.media || []).map((m) => ({
        url: m.downloadUrl,
        type: m.type,
        meta: m.meta
      }))
    };
    const civitaiInfoStr = JSON.stringify(civitaiInfoObj, null, 2);

    const dlCountRaw = payload.stats?.downloadCount ?? payload.stats?.downloadCountAllTime ?? 0;
    const likesCountRaw = payload.stats?.thumbsUpCount ?? payload.stats?.thumbsUpCountAllTime ?? 0;
    const genCountRaw = payload.stats?.generationCount ?? payload.stats?.generationCountAllTime ?? 0;
    const collCountRaw = payload.stats?.collectedCount ?? payload.stats?.collectedCountAllTime ?? 0;
    const buzzCountRaw = payload.stats?.tippedAmountCount ?? payload.stats?.tippedAmountCountAllTime ?? 0;
    const dlFormatted = formatCompactNumber(dlCountRaw);
    const likesFormatted = formatCompactNumber(likesCountRaw);
    const genFormatted = formatCompactNumber(genCountRaw);
    const collFormatted = formatCompactNumber(collCountRaw);
    const buzzFormatted = formatCompactNumber(buzzCountRaw);

    const versionPillsHtml = (Array.isArray(payload.allVersionsList) && payload.allVersionsList.length > 0
      ? payload.allVersionsList
      : [{ id: payload.versionId, name: payload.versionName }]
    )
      .map((v) => {
        const isAct = String(v.id) === String(payload.versionId) || v.name === payload.versionName;
        let verUrl = payload.pageUrl || "#";
        try {
          if (payload.modelId && payload.pageUrl) {
            verUrl = `${new URL(payload.pageUrl).origin}/models/${payload.modelId}?modelVersionId=${v.id}`;
          }
        } catch (e) {}
        return `<a href="${escapeHtml(verUrl)}" target="_blank" rel="noopener" class="civ-version-tab ${isAct ? "active" : ""}">
          <span class="ver-icon">🏷️</span>
          <span>${escapeHtml(v.name || "v1.0")}</span>
        </a>`;
      })
      .join("\n");

    const tagPillsHtml = (payload.tags || [])
      .slice(0, 14)
      .map((t, idx) => `<span class="civ-tag-pill ${idx === 0 ? "primary-tag" : ""}">${escapeHtml(String(t).toUpperCase())}</span>`)
      .join("\n");

    const triggerBadgesHtml = triggerList.length > 0
      ? triggerList
          .map(
            (tw) =>
              `<button type="button" class="civ-trigger-badge" onclick="copyText('${escapeJsAttr(tw)}', this)" title="Click to copy trigger word">
                <span>${escapeHtml(String(tw).toUpperCase())}</span>
                <span class="copy-ic">❐</span>
              </button>`
          )
          .join(" ")
      : `<span style="color:#909296;font-size:12px;">No trigger words</span>`;

    const autoV2Hash = payload.hashes?.AutoV2 || (payload.hashes?.SHA256 ? payload.hashes.SHA256.slice(0, 10) : "N/A");
    const airFull = payload.air || `civitai:${payload.modelId || "0"}@${payload.versionId || "0"}`;
    const mIdStr = String(payload.modelId || "0");
    const vIdStr = String(payload.versionId || "0");

    let directModelDownloadUrl = payload.pageUrl || "#";
    try {
      if (payload.versionId && payload.pageUrl) {
        directModelDownloadUrl = `${new URL(payload.pageUrl).origin}/api/download/models/${payload.versionId}`;
      }
    } catch (e) {}

    // Serialize media items for the 2-up Civitai carousel + grid view + prompt popover
    const clientMediaItems = (payload.media || []).map((m, i) => {
      const idxStr = String(i + 1).padStart(2, "0");
      const rawLocalName = m.localFileName || buildSafeMediaFilename(i, cleanLoraStem, m.extension);
      const localSrc = encodeURI(rawLocalName);
      const fallbacks = uniqueNonEmptyUrls([
        localSrc,
        m.displayUrl,
        m.downloadUrl,
        m.fallbackUrl,
        ...(Array.isArray(m.candidateUrls) ? m.candidateUrls : [])
      ]);
      return {
        idx: i,
        idxStr,
        isVideo: Boolean(m.isVideo),
        localSrc,
        cdnSrc: m.downloadUrl || m.displayUrl || "",
        displaySrc: m.displayUrl || m.downloadUrl || "",
        posterSrc: m.posterUrl || "",
        fallbacks,
        width: m.width || null,
        height: m.height || null,
        prompt: String(m.meta?.prompt || ""),
        negativePrompt: String(m.meta?.negativePrompt || ""),
        sampler: String(m.meta?.sampler || ""),
        steps: String(m.meta?.steps || ""),
        cfgScale: String(m.meta?.cfgScale || ""),
        seed: String(m.meta?.seed || "")
      };
    });
    const clientMediaJson = JSON.stringify(clientMediaItems).replace(/<\/script>/gi, "<\\/script>");

    // Determine whether initial media items are predominantly landscape (like 1536x864 in H3/LTX)
    const firstItem = clientMediaItems[0];
    const isLandscapeMedia = Boolean(
      firstItem && firstItem.width && firstItem.height && firstItem.width > firstItem.height * 1.15
    );

    // Pre-render the first 2 media cards directly into static HTML so #media-stage is NEVER empty!
    const initialSlice = clientMediaItems.slice(0, 2);
    const initialStageHtml = initialSlice.length > 0
      ? initialSlice.map(renderStaticMediaCardHtml).join("\n")
      : `<div style="grid-column:1/-1;padding:48px;text-align:center;color:#909296;background:#141517;border-radius:12px;border:1px solid #2c2e33;">No preview media found on this page.</div>`;

    const initialStageClasses = [
      "civ-carousel-pair",
      initialSlice.length === 1 ? "single-item" : "",
      isLandscapeMedia ? "landscape-cards" : ""
    ]
      .filter(Boolean)
      .join(" ");

    const thumbStripHtml = clientMediaItems.length > 1
      ? `<div class="civ-thumb-strip" id="civ-thumb-strip">
          ${clientMediaItems
            .map((item, idx) => {
              const activeCls = idx < 2 ? "active" : "";
              const thumbUrl = item.isVideo
                ? (item.posterSrc || "")
                : (item.localSrc || item.displaySrc);
              return `<button type="button" class="civ-thumb-item ${activeCls}" data-thumb-idx="${idx}" onclick="jumpToMedia(${idx})" title="${item.isVideo ? "Video" : "Image"} #${item.idxStr}">
                ${
                  item.isVideo && !thumbUrl
                    ? `<span class="civ-thumb-vid-tag">🎬 #${item.idxStr}</span>`
                    : `<img src="${escapeHtml(thumbUrl || item.localSrc)}" alt="#${item.idxStr}" onerror="if(this.src!=='${escapeJsAttr(item.displaySrc)}')this.src='${escapeJsAttr(item.displaySrc)}'" />`
                }
                ${item.isVideo ? `<span class="civ-thumb-badge">▶</span>` : ""}
              </button>`;
            })
            .join("")}
        </div>`
      : "";

    const standardKeys = new Set([
      "type", "stats", "reviews", "published", "base model",
      "training", "usage tips", "hash", "trigger words", "trigger word", "air"
    ]);
    const extraDetailRowsHtml = Object.entries(payload.detailsTableExtras || {})
      .filter(([k]) => !standardKeys.has(k.toLowerCase().trim()))
      .map(
        ([k, v]) => `
        <div class="civ-detail-row">
          <div class="civ-detail-label">${escapeHtml(k)}</div>
          <div class="civ-detail-value">${escapeHtml(v)}</div>
        </div>`
      )
      .join("\n");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(payload.title)} - Civitai Offline Page</title>
  <style>
    :root {
      --dark-9: #101113;
      --dark-8: #141517;
      --dark-7: #1a1b1e;
      --dark-6: #25262b;
      --dark-5: #2c2e33;
      --dark-4: #373a40;
      --gray-0: #f8f9fa;
      --gray-2: #e9ecef;
      --gray-4: #ced4da;
      --gray-5: #adb5bd;
      --gray-6: #909296;
      --blue-6: #228be6;
      --blue-7: #1c7ed6;
      --blue-8: #1971c2;
      --blue-light: rgba(34, 139, 230, 0.18);
      --teal-6: #12b886;
      --teal-light: rgba(18, 184, 134, 0.18);
      --green-5: #40c057;
      --indigo-light: rgba(92, 124, 250, 0.22);
      --indigo-text: #bac8ff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background-color: var(--dark-7);
      color: var(--gray-2);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.55;
      -webkit-font-smoothing: antialiased;
    }
    a { color: #4dabf7; text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* Top Civitai Navbar */
    .civ-navbar {
      background: var(--dark-8);
      border-bottom: 1px solid var(--dark-5);
      padding: 0 24px;
      height: 56px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .civ-logo-group {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }
    .civ-logo {
      font-size: 21px;
      font-weight: 900;
      letter-spacing: 1px;
      color: #fff;
      display: flex;
      align-items: center;
      text-decoration: none !important;
    }
    .civ-logo span {
      background: linear-gradient(135deg, #228be6, #15aabf);
      color: #fff;
      padding: 1px 5px;
      border-radius: 4px;
      margin-left: 2px;
      font-size: 18px;
    }
    .civ-pro-badge {
      background: linear-gradient(135deg, #3b5bdb, #228be6);
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 6px;
      letter-spacing: 0.3px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .civ-search-bar {
      background: var(--dark-6);
      border: 1px solid var(--dark-4);
      border-radius: 6px;
      padding: 6px 12px;
      width: 420px;
      max-width: 38vw;
      color: var(--gray-5);
      font-size: 13px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      overflow: hidden;
    }
    .civ-search-text {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
      flex: 1;
    }
    .civ-nav-right {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .civ-btn-top {
      background: var(--dark-6);
      border: 1px solid var(--dark-4);
      color: var(--gray-2);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none !important;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
    }
    .civ-btn-top:hover { background: var(--dark-5); border-color: var(--blue-6); color: #fff; }

    /* Sub-navigation bar */
    .civ-subnav {
      background: var(--dark-8);
      border-bottom: 1px solid var(--dark-5);
      padding: 6px 24px;
      display: flex;
      align-items: center;
      gap: 6px;
      overflow-x: auto;
      font-size: 12.5px;
      color: var(--gray-5);
    }
    .civ-subnav-item {
      padding: 4px 11px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
      white-space: nowrap;
    }
    .civ-subnav-item.active {
      background: var(--dark-5);
      color: #fff;
    }

    /* Main Page Container */
    .civ-container {
      max-width: 1460px;
      margin: 0 auto;
      padding: 18px 28px 60px;
    }

    /* Title & Meta Bar */
    .civ-header-block {
      margin-bottom: 14px;
    }
    .civ-title-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .civ-h1 {
      margin: 0;
      font-size: 26px;
      font-weight: 800;
      color: #fff;
      line-height: 1.25;
      letter-spacing: -0.3px;
    }
    .civ-stat-chip {
      background: var(--dark-6);
      border: 1px solid var(--dark-4);
      color: var(--gray-2);
      padding: 3px 9px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .civ-substats-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
    }
    .civ-mini-stat {
      background: var(--dark-8);
      border: 1px solid var(--dark-5);
      color: var(--gray-4);
      padding: 2px 8px;
      border-radius: 5px;
      font-size: 11.5px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .civ-meta-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      color: var(--gray-6);
      font-size: 12px;
      margin-bottom: 12px;
    }
    .civ-tag-pill {
      background: var(--dark-6);
      color: var(--gray-4);
      border: 1px solid var(--dark-4);
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.4px;
    }
    .civ-tag-pill.primary-tag {
      background: rgba(34, 139, 230, 0.24);
      color: #74c0fc;
      border-color: rgba(34, 139, 230, 0.45);
    }

    /* Version Tabs Row */
    .civ-versions-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 14px;
    }
    .civ-version-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .civ-version-tab {
      background: var(--dark-6);
      border: 1px solid var(--dark-4);
      color: var(--gray-2);
      padding: 5px 11px;
      border-radius: 6px;
      font-size: 12.5px;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      text-decoration: none !important;
      transition: all 0.15s ease;
    }
    .civ-version-tab:hover {
      background: var(--dark-5);
      color: #fff;
    }
    .civ-version-tab.active {
      background: var(--blue-8);
      border-color: var(--blue-6);
      color: #fff;
    }

    /* Main 2-Column Layout matching Civitai */
    .civ-main-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 360px;
      gap: 24px;
      align-items: start;
    }
    @media (max-width: 1060px) {
      .civ-main-grid {
        grid-template-columns: 1fr;
      }
    }

    /* Left Column: 2-Up Carousel & Gallery */
    .civ-carousel-wrapper {
      margin-bottom: 22px;
    }
    .civ-carousel-stage-wrap {
      position: relative;
      min-height: 320px;
    }
    .civ-carousel-pair {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }
    .civ-carousel-pair.single-item {
      grid-template-columns: minmax(0, 680px);
    }
    .civ-carousel-pair.grid-all-mode {
      grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
    }
    @media (max-width: 720px) {
      .civ-carousel-pair {
        grid-template-columns: 1fr;
      }
    }
    .civ-media-card {
      position: relative;
      background: var(--dark-9);
      border: 1px solid var(--dark-5);
      border-radius: 12px;
      overflow: hidden;
      height: 450px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    }
    .civ-carousel-pair.landscape-cards .civ-media-card {
      height: 340px;
    }
    .civ-media-card img,
    .civ-media-card video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      cursor: zoom-in;
      background: #0c0d0f;
    }
    body.fit-contain-mode .civ-media-card img,
    body.fit-contain-mode .civ-media-card video {
      object-fit: contain;
    }
    .civ-media-top-right {
      position: absolute;
      top: 10px;
      right: 10px;
      display: flex;
      gap: 6px;
      z-index: 4;
    }
    .civ-media-icon-btn {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: rgba(20, 21, 23, 0.78);
      backdrop-filter: blur(6px);
      border: 1px solid rgba(255, 255, 255, 0.18);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      cursor: pointer;
      text-decoration: none !important;
      padding: 0;
    }
    .civ-media-icon-btn:hover {
      background: rgba(34, 139, 230, 0.9);
    }
    .civ-media-bottom-bar {
      position: absolute;
      bottom: 10px;
      left: 10px;
      right: 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      pointer-events: none;
      z-index: 4;
    }
    .civ-reactions-pill {
      pointer-events: auto;
      background: rgba(20, 21, 23, 0.8);
      backdrop-filter: blur(6px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      padding: 3px 9px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 11.5px;
      font-weight: 700;
      color: #fff;
    }
    .civ-info-i-btn {
      pointer-events: auto;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: rgba(20, 21, 23, 0.85);
      backdrop-filter: blur(6px);
      border: 1px solid rgba(255, 255, 255, 0.25);
      color: #fff;
      font-weight: 700;
      font-style: italic;
      font-family: Georgia, serif;
      font-size: 13px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }
    .civ-info-i-btn:hover {
      background: var(--blue-6);
      border-color: #74c0fc;
    }
    .civ-prompt-overlay {
      position: absolute;
      inset: 0;
      background: rgba(16, 17, 19, 0.95);
      backdrop-filter: blur(8px);
      padding: 14px;
      overflow-y: auto;
      display: none;
      flex-direction: column;
      gap: 10px;
      z-index: 6;
      font-size: 12.5px;
    }
    .civ-prompt-overlay.open {
      display: flex;
    }
    .civ-prompt-hdr {
      font-size: 11px;
      color: #909296;
      margin-bottom: 4px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 700;
    }
    .civ-copy-mini {
      background: var(--dark-6);
      border: 1px solid var(--dark-4);
      color: #74c0fc;
      border-radius: 4px;
      padding: 2px 7px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }
    .civ-copy-mini:hover {
      background: var(--blue-8);
      color: #fff;
    }
    .civ-prompt-box {
      background: var(--dark-7);
      border: 1px solid var(--dark-4);
      border-radius: 6px;
      padding: 8px 10px;
      font-family: monospace;
      font-size: 11.5px;
      color: var(--gray-2);
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* Carousel Left / Right Floating Buttons */
    .civ-carousel-nav {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: rgba(26, 27, 30, 0.82);
      backdrop-filter: blur(6px);
      border: 1px solid rgba(255, 255, 255, 0.22);
      color: #fff;
      font-size: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 10;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
      user-select: none;
      padding: 0;
    }
    .civ-carousel-nav:hover {
      background: var(--blue-7);
      border-color: #74c0fc;
    }
    .civ-carousel-nav.prev { left: 10px; }
    .civ-carousel-nav.next { right: 10px; }

    /* Thumbnail Strip & Footer Controls */
    .civ-thumb-strip {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding: 8px 0 4px;
    }
    .civ-thumb-item {
      position: relative;
      width: 58px;
      height: 44px;
      border-radius: 6px;
      overflow: hidden;
      border: 2px solid var(--dark-4);
      background: var(--dark-9);
      padding: 0;
      cursor: pointer;
      flex-shrink: 0;
      opacity: 0.65;
      transition: all 0.15s ease;
    }
    .civ-thumb-item:hover,
    .civ-thumb-item.active {
      opacity: 1;
      border-color: var(--blue-6);
    }
    .civ-thumb-item img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .civ-thumb-vid-tag {
      font-size: 10px;
      color: #74c0fc;
      font-weight: 700;
    }
    .civ-thumb-badge {
      position: absolute;
      bottom: 2px;
      right: 2px;
      background: rgba(0, 0, 0, 0.75);
      color: #fff;
      font-size: 9px;
      padding: 1px 4px;
      border-radius: 3px;
    }
    .civ-carousel-dots {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-top: 8px;
      color: var(--gray-6);
      font-size: 12px;
    }
    .civ-carousel-links {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .civ-link-btn {
      cursor: pointer;
      color: #74c0fc;
      font-weight: 600;
    }
    .civ-link-btn:hover { text-decoration: underline; }

    /* Description Section (Prose matching Civitai) */
    .civ-description-section {
      margin-top: 14px;
      padding-top: 6px;
    }
    .civ-prose {
      color: var(--gray-2);
      font-size: 14.5px;
      line-height: 1.62;
      overflow-wrap: break-word;
    }
    .civ-prose h1, .civ-prose h2, .civ-prose h3, .civ-prose h4 {
      color: #fff;
      margin-top: 16px;
      margin-bottom: 10px;
      font-weight: 700;
    }
    .civ-prose p { margin: 0 0 12px 0; }
    .civ-prose img { max-width: 100%; height: auto; border-radius: 8px; }
    .civ-prose pre, .civ-prose code {
      background: var(--dark-8);
      border: 1px solid var(--dark-5);
      border-radius: 5px;
      padding: 2px 6px;
      font-family: monospace;
      font-size: 13px;
      color: #74c0fc;
    }
    .civ-prose pre { padding: 12px; overflow-x: auto; }
    .civ-prose blockquote {
      margin: 14px 0;
      padding: 10px 16px;
      border-left: 4px solid var(--blue-6);
      background: var(--dark-8);
      border-radius: 0 6px 6px 0;
    }

    /* Right Sidebar Stack */
    .civ-sidebar {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .civ-card {
      background: var(--dark-6);
      border: 1px solid var(--dark-4);
      border-radius: 8px;
      overflow: hidden;
    }
    .civ-card-inner {
      padding: 12px 14px;
    }

    /* Create & Quick Action Bar */
    .civ-loaded-dot {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--green-5);
      font-weight: 700;
      background: rgba(64, 192, 87, 0.12);
      border: 1px solid rgba(64, 192, 87, 0.3);
      padding: 2px 8px;
      border-radius: 999px;
      margin-bottom: 8px;
    }
    .civ-loaded-dot::before {
      content: "";
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--green-5);
    }
    .civ-create-btn {
      width: 100%;
      background: var(--blue-6);
      color: #fff !important;
      border: none;
      border-radius: 6px;
      padding: 9px 14px;
      font-size: 13.5px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      cursor: pointer;
      text-decoration: none !important;
      margin-bottom: 10px;
    }
    .civ-create-btn:hover { background: var(--blue-7); }
    .civ-icon-bar {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 6px;
    }
    .civ-square-btn {
      background: var(--dark-5);
      border: 1px solid var(--dark-4);
      color: var(--gray-4);
      height: 32px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 13px;
      text-decoration: none !important;
      padding: 0;
    }
    .civ-square-btn:hover {
      background: var(--dark-4);
      color: #fff;
      border-color: var(--blue-6);
    }

    /* Download Card */
    .civ-dl-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 1px solid var(--dark-4);
      font-size: 13px;
    }
    .civ-dl-header strong { color: #fff; font-weight: 600; }
    .civ-dl-header span { color: var(--gray-6); font-size: 11.5px; }
    .civ-dl-body {
      padding: 12px 14px;
      background: var(--dark-7);
    }
    .civ-file-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin-bottom: 12px;
    }
    .civ-file-icon {
      width: 32px;
      height: 32px;
      border-radius: 6px;
      background: rgba(34, 139, 230, 0.16);
      border: 1px solid rgba(34, 139, 230, 0.35);
      color: #74c0fc;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .civ-file-meta {
      flex: 1;
      min-width: 0;
    }
    .civ-file-format {
      font-size: 13px;
      font-weight: 700;
      color: #fff;
      line-height: 1.3;
    }
    .civ-file-name {
      font-size: 12px;
      color: var(--gray-4);
      font-family: monospace;
      word-break: break-all;
      cursor: pointer;
      padding: 2px 0;
    }
    .civ-file-name:hover { color: #74c0fc; text-decoration: underline; }
    .civ-file-sub {
      font-size: 11.5px;
      color: var(--gray-6);
    }
    .civ-verified {
      font-size: 11.5px;
      color: var(--green-5);
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 2px;
    }
    .civ-dl-actions {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .civ-dl-btn {
      width: 100%;
      background: rgba(34, 139, 230, 0.18);
      border: 1px solid rgba(34, 139, 230, 0.35);
      color: #74c0fc !important;
      border-radius: 6px;
      padding: 9px 12px;
      font-size: 13px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      cursor: pointer;
      text-decoration: none !important;
      transition: all 0.15s ease;
    }
    .civ-dl-btn:hover {
      background: rgba(34, 139, 230, 0.28);
      color: #fff !important;
    }

    /* Accordion Cards (Details, About this version) */
    .civ-accordion-header {
      width: 100%;
      background: var(--dark-6);
      border: none;
      color: #fff;
      padding: 11px 14px;
      font-size: 13.5px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      border-bottom: 1px solid var(--dark-4);
    }
    .civ-accordion-header:hover { background: var(--dark-5); }
    .civ-accordion-body {
      background: var(--dark-7);
    }
    .civ-accordion-body.collapsed {
      display: none;
    }

    /* Details Rows matching Civitai Details Table */
    .civ-detail-row {
      display: grid;
      grid-template-columns: 105px 1fr;
      align-items: center;
      padding: 8px 14px;
      border-bottom: 1px solid var(--dark-5);
      font-size: 12.5px;
      gap: 10px;
    }
    .civ-detail-row:last-child { border-bottom: none; }
    .civ-detail-label {
      color: var(--gray-5);
      font-weight: 500;
    }
    .civ-detail-value {
      color: var(--gray-2);
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
      text-align: right;
    }
    .civ-type-badge {
      background: var(--dark-8);
      border: 1px solid var(--dark-4);
      color: #fff;
      font-size: 10.5px;
      font-weight: 800;
      padding: 2px 9px;
      border-radius: 999px;
      letter-spacing: 0.4px;
    }
    .civ-teal-badge {
      background: rgba(18, 184, 134, 0.18);
      color: #38d9a9;
      border: 1px solid rgba(18, 184, 134, 0.35);
      font-size: 10.5px;
      font-weight: 800;
      padding: 2px 8px;
      border-radius: 4px;
      text-transform: uppercase;
    }
    .civ-hash-box {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--dark-4);
      border-radius: 4px;
      overflow: hidden;
      font-family: monospace;
      font-size: 11px;
      cursor: pointer;
    }
    .civ-hash-box .h-lbl {
      background: var(--dark-8);
      color: var(--gray-4);
      padding: 2px 7px;
      font-weight: 700;
      border-right: 1px solid var(--dark-4);
    }
    .civ-hash-box .h-val {
      background: var(--dark-6);
      color: #fff;
      padding: 2px 8px;
    }
    .civ-trigger-badge {
      background: var(--indigo-light);
      color: var(--indigo-text);
      border: 1px solid rgba(116, 143, 252, 0.35);
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 800;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      text-align: left;
      word-break: break-word;
    }
    .civ-trigger-badge:hover {
      background: rgba(92, 124, 250, 0.35);
      color: #fff;
    }
    .civ-air-box {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      background: var(--dark-8);
      border: 1px solid var(--dark-4);
      padding: 2px 7px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 11px;
      color: var(--gray-4);
      cursor: pointer;
    }
    .civ-air-num {
      background: var(--blue-8);
      color: #fff;
      padding: 0 5px;
      border-radius: 3px;
      font-weight: 700;
    }

    /* Toast notification */
    #civ-toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #0ca678;
      color: #fff;
      padding: 10px 18px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 13px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
      z-index: 9999;
    }
    #civ-toast.show { opacity: 1; }

    /* Lightbox Modal */
    #civ-lightbox {
      position: fixed;
      inset: 0;
      background: rgba(10, 11, 13, 0.92);
      z-index: 9998;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    #civ-lightbox.open { display: flex; }
    #civ-lightbox img, #civ-lightbox video {
      max-width: 92vw;
      max-height: 90vh;
      border-radius: 8px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.8);
    }
    .civ-lb-close {
      position: absolute;
      top: 20px;
      right: 24px;
      background: var(--dark-6);
      border: 1px solid var(--dark-4);
      color: #fff;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      font-size: 18px;
      cursor: pointer;
    }
  </style>
</head>
<body>

  <!-- Top Civitai Bar -->
  <header class="civ-navbar">
    <div class="civ-logo-group">
      <a href="${escapeHtml(payload.pageUrl)}" target="_blank" rel="noopener" class="civ-logo">
        CIVIT<span>AI</span>
      </a>
      <span class="civ-pro-badge">💎 Pro Offline</span>
    </div>
    <div class="civ-search-bar">
      <span class="civ-search-text">🔍 ${escapeHtml(payload.title)}</span>
      <span style="font-size:11px;background:var(--dark-5);padding:1px 6px;border-radius:4px;flex-shrink:0;">/</span>
    </div>
    <div class="civ-nav-right">
      <button type="button" class="civ-btn-top" id="toggle-fit-mode" onclick="toggleFitMode()" title="Switch between Civitai Cover crop and Full Uncropped Fit">
        📐 Fit / Crop
      </button>
      <button type="button" class="civ-btn-top" id="toggle-gallery-mode" onclick="toggleGalleryMode()">
        🖼️ Show All Media (${clientMediaItems.length})
      </button>
      <a href="${escapeHtml(payload.pageUrl)}" target="_blank" rel="noopener" class="civ-btn-top">
        🌐 Open on Civitai ↗
      </a>
    </div>
  </header>

  <!-- Sub-navigation Bar -->
  <nav class="civ-subnav">
    <span class="civ-subnav-item">🏠 Home</span>
    <span class="civ-subnav-item active">🧊 Models</span>
    <span class="civ-subnav-item">🖼️ Images</span>
    <span class="civ-subnav-item">🎬 Videos</span>
    <span class="civ-subnav-item">📦 3D Models</span>
    <span class="civ-subnav-item">📝 Articles</span>
  </nav>

  <!-- Main Civitai Content Container -->
  <main class="civ-container">

    <!-- Title, Stats & Category Tags -->
    <div class="civ-header-block">
      <div class="civ-title-row">
        <h1 class="civ-h1">${escapeHtml(payload.title)}</h1>
        <span class="civ-stat-chip" title="Likes / Thumbs Up">👍 ${escapeHtml(likesFormatted)}</span>
        <span class="civ-stat-chip" title="Downloads">⬇ ${escapeHtml(dlFormatted)}</span>
      </div>
      <div class="civ-substats-row">
        ${collCountRaw ? `<span class="civ-mini-stat" title="Collections">🔖 ${escapeHtml(collFormatted)}</span>` : ""}
        ${genCountRaw ? `<span class="civ-mini-stat" title="Generations">🖌 ${escapeHtml(genFormatted)}</span>` : ""}
        ${buzzCountRaw ? `<span class="civ-mini-stat" title="Buzz"><span style="color:#ffd43b;">⚡</span> ${escapeHtml(buzzFormatted)}</span>` : `<span class="civ-mini-stat"><span style="color:#ffd43b;">⚡</span> ${escapeHtml(dlFormatted)}</span>`}
      </div>
      <div class="civ-meta-row">
        <span>Updated: ${escapeHtml(payload.publishedAt || "Recently")}</span>
        ${payload.creator ? `<span>• by <strong style="color:#fff;">${escapeHtml(payload.creator)}</strong></span>` : ""}
        ${tagPillsHtml}
      </div>

      <!-- Version Tabs -->
      <div class="civ-versions-bar">
        <div class="civ-version-tabs">
          ${versionPillsHtml}
        </div>
      </div>
    </div>

    <!-- 2-Column Main Grid (Left: Media Carousel + Description | Right: Sidebar Cards) -->
    <div class="civ-main-grid">

      <!-- Left Column -->
      <div class="civ-left-col">
        <!-- 2-Up Media Carousel (Pre-rendered in static HTML + interactive JS!) -->
        <div class="civ-carousel-wrapper">
          <div class="civ-carousel-stage-wrap">
            <button type="button" class="civ-carousel-nav prev" id="car-prev" style="${clientMediaItems.length > 2 ? "display:flex;" : "display:none;"}" onclick="stepCarousel(-2)" title="Previous media">‹</button>
            <div class="${initialStageClasses}" id="media-stage">
              ${initialStageHtml}
            </div>
            <button type="button" class="civ-carousel-nav next" id="car-next" style="${clientMediaItems.length > 2 ? "display:flex;" : "display:none;"}" onclick="stepCarousel(2)" title="Next media">›</button>
          </div>
          ${thumbStripHtml}
          <div class="civ-carousel-dots">
            <span id="car-counter">Showing ${clientMediaItems.length > 0 ? `1–${Math.min(2, clientMediaItems.length)}` : "0"} of ${clientMediaItems.length} example media</span>
            <div class="civ-carousel-links">
              <span class="civ-link-btn" onclick="toggleFitMode()">📐 Toggle Fit/Crop</span>
              <span class="civ-link-btn" onclick="toggleGalleryMode()" id="car-mode-link">Switch to Full Grid View (${clientMediaItems.length}) ⊞</span>
            </div>
          </div>
        </div>

        <!-- Model Description Section -->
        <div class="civ-description-section">
          <div class="civ-prose">
            ${payload.descriptionHtml || `<pre style="white-space:pre-wrap">${escapeHtml(payload.descriptionText || "No description provided.")}</pre>`}
          </div>
        </div>
      </div>

      <!-- Right Sidebar Column -->
      <aside class="civ-sidebar">

        <!-- Top Create / Quick Action Card -->
        <div class="civ-card">
          <div class="civ-card-inner">
            <div class="civ-loaded-dot">Loaded</div>
            <a href="${escapeHtml(payload.pageUrl)}" target="_blank" rel="noopener" class="civ-create-btn">
              <span>🪄 Create</span>
            </a>
            <div class="civ-icon-bar">
              <button type="button" class="civ-square-btn" title="Copy Full Filename" onclick="copyText('${escapeJsAttr(payload.fileName)}', this)">📄</button>
              <button type="button" class="civ-square-btn" title="Copy Trigger Words" onclick="copyText('${escapeJsAttr(triggerStr)}', this)">🏷️</button>
              <button type="button" class="civ-square-btn" title="Copy AutoV2 Hash" onclick="copyText('${escapeJsAttr(autoV2Hash)}', this)">#️⃣</button>
              <button type="button" class="civ-square-btn" title="Copy AIR Identifier" onclick="copyText('${escapeJsAttr(airFull)}', this)">🔗</button>
              <button type="button" class="civ-square-btn" title="Toggle All Media Grid" onclick="toggleGalleryMode()">🖼️</button>
              <a href="${escapeHtml(payload.pageUrl)}" target="_blank" rel="noopener" class="civ-square-btn" title="Open Original Page">↗</a>
            </div>
          </div>
        </div>

        <!-- Download Card (Replica of Civitai Download Box) -->
        <div class="civ-card">
          <div class="civ-dl-header">
            <strong>Download</strong>
            <span>1 variant available</span>
          </div>
          <div class="civ-dl-body">
            <div class="civ-file-row">
              <div class="civ-file-icon">📦</div>
              <div class="civ-file-meta">
                <div class="civ-file-format">${escapeHtml(payload.fileFormat || "fp32 SafeTensor")}</div>
                <div class="civ-file-name" onclick="copyText('${escapeJsAttr(payload.fileName)}', this)" title="Click to copy full filename">
                  ${escapeHtml(payload.fileName)} 📋
                </div>
                <div class="civ-file-sub">Full precision • ${escapeHtml(payload.fileSizeFormatted || "SafeTensor")}</div>
                <div class="civ-verified">✔ Verified on Civitai</div>
              </div>
            </div>
            <div class="civ-dl-actions">
              <a href="${escapeHtml(directModelDownloadUrl)}" target="_blank" rel="noopener" class="civ-dl-btn" title="Download model weights from Civitai">
                <span>⬇ Download (${escapeHtml(payload.fileSizeFormatted || "SafeTensor")})</span>
              </a>
              <button type="button" class="civ-dl-btn" style="background:var(--dark-6);border-color:var(--dark-4);color:var(--gray-2)!important;padding:6px 10px;font-size:12px;" onclick="copyText('${escapeJsAttr(payload.fileName)}', this)">
                <span>📋 Copy Full Filename</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Details Accordion Card (Exact replica of Civitai Details Table) -->
        <div class="civ-card">
          <button type="button" class="civ-accordion-header" onclick="toggleAccordion('details-acc-body', this)">
            <span>Details</span>
            <span>^</span>
          </button>
          <div class="civ-accordion-body" id="details-acc-body">
            <div class="civ-detail-row">
              <div class="civ-detail-label">Type</div>
              <div class="civ-detail-value">
                <span class="civ-type-badge">${escapeHtml(payload.modelType || "LORA")}</span>
              </div>
            </div>
            <div class="civ-detail-row">
              <div class="civ-detail-label">Stats</div>
              <div class="civ-detail-value" style="font-weight:600;gap:10px;">
                <span>⬇ ${escapeHtml(dlFormatted)}</span>
                ${genCountRaw ? `<span>🖌 ${escapeHtml(genFormatted)}</span>` : ""}
                <span>👍 ${escapeHtml(likesFormatted)}</span>
              </div>
            </div>
            <div class="civ-detail-row">
              <div class="civ-detail-label">Reviews</div>
              <div class="civ-detail-value">
                <span style="color:var(--green-5);font-weight:600;">${escapeHtml(payload.reviews || "Very Positive")}</span>
              </div>
            </div>
            <div class="civ-detail-row">
              <div class="civ-detail-label">Published</div>
              <div class="civ-detail-value">${escapeHtml(payload.publishedAt || "N/A")}</div>
            </div>
            <div class="civ-detail-row">
              <div class="civ-detail-label">Base Model</div>
              <div class="civ-detail-value" style="font-weight:600;color:#fff;">${escapeHtml(payload.baseModel || "Unknown")}</div>
            </div>
            ${
              payload.training
                ? `<div class="civ-detail-row">
                    <div class="civ-detail-label">Training</div>
                    <div class="civ-detail-value"><span class="civ-teal-badge">${escapeHtml(payload.training)}</span></div>
                  </div>`
                : ""
            }
            ${
              payload.usageTips
                ? `<div class="civ-detail-row">
                    <div class="civ-detail-label">Usage Tips</div>
                    <div class="civ-detail-value"><span class="civ-teal-badge">${escapeHtml(payload.usageTips)}</span></div>
                  </div>`
                : ""
            }
            <div class="civ-detail-row">
              <div class="civ-detail-label">Hash</div>
              <div class="civ-detail-value">
                <div class="civ-hash-box" onclick="copyText('${escapeJsAttr(autoV2Hash)}', this)" title="Click to copy AutoV2 hash">
                  <span class="h-lbl">AUTOV2</span>
                  <span class="h-val">${escapeHtml(autoV2Hash)}</span>
                </div>
              </div>
            </div>
            <div class="civ-detail-row">
              <div class="civ-detail-label">Trigger Words</div>
              <div class="civ-detail-value">
                ${triggerBadgesHtml}
              </div>
            </div>
            <div class="civ-detail-row">
              <div class="civ-detail-label">AIR</div>
              <div class="civ-detail-value">
                <div class="civ-air-box" onclick="copyText('${escapeJsAttr(airFull)}', this)" title="Click to copy AIR ID">
                  <span>civitai:</span>
                  <span class="civ-air-num">${escapeHtml(mIdStr)}</span>
                  <span>@</span>
                  <span class="civ-air-num">${escapeHtml(vIdStr)}</span>
                  <span>❐</span>
                </div>
              </div>
            </div>
            ${extraDetailRowsHtml}
          </div>
        </div>

        <!-- About this version Accordion -->
        <div class="civ-card">
          <button type="button" class="civ-accordion-header" onclick="toggleAccordion('ver-acc-body', this)">
            <span>About this version</span>
            <span>⌄</span>
          </button>
          <div class="civ-accordion-body ${payload.versionDescriptionHtml ? "" : "collapsed"}" id="ver-acc-body" style="padding:14px;font-size:13px;">
            ${
              payload.versionDescriptionHtml ||
              `<div style="color:var(--gray-6);">Version: <strong>${escapeHtml(payload.versionName)}</strong><br/>File: <code>${escapeHtml(payload.fileName)}</code></div>`
            }
          </div>
        </div>

      </aside>
    </div>
  </main>

  <!-- Lightbox Modal -->
  <div id="civ-lightbox" onclick="closeLightbox(event)">
    <button type="button" class="civ-lb-close" onclick="closeLightbox(event)">✕</button>
    <div id="civ-lb-content"></div>
  </div>

  <!-- Copy Toast -->
  <div id="civ-toast">✅ Copied to clipboard!</div>

  <script>
    const MEDIA_ITEMS = ${clientMediaJson};
    const IS_LANDSCAPE_DEFAULT = ${isLandscapeMedia ? "true" : "false"};
    let carouselIndex = 0;
    let isFullGridMode = false;

    function escHtmlClient(s) {
      return String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function showToast(msg) {
      const t = document.getElementById("civ-toast");
      if (!t) return;
      t.textContent = msg || "✅ Copied to clipboard!";
      t.classList.add("show");
      clearTimeout(window.__toastTimer);
      window.__toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
    }

    function copyText(text) {
      navigator.clipboard.writeText(text || "");
      showToast("📋 Copied: " + (text && text.length > 42 ? text.slice(0, 42) + "..." : (text || "")));
    }

    function copyPromptByIdx(idx) {
      const item = MEDIA_ITEMS[idx];
      if (item && item.prompt) copyText(item.prompt);
    }

    function copyNegPromptByIdx(idx) {
      const item = MEDIA_ITEMS[idx];
      if (item && item.negativePrompt) copyText(item.negativePrompt);
    }

    function toggleAccordion(id) {
      const el = document.getElementById(id);
      if (el) el.classList.toggle("collapsed");
    }

    function toggleFitMode() {
      document.body.classList.toggle("fit-contain-mode");
    }

    // Automatic multi-step fallback if local media file is missing or moved
    function handleMediaError(el, idx) {
      const item = MEDIA_ITEMS[idx];
      if (!item || !Array.isArray(item.fallbacks)) return;
      let nextIdx = Number(el.getAttribute("data-fb-idx") || "0") + 1;
      while (nextIdx < item.fallbacks.length) {
        const candidate = item.fallbacks[nextIdx];
        if (candidate && candidate !== el.getAttribute("src")) {
          el.setAttribute("data-fb-idx", String(nextIdx));
          el.src = candidate;
          if (el.tagName && el.tagName.toLowerCase() === "video") {
            try { el.load(); } catch (e) {}
          }
          return;
        }
        nextIdx++;
      }
    }

    function buildMediaCardHtml(item) {
      const firstSrc = item.localSrc || item.displaySrc || item.cdnSrc || "";
      const posterAttr = item.posterSrc ? \` poster="\${escHtmlClient(item.posterSrc)}"\` : "";
      const mediaEl = item.isVideo
        ? \`<video src="\${escHtmlClient(firstSrc)}"\${posterAttr} preload="metadata" autoplay loop muted playsinline controls data-fb-idx="0" onerror="handleMediaError(this, \${item.idx})"></video>\`
        : \`<img src="\${escHtmlClient(firstSrc)}" alt="Example #\${escHtmlClient(item.idxStr)}" loading="lazy" data-fb-idx="0" onclick="openLightbox(\${item.idx})" onerror="handleMediaError(this, \${item.idx})" />\`;

      const hasPrompt = Boolean(item.prompt || item.negativePrompt || item.steps || item.sampler);
      return \`
        <div class="civ-media-card" data-card-idx="\${item.idx}">
          \${mediaEl}
          <div class="civ-media-top-right">
            \${item.prompt ? \`<button type="button" class="civ-media-icon-btn" onclick="copyPromptByIdx(\${item.idx})" title="Copy Generation Prompt">📋</button>\` : ""}
            <a href="\${escHtmlClient(item.cdnSrc || item.displaySrc)}" target="_blank" rel="noopener" class="civ-media-icon-btn" title="Open Original on Civitai CDN">🔗</a>
          </div>
          <div class="civ-media-bottom-bar">
            <div class="civ-reactions-pill">
              <span>+ 😊</span>
              <span>👍</span>
              <span>❤️</span>
              <span style="color:#ffd43b;">⚡ #\${escHtmlClient(item.idxStr)}</span>
            </div>
            \${hasPrompt ? \`<button type="button" class="civ-info-i-btn" onclick="togglePromptOverlay(\${item.idx})" title="Show Generation Prompt & Parameters">i</button>\` : ""}
          </div>
          <div class="civ-prompt-overlay" id="prompt-ov-\${item.idx}">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <strong style="color:#74c0fc;">Generation Data (#\${escHtmlClient(item.idxStr)})</strong>
              <button type="button" class="civ-btn-top" style="padding:2px 8px;font-size:11px;" onclick="togglePromptOverlay(\${item.idx})">✕ Close</button>
            </div>
            \${item.prompt ? \`<div><div class="civ-prompt-hdr"><span>PROMPT</span><button type="button" class="civ-copy-mini" onclick="copyPromptByIdx(\${item.idx})">Copy 📋</button></div><div class="civ-prompt-box">\${escHtmlClient(item.prompt)}</div></div>\` : ""}
            \${item.negativePrompt ? \`<div><div class="civ-prompt-hdr"><span>NEGATIVE PROMPT</span><button type="button" class="civ-copy-mini" onclick="copyNegPromptByIdx(\${item.idx})">Copy 📋</button></div><div class="civ-prompt-box">\${escHtmlClient(item.negativePrompt)}</div></div>\` : ""}
            <div style="font-size:11.5px;color:#adb5bd;">
              Steps: <strong>\${escHtmlClient(item.steps || "-")}</strong> | Sampler: <strong>\${escHtmlClient(item.sampler || "-")}</strong> | CFG: <strong>\${escHtmlClient(item.cfgScale || "-")}</strong> | Seed: <strong>\${escHtmlClient(item.seed || "-")}</strong>
            </div>
          </div>
        </div>
      \`;
    }

    function updateThumbHighlight() {
      const thumbs = document.querySelectorAll(".civ-thumb-item");
      thumbs.forEach((btn) => {
        const idx = Number(btn.getAttribute("data-thumb-idx"));
        if (isFullGridMode || (idx >= carouselIndex && idx < carouselIndex + 2)) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      });
    }

    function renderMediaStage() {
      const stage = document.getElementById("media-stage");
      const prevBtn = document.getElementById("car-prev");
      const nextBtn = document.getElementById("car-next");
      const counter = document.getElementById("car-counter");
      const modeLink = document.getElementById("car-mode-link");
      const topBtn = document.getElementById("toggle-gallery-mode");

      if (!MEDIA_ITEMS || MEDIA_ITEMS.length === 0) {
        stage.innerHTML = '<div style="grid-column:1/-1;padding:40px;text-align:center;color:#909296;">No preview media found.</div>';
        if (prevBtn) prevBtn.style.display = "none";
        if (nextBtn) nextBtn.style.display = "none";
        return;
      }

      if (isFullGridMode) {
        stage.className = "civ-carousel-pair grid-all-mode" + (IS_LANDSCAPE_DEFAULT ? " landscape-cards" : "");
        stage.innerHTML = MEDIA_ITEMS.map(buildMediaCardHtml).join("");
        if (prevBtn) prevBtn.style.display = "none";
        if (nextBtn) nextBtn.style.display = "none";
        if (counter) counter.textContent = \`Showing all \${MEDIA_ITEMS.length} media items\`;
        if (modeLink) modeLink.textContent = "Switch back to 2-Up Carousel ‹›";
        if (topBtn) topBtn.textContent = "🎠 2-Up Carousel View";
      } else {
        const slice = MEDIA_ITEMS.slice(carouselIndex, carouselIndex + 2);
        const pairLandscape = slice.some((m) => m.width && m.height && m.width > m.height * 1.15) || IS_LANDSCAPE_DEFAULT;
        stage.className =
          "civ-carousel-pair" +
          (slice.length === 1 ? " single-item" : "") +
          (pairLandscape ? " landscape-cards" : "");
        stage.innerHTML = slice.map(buildMediaCardHtml).join("");
        if (prevBtn) prevBtn.style.display = MEDIA_ITEMS.length > 2 ? "flex" : "none";
        if (nextBtn) nextBtn.style.display = MEDIA_ITEMS.length > 2 ? "flex" : "none";
        const endIdx = Math.min(carouselIndex + slice.length, MEDIA_ITEMS.length);
        if (counter) counter.textContent = \`Showing \${carouselIndex + 1}–\${endIdx} of \${MEDIA_ITEMS.length} example media\`;
        if (modeLink) modeLink.textContent = \`Switch to Full Grid View (\${MEDIA_ITEMS.length}) ⊞\`;
        if (topBtn) topBtn.textContent = \`🖼️ Show All Media (\${MEDIA_ITEMS.length})\`;
      }
      updateThumbHighlight();
    }

    function stepCarousel(delta) {
      if (MEDIA_ITEMS.length <= 2) return;
      carouselIndex += delta;
      if (carouselIndex < 0) {
        carouselIndex = Math.max(0, MEDIA_ITEMS.length - (MEDIA_ITEMS.length % 2 === 0 ? 2 : 1));
      } else if (carouselIndex >= MEDIA_ITEMS.length) {
        carouselIndex = 0;
      }
      renderMediaStage();
    }

    function jumpToMedia(idx) {
      isFullGridMode = false;
      carouselIndex = Math.floor(idx / 2) * 2;
      renderMediaStage();
    }

    function toggleGalleryMode() {
      isFullGridMode = !isFullGridMode;
      renderMediaStage();
    }

    function togglePromptOverlay(idx) {
      const ov = document.getElementById("prompt-ov-" + idx);
      if (ov) ov.classList.toggle("open");
    }

    function openLightbox(idx) {
      const item = MEDIA_ITEMS[idx];
      if (!item) return;
      const lb = document.getElementById("civ-lightbox");
      const content = document.getElementById("civ-lb-content");
      const firstSrc = item.localSrc || item.displaySrc || item.cdnSrc || "";
      if (item.isVideo) {
        content.innerHTML = \`<video src="\${escHtmlClient(firstSrc)}" controls autoplay loop data-fb-idx="0" onerror="handleMediaError(this, \${item.idx})"></video>\`;
      } else {
        content.innerHTML = \`<img src="\${escHtmlClient(firstSrc)}" data-fb-idx="0" onerror="handleMediaError(this, \${item.idx})" />\`;
      }
      lb.classList.add("open");
    }

    function closeLightbox(e) {
      if (e.target.id === "civ-lightbox" || e.target.classList.contains("civ-lb-close")) {
        document.getElementById("civ-lightbox").classList.remove("open");
      }
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" && !isFullGridMode) stepCarousel(-2);
      if (e.key === "ArrowRight" && !isFullGridMode) stepCarousel(2);
      if (e.key === "Escape") document.getElementById("civ-lightbox").classList.remove("open");
    });
  </script>
</body>
</html>`;

    return { txt, md, json: jsonStr, civitaiInfo: civitaiInfoStr, html };
  }

  async function extractModelPayload(specificVersionObj = null) {
    const modelId = getModelIdFromUrl();
    const nextExtracted = extractFromNextData(modelId);
    const nextModelData = nextExtracted ? nextExtracted.modelData : null;
    const apiData = (await fetchModelDataFromApi(modelId)) || nextModelData;
    const domScraped = scrapeDetailsTableFromDom();
    const detailsMap = domScraped.detailsMap || {};
    const cdnBase = detectCdnBaseFromDom();
    const liveDomMedia = collectLiveDomMedia();

    const targetVerId = specificVersionObj
      ? String(specificVersionObj.id)
      : detectActiveVersionId(apiData || nextModelData);

    let activeVersion = specificVersionObj;
    if (!activeVersion && apiData && Array.isArray(apiData.modelVersions)) {
      activeVersion =
        apiData.modelVersions.find((v) => String(v.id) === String(targetVerId)) ||
        apiData.modelVersions[0];
    }

    let nextVersion = null;
    if (nextModelData && Array.isArray(nextModelData.modelVersions)) {
      nextVersion =
        nextModelData.modelVersions.find((v) => String(v.id) === String(activeVersion?.id || targetVerId)) ||
        nextModelData.modelVersions[0];
    }

    let allVersionsList = (apiData?.modelVersions || nextModelData?.modelVersions || []).map((v) => ({
      id: v.id,
      name: v.name
    }));

    const title =
      (apiData && apiData.name) ||
      (nextModelData && nextModelData.name) ||
      (document.querySelector("h1") ? document.querySelector("h1").innerText.trim() : "Civitai_Model");

    const loraStem = sanitizeSegment(title || "LoRA_Model", 75);

    const versionName =
      (activeVersion && activeVersion.name) ||
      (nextVersion && nextVersion.name) ||
      "v1.0";
    const versionId =
      (activeVersion && activeVersion.id) ||
      (nextVersion && nextVersion.id) ||
      targetVerId;

    const apiFiles = (activeVersion && Array.isArray(activeVersion.files)) ? activeVersion.files : [];
    const nextFiles = (nextVersion && Array.isArray(nextVersion.files)) ? nextVersion.files : [];
    const primaryApiFile = apiFiles.find((f) => f.primary) || apiFiles[0] || {};
    const primaryNextFile = nextFiles.find((f) => f.primary) || nextFiles[0] || {};

    const fileName =
      primaryNextFile.overrideName ||
      primaryApiFile.overrideName ||
      (primaryApiFile.name && !/^[0-9A-Z]{26}\./.test(primaryApiFile.name) ? primaryApiFile.name : null) ||
      (primaryNextFile.name && !/^[0-9A-Z]{26}\./.test(primaryNextFile.name) ? primaryNextFile.name : null) ||
      primaryApiFile.name ||
      primaryNextFile.name ||
      domScraped.domFilename ||
      `${title.replace(/[^a-zA-Z0-9_-]+/g, "_")}_${versionName}.safetensors`;

    const rawStorageFileName = primaryNextFile.name || primaryApiFile.name || fileName;

    const sizeKB = primaryApiFile.sizeKB || primaryNextFile.sizeKB;
    const fileSizeFormatted = formatSizeKB(sizeKB);
    const metaObj = primaryApiFile.metadata || primaryNextFile.metadata || {};
    const fileFormat = [metaObj.fp, metaObj.format].filter(Boolean).join(" ") || "SafeTensor";

    const triggerSet = new Set();
    [activeVersion?.trainedWords, nextVersion?.trainedWords].forEach((list) => {
      if (Array.isArray(list)) {
        list.forEach((w) => {
          if (w && String(w).trim()) triggerSet.add(String(w).trim());
        });
      }
    });
    if (triggerSet.size === 0 && Array.isArray(domScraped.triggerWordsFromDom)) {
      domScraped.triggerWordsFromDom.forEach((w) => {
        if (w && String(w).trim()) triggerSet.add(String(w).trim());
      });
    }
    const triggerWords = Array.from(triggerSet);

    const rawDescHtml =
      (apiData && apiData.description) ||
      (nextModelData && nextModelData.description) ||
      domScraped.domDescriptionHtml ||
      "";
    const descriptionHtml = normalizeDescriptionHtmlUrls(rawDescHtml);
    const descriptionText = htmlToCleanText(descriptionHtml) || domScraped.domDescriptionText || "";

    const rawVerDescHtml =
      (activeVersion && activeVersion.description) ||
      (nextVersion && nextVersion.description) ||
      "";
    const versionDescriptionHtml = normalizeDescriptionHtmlUrls(rawVerDescHtml);
    const versionDescriptionText = htmlToCleanText(versionDescriptionHtml);

    const modelType =
      (apiData && apiData.type) ||
      (nextModelData && nextModelData.type) ||
      detailsMap["Type"] ||
      "LORA";
    const baseModel =
      (activeVersion && activeVersion.baseModel) ||
      (nextVersion && nextVersion.baseModel) ||
      detailsMap["Base Model"] ||
      "Unknown";

    const training = detailsMap["Training"] || "";
    let usageTips = detailsMap["Usage Tips"] || "";
    if (!usageTips && nextVersion?.settings?.strength !== undefined) {
      usageTips = `STRENGTH: ${nextVersion.settings.strength}`;
    }
    const reviews = detailsMap["Reviews"] || "";
    const publishedAt =
      detailsMap["Published"] ||
      (activeVersion?.publishedAt ? String(activeVersion.publishedAt).slice(0, 10) : "") ||
      (nextVersion?.publishedAt ? String(nextVersion.publishedAt).slice(0, 10) : "");

    const hashes = {
      ...normalizeHashes(primaryNextFile.hashes),
      ...normalizeHashes(primaryApiFile.hashes)
    };
    if (!hashes.AutoV2 && detailsMap["Hash"]) {
      hashes.AutoV2 = detailsMap["Hash"].replace(/^AUTOV2\s*/i, "").trim();
    }

    const air =
      detailsMap["AIR"] ||
      (modelId && versionId ? `civitai:${modelId}@${versionId}` : "");

    const stats =
      (activeVersion && activeVersion.stats) ||
      (nextVersion && nextVersion.rank) ||
      (apiData && apiData.stats) ||
      (nextModelData && nextModelData.rank) ||
      {};
    const dlCount = stats.downloadCount ?? stats.downloadCountAllTime ?? "-";
    const likesCount = stats.thumbsUpCount ?? stats.thumbsUpCountAllTime ?? "-";
    const statsSummary = `Downloads: ${dlCount} | Likes: ${likesCount}`;

    const creator =
      apiData?.creator?.username ||
      nextModelData?.user?.username ||
      "";

    const rawTags = apiData?.tags || nextModelData?.tagsOnModels || [];
    const tags = Array.isArray(rawTags)
      ? rawTags.map((t) => (typeof t === "string" ? t : t?.tag?.name || t?.name || "")).filter(Boolean)
      : [];

    // Combine API/NextData media with live DOM carousel media so no video or image is ever missed!
    const rawMediaSources = [];
    const seenUuids = new Set();

    function addRawMediaList(list) {
      if (!Array.isArray(list)) return;
      for (const item of list) {
        if (!item) continue;
        const u = extractCivitaiUuid(item.url || item.displayUrl || item.videoUrl || "");
        const key = u || item.url || item.displayUrl;
        if (!key || seenUuids.has(key)) continue;
        seenUuids.add(key);
        rawMediaSources.push(item);
      }
    }

    if (activeVersion && Array.isArray(activeVersion.images) && activeVersion.images.length > 0) {
      addRawMediaList(activeVersion.images);
    }
    if (nextExtracted && nextExtracted.infiniteImagesByVersion) {
      const verItems =
        nextExtracted.infiniteImagesByVersion[String(versionId)] ||
        nextExtracted.infiniteImagesByVersion["all"] ||
        [];
      addRawMediaList(verItems);
    }
    if (!specificVersionObj && liveDomMedia.orderedItems.length > 0) {
      addRawMediaList(liveDomMedia.orderedItems);
    }

    const media = rawMediaSources.map((img, idx) =>
      resolveCivitaiMediaItem(img, idx, cdnBase, liveDomMedia.byUuid, loraStem)
    );

    const pageUrl =
      modelId && versionId
        ? `${location.origin}/models/${modelId}?modelVersionId=${versionId}`
        : location.href;

    const payload = {
      modelId,
      versionId,
      title,
      versionName,
      allVersionsList,
      fileName,
      rawStorageFileName,
      fileSizeFormatted,
      fileFormat,
      triggerWords,
      descriptionHtml,
      descriptionText,
      versionDescriptionHtml,
      versionDescriptionText,
      modelType,
      baseModel,
      training,
      usageTips,
      hashes,
      air,
      publishedAt,
      reviews,
      stats,
      statsSummary,
      creator,
      tags,
      detailsTableExtras: detailsMap,
      media,
      pageUrl,
      rawVersionApiData: activeVersion || nextVersion || null
    };

    payload.generatedFiles = buildGeneratedFiles(payload, loraStem);
    return payload;
  }

  function findDownloadCardContainer() {
    const tourCard = document.querySelector('[data-tour="model:download"]');
    if (tourCard) return tourCard;

    let dlBtn = document.querySelector('a[href*="/api/download/models/"]');
    if (!dlBtn) {
      const candidates = Array.from(document.querySelectorAll("a, button"));
      dlBtn = candidates.find((el) =>
        /Download\s*\(\s*[\d.]+\s*(B|KB|MB|GB)/i.test((el.textContent || "").replace(/\s+/g, " "))
      );
    }
    if (!dlBtn) return null;

    const cardRoot = dlBtn.closest('.mantine-Card-root, .mantine-Paper-root, [class*="Card-root"]');
    if (cardRoot) return cardRoot;

    return dlBtn.closest("div[class]") || dlBtn.parentElement;
  }

  function findDetailsBlockContainer() {
    const versionDetailsBtn = document.querySelector('button[id$="-control-version-details"]');
    if (versionDetailsBtn) {
      const accRoot = versionDetailsBtn.closest('.mantine-Accordion-root, [class*="Accordion-root"], [data-accordion]');
      if (accRoot) return accRoot;
      if (versionDetailsBtn.parentElement && versionDetailsBtn.parentElement.parentElement) {
        return versionDetailsBtn.parentElement.parentElement;
      }
    }

    const buttons = Array.from(document.querySelectorAll("button"));
    const detailsBtn = buttons.find((b) => (b.textContent || "").replace(/\s+/g, " ").trim() === "Details");
    if (detailsBtn) {
      const accRoot = detailsBtn.closest('.mantine-Accordion-root, [class*="Accordion-root"], [data-accordion]');
      if (accRoot) return accRoot;
      if (detailsBtn.parentElement && detailsBtn.parentElement.parentElement) {
        return detailsBtn.parentElement.parentElement;
      }
    }

    const detailRow = document.querySelector('[class*="detailRow"]');
    if (detailRow) {
      const accRoot = detailRow.closest('.mantine-Accordion-root, [class*="Accordion-root"]');
      if (accRoot) return accRoot;
    }

    return null;
  }

  function updateDirStatusUi() {
    const dirStatusEl = document.getElementById("cis-dir-status");
    const pickBtn = document.getElementById("cis-pick-dir-btn");
    if (!dirStatusEl) return;

    if (currentSettings.saveMode === "downloads_subfolder") {
      dirStatusEl.textContent = `📂 Папка: Downloads/${currentSettings.rootFolder || "civitred"}/[Название Лоры]`;
      dirStatusEl.className = "cis-dir-status";
      if (pickBtn) pickBtn.style.display = "none";
    } else {
      if (pickBtn) pickBtn.style.display = "inline-block";
      if (cachedRootDirHandle) {
        dirStatusEl.textContent = `✅ Documents/${cachedRootDirHandle.name}/[Название Лоры]`;
        dirStatusEl.className = "cis-dir-status";
      } else {
        dirStatusEl.textContent = `📁 Нажми Save или «Выбрать», чтобы указать Documents`;
        dirStatusEl.className = "cis-dir-status cis-unset";
      }
    }
  }

  async function inspectExistingFolderFiles(rootHandle, folderParts) {
    let dir = rootHandle;
    for (const part of folderParts) {
      try {
        dir = await dir.getDirectoryHandle(part, { create: false });
      } catch (e) {
        return { exists: false, totalFiles: 0, infoExts: [], mediaCount: 0 };
      }
    }
    let totalFiles = 0;
    let mediaCount = 0;
    const infoExts = [];
    try {
      for await (const entry of dir.values()) {
        if (entry.kind !== "file") continue;
        totalFiles++;
        const low = entry.name.toLowerCase();
        if (low.endsWith(".html")) infoExts.push("HTML");
        else if (low.endsWith(".md")) infoExts.push("MD");
        else if (low.endsWith(".txt")) infoExts.push("TXT");
        else if (low.endsWith(".json")) infoExts.push("JSON");
        else if (low.endsWith(".civitai.info")) infoExts.push(".info");
        else if (/\.(jpe?g|png|webp|gif|avif|mp4|webm|mov)$/i.test(low)) mediaCount++;
      }
    } catch (e) {
      return { exists: true, totalFiles: 0, infoExts: [], mediaCount: 0 };
    }
    return {
      exists: totalFiles > 0,
      totalFiles,
      infoExts: Array.from(new Set(infoExts)),
      mediaCount
    };
  }

  async function getQuickModelMetaForCheck() {
    const modelId = getModelIdFromUrl();
    if (!modelId) return null;
    const nextExtracted = extractFromNextData(modelId);
    const nextData = nextExtracted ? nextExtracted.modelData : null;
    const apiData = cachedModelApiData[modelId] || nextData || (await fetchModelDataFromApi(modelId));
    const versionId = detectActiveVersionId(apiData);

    let activeVer = null;
    if (apiData && Array.isArray(apiData.modelVersions)) {
      activeVer =
        apiData.modelVersions.find((v) => String(v.id) === String(versionId)) ||
        apiData.modelVersions[0];
    }

    const title =
      (apiData && apiData.name) ||
      (document.querySelector("h1") ? document.querySelector("h1").innerText.trim() : "") ||
      "Untitled_Model";
    const versionName = (activeVer && activeVer.name) || "v1";
    const baseModel = (activeVer && activeVer.baseModel) || "Unknown_Base";
    const files = (activeVer && Array.isArray(activeVer.files)) ? activeVer.files : [];
    const primaryFile = files.find((f) => f.primary) || files[0] || {};
    const fileName = primaryFile.overrideName || primaryFile.name || `${title}_${versionName}`;

    return { modelId, versionId, title, versionName, baseModel, fileName };
  }

  async function checkExistingLoraStatus() {
    const bannerEl = document.getElementById("cis-exists-banner");
    const saveBtn = document.getElementById("cis-save-btn");
    if (!bannerEl) return;

    if (!location.pathname.startsWith("/models/")) {
      bannerEl.className = "cis-exists-banner";
      bannerEl.textContent = "";
      return;
    }

    const meta = await getQuickModelMetaForCheck();
    if (!meta) return;

    const folderParts = getRelativeLoraFolderParts(meta, currentSettings);
    let folderResult = null;
    let needsFolderPerm = false;

    if (currentSettings.saveMode === "direct_documents") {
      if (!cachedRootDirHandle) {
        cachedRootDirHandle = await loadStoredDirHandle();
      }
      if (cachedRootDirHandle) {
        try {
          const perm = await cachedRootDirHandle.queryPermission({ mode: "read" });
          if (perm === "granted") {
            folderResult = await inspectExistingFolderFiles(cachedRootDirHandle, folderParts);
          } else {
            needsFolderPerm = true;
          }
        } catch (e) {
          needsFolderPerm = true;
        }
      } else {
        needsFolderPerm = true;
      }
    }

    const dbCheck = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "CIS_CHECK_EXISTING",
          query: {
            modelId: meta.modelId,
            versionId: meta.versionId,
            title: meta.title,
            rootFolder: currentSettings.rootFolder || "civitred"
          }
        },
        (res) => resolve(res || {})
      );
    });

    if (folderResult && folderResult.exists) {
      const partsDesc = [];
      if (folderResult.infoExts.length > 0) partsDesc.push(folderResult.infoExts.join(", "));
      if (folderResult.mediaCount > 0) partsDesc.push(`${folderResult.mediaCount} медиа`);
      const detailStr = partsDesc.length > 0 ? ` (${partsDesc.join(" + ")})` : "";
      bannerEl.className = "cis-exists-banner cis-visible cis-exists-found";
      bannerEl.textContent = `✅ Уже скачано! В папке Documents/${cachedRootDirHandle.name}/${folderParts.join("/")} найдено ${folderResult.totalFiles} файлов${detailStr}.`;
      if (saveBtn && !saveBtn.disabled) {
        saveBtn.classList.add("cis-already-saved");
        saveBtn.innerHTML = "<span>🔄 Уже есть — обновить / дозагрузить</span>";
      }
      return;
    }

    if (dbCheck.inDbExact || (dbCheck.downloadFilesCount && dbCheck.downloadFilesCount > 0)) {
      const where = dbCheck.inDbExact?.localSubfolder || `Downloads/${currentSettings.rootFolder || "civitred"}/${folderParts.join("/")}`;
      const extra = dbCheck.downloadFilesCount > 0 ? ` (в Загрузках: ${dbCheck.downloadFilesCount} файлов)` : "";
      bannerEl.className = "cis-exists-banner cis-visible cis-exists-found";
      bannerEl.textContent = `✅ Уже есть в базе / на диске: ${where}${extra}.`;
      if (saveBtn && !saveBtn.disabled) {
        saveBtn.classList.add("cis-already-saved");
        saveBtn.innerHTML = "<span>🔄 Уже есть — обновить / дозагрузить</span>";
      }
      return;
    }

    if (Array.isArray(dbCheck.inDbOtherVersions) && dbCheck.inDbOtherVersions.length > 0) {
      const verNames = dbCheck.inDbOtherVersions.map((v) => v.versionName).filter(Boolean).slice(0, 3).join(", ");
      bannerEl.className = "cis-exists-banner cis-visible cis-exists-other-ver";
      bannerEl.textContent = `ℹ️ В базе уже есть другая версия этой модели (${verNames}), текущая версия ещё не сохранена.`;
      if (saveBtn && !saveBtn.disabled) {
        saveBtn.classList.remove("cis-already-saved");
        saveBtn.innerHTML = "<span>💾 Save Model Info & Media</span>";
      }
      return;
    }

    if (needsFolderPerm && currentSettings.saveMode === "direct_documents") {
      bannerEl.className = "cis-exists-banner cis-visible cis-exists-no-perm";
      bannerEl.textContent = `🔒 Нажми «Выбрать папку», чтобы проверять уже скачанные LoRA в Documents/${currentSettings.rootFolder || "civitred"}.`;
    } else {
      bannerEl.className = "cis-exists-banner";
      bannerEl.textContent = "";
    }

    if (saveBtn && !saveBtn.disabled) {
      saveBtn.classList.remove("cis-already-saved");
      saveBtn.innerHTML = "<span>💾 Save Model Info & Media</span>";
    }
  }

  function syncWidgetInputs() {
    const panel = document.getElementById("cis-injected-panel");
    if (!panel) return;
    const bindMap = {
      "cis-chk-html": "saveHtml",
      "cis-chk-md": "saveMd",
      "cis-chk-txt": "saveTxt",
      "cis-chk-json": "saveJson",
      "cis-chk-media": "saveMedia",
      "cis-chk-videos": "includeVideos",
      "cis-chk-skip-existing": "skipExistingMedia",
      "cis-chk-webui-preview": "saveWebuiPreview"
    };
    Object.entries(bindMap).forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (el) el.checked = Boolean(currentSettings[key]);
    });
    const folderSel = document.getElementById("cis-folder-preset");
    if (folderSel) folderSel.value = currentSettings.folderPreset || "lora_title_only";
    const modeSel = document.getElementById("cis-save-mode");
    if (modeSel) modeSel.value = currentSettings.saveMode || "direct_documents";
    updateDirStatusUi();
  }

  function showPreviewModal(payload) {
    const existing = document.getElementById("cis-preview-modal");
    if (existing) existing.remove();

    const backdrop = document.createElement("div");
    backdrop.id = "cis-preview-modal";
    backdrop.className = "cis-modal-backdrop";

    const videoCount = (payload.media || []).filter((m) => m.isVideo).length;
    const imageCount = (payload.media || []).length - videoCount;
    const triggers = (payload.triggerWords || []).join(", ") || "None";

    backdrop.innerHTML = `
      <div class="cis-modal">
        <div class="cis-modal-header">
          <h3>📋 Extracted Civitai Model Info Preview</h3>
          <button class="cis-mini-btn" id="cis-close-modal">✕ Close</button>
        </div>
        <div class="cis-modal-body">
          <table class="cis-kv-table">
            <tr><th>Папка Лоры (Title)</th><td><strong>civitred / ${escapeHtml(sanitizeSegment(payload.title, 80))}</strong> (Version: <span class="cis-code-pill">${escapeHtml(payload.versionName)}</span>)</td></tr>
            <tr><th>Full Filename</th><td><span class="cis-code-pill">${escapeHtml(payload.fileName)}</span> (${escapeHtml(payload.fileFormat)} • ${escapeHtml(payload.fileSizeFormatted || "N/A")})</td></tr>
            <tr><th>Trigger Words</th><td><span class="cis-code-pill">${escapeHtml(triggers)}</span></td></tr>
            <tr><th>Type & Base Model</th><td>${escapeHtml(payload.modelType)} — <strong>${escapeHtml(payload.baseModel)}</strong></td></tr>
            <tr><th>Training / Usage Tips</th><td>Training: <code>${escapeHtml(payload.training || "N/A")}</code> | Usage Tips: <code>${escapeHtml(payload.usageTips || "N/A")}</code></td></tr>
            <tr><th>Hash & AIR</th><td>AutoV2: <code>${escapeHtml(payload.hashes?.AutoV2 || "N/A")}</code> | AIR: <code>${escapeHtml(payload.air || "N/A")}</code></td></tr>
            <tr><th>Published & Stats</th><td>${escapeHtml(payload.publishedAt || "N/A")} | ${escapeHtml(payload.reviews || "")} | ${escapeHtml(payload.statsSummary || "")}</td></tr>
            <tr><th>Example Media</th><td><strong>${imageCount}</strong> Images + <strong>${videoCount}</strong> Videos ready to download</td></tr>
            <tr><th>Description Preview</th><td style="max-height:140px;overflow-y:auto;white-space:pre-wrap;font-size:12px;color:#adb5bd;">${escapeHtml((payload.descriptionText || "").slice(0, 1000))}</td></tr>
          </table>
        </div>
      </div>
    `;

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop || e.target.id === "cis-close-modal") {
        backdrop.remove();
      }
    });
    document.body.appendChild(backdrop);
  }

  function createWidgetElement(isFloating = false) {
    const panel = document.createElement("div");
    panel.id = "cis-injected-panel";
    panel.className = "cis-panel" + (isFloating ? " cis-floating-fallback" : "");

    panel.innerHTML = `
      <div class="cis-header">
        <span class="cis-title">⚡ Civitai Info & Media Saver v1.6</span>
        <span class="cis-badge" id="cis-pin-toggle" title="Переключить между боковой панелью и углом экрана">${isFloating ? "📌 В углу" : "📌 В панели"}</span>
      </div>

      <div id="cis-exists-banner" class="cis-exists-banner"></div>

      <button id="cis-save-btn" class="cis-main-btn" type="button">
        <span>💾 Save Model Info & Media</span>
      </button>

      <div class="cis-dir-box">
        <div class="cis-dir-top">
          <span id="cis-dir-status" class="cis-dir-status">📁 Documents/civitred/[Название Лоры]</span>
          <button type="button" class="cis-mini-btn" id="cis-pick-dir-btn" title="Выбрать папку Documents (автоматически создаст civitred)">📁 Выбрать папку</button>
        </div>
        <select id="cis-save-mode" class="cis-select" title="Куда сохранять файлы">
          <option value="direct_documents">В папку Documents / civitred / [Название Лоры]</option>
          <option value="downloads_subfolder">В Загрузки / civitred / [Название Лоры]</option>
        </select>
      </div>

      <div class="cis-formats-grid">
        <label class="cis-checkbox-label" title="Точная офлайн-копия страницы Civitai (.html)">
          <input type="checkbox" id="cis-chk-html" checked /> .HTML Civitai UI
        </label>
        <label class="cis-checkbox-label" title="Markdown-файл с таблицей и ссылками">
          <input type="checkbox" id="cis-chk-md" checked /> .MD Sheet
        </label>
        <label class="cis-checkbox-label" title="Текстовый файл .txt со всей информацией">
          <input type="checkbox" id="cis-chk-txt" checked /> .TXT Info
        </label>
        <label class="cis-checkbox-label" title="JSON + .civitai.info метаданные">
          <input type="checkbox" id="cis-chk-json" checked /> .JSON / .info
        </label>
        <label class="cis-checkbox-label" title="Скачать все примеры-картинки">
          <input type="checkbox" id="cis-chk-media" checked /> All Images
        </label>
        <label class="cis-checkbox-label" title="Скачать также все видео-примеры (.mp4)">
          <input type="checkbox" id="cis-chk-videos" checked /> + Videos (.mp4)
        </label>
        <label class="cis-checkbox-label" title="Не перекачивать медиафайлы, которые уже есть в папке">
          <input type="checkbox" id="cis-chk-skip-existing" checked /> Пропуск дублей
        </label>
        <label class="cis-checkbox-label" title="Сохранить копию первого фото как &lt;filename&gt;.preview.ext для A1111/Forge/ComfyUI">
          <input type="checkbox" id="cis-chk-webui-preview" /> .preview WebUI
        </label>
      </div>

      <div class="cis-folder-row">
        <label for="cis-folder-preset">📂 Структура папок внутри civitred:</label>
        <select id="cis-folder-preset" class="cis-select">
          <option value="lora_title_only">По названию Лоры: civitred / [Название Лоры]</option>
          <option value="lora_title_version">Название + Версия: civitred / [Название Лоры (Версия)]</option>
          <option value="base_and_lora_title">По базовой модели: civitred / [BaseModel] / [Название Лоры]</option>
          <option value="filename_only">По имени файла: civitred / [Имя_файла]</option>
        </select>
      </div>

      <div class="cis-options-toggle">
        <div class="cis-mini-actions">
          <button type="button" class="cis-mini-btn" id="cis-preview-btn" title="Посмотреть все найденные данные перед сохранением">👁️ Preview</button>
          <button type="button" class="cis-mini-btn" id="cis-save-all-versions-btn" title="Сохранить все версии на этой странице">📦 All Versions</button>
        </div>
        <button type="button" class="cis-mini-btn" id="cis-open-db-btn" title="Открыть локальную базу с поиском по всем сохранённым Лорам">🔍 Search DB</button>
      </div>

      <div id="cis-status-msg" class="cis-status"></div>
    `;

    const checkboxMap = {
      "cis-chk-html": "saveHtml",
      "cis-chk-md": "saveMd",
      "cis-chk-txt": "saveTxt",
      "cis-chk-json": "saveJson",
      "cis-chk-media": "saveMedia",
      "cis-chk-videos": "includeVideos",
      "cis-chk-skip-existing": "skipExistingMedia",
      "cis-chk-webui-preview": "saveWebuiPreview"
    };
    Object.entries(checkboxMap).forEach(([id, key]) => {
      const el = panel.querySelector(`#${id}`);
      if (el) {
        el.addEventListener("change", (e) => {
          currentSettings[key] = e.target.checked;
          saveSettings();
        });
      }
    });

    panel.querySelector("#cis-folder-preset").addEventListener("change", (e) => {
      currentSettings.folderPreset = e.target.value;
      saveSettings();
      checkExistingLoraStatus();
    });

    panel.querySelector("#cis-save-mode").addEventListener("change", (e) => {
      currentSettings.saveMode = e.target.value;
      saveSettings();
      updateDirStatusUi();
      checkExistingLoraStatus();
    });

    panel.querySelector("#cis-pick-dir-btn").addEventListener("click", async () => {
      try {
        const handle = await pickCivitredDirectory();
        setStatus(`✅ Выбрана папка: Documents/${handle.name}/ (внутри будут создаваться папки с названием каждой Лоры)`);
        checkExistingLoraStatus();
      } catch (err) {
        if (err && err.name === "AbortError") return;
        setStatus(`Не удалось выбрать папку: ${err.message || err}`, true);
      }
    });

    panel.querySelector("#cis-pin-toggle").addEventListener("click", () => {
      forceFloatingMode = !forceFloatingMode;
      panel.remove();
      tryInjectWidget();
    });

    const statusEl = panel.querySelector("#cis-status-msg");
    const saveBtn = panel.querySelector("#cis-save-btn");

    function setStatus(text, isError = false) {
      statusEl.textContent = text;
      statusEl.className = "cis-status cis-visible" + (isError ? " cis-error" : "");
    }

    saveBtn.addEventListener("click", async () => {
      try {
        saveBtn.disabled = true;

        let targetRootDirHandle = null;
        if (currentSettings.saveMode === "direct_documents" && window.showDirectoryPicker) {
          setStatus("Проверка доступа к папке Documents/civitred (при первом запуске просто нажми «Выбор папки» в открывшемся окне Documents)...");
          try {
            targetRootDirHandle = await ensureWritableCivitredHandle();
          } catch (pickerErr) {
            if (pickerErr && pickerErr.name === "AbortError") {
              saveBtn.disabled = false;
              setStatus("Выбор папки отменён. Нажми Save ещё раз и выбери папку Documents (или переключи режим на Загрузки/civitred).", true);
              return;
            }
            console.warn("[Civitai Info Saver] Falling back to Downloads subfolder mode:", pickerErr);
          }
        }

        saveBtn.innerHTML = "<span>⏳ Extracting Info & Media...</span>";
        setStatus("Собираем данные модели, полное имя файла и список картинок/видео...");

        const payload = await extractModelPayload();
        const vidCount = (payload.media || []).filter((m) => m.isVideo).length;
        const imgCount = (payload.media || []).length - vidCount;

        if (targetRootDirHandle) {
          setStatus(`Сохраняем в Documents/${targetRootDirHandle.name}/${sanitizeSegment(payload.title, 75)} (${imgCount} фото, ${vidCount} видео)...`);
          const r = await savePackageDirectlyToDir(targetRootDirHandle, payload, currentSettings, (msg) => setStatus(msg));
          saveBtn.disabled = false;
          saveBtn.classList.add("cis-success");
          saveBtn.innerHTML = "<span>✅ Сохранено в Documents/civitred!</span>";
          const skipInfo = r.skippedMedia ? `, пропущено дублей: ${r.skippedMedia}` : "";
          setStatus(
            `✅ Готово! Сохранено ${r.filesSaved} инфо-файлов + ${r.mediaSaved} новых медиа${skipInfo} в папку: ${r.subfolder} (В базе: ${r.totalInDb})`
          );
          checkExistingLoraStatus();
          setTimeout(() => {
            saveBtn.classList.remove("cis-success");
            checkExistingLoraStatus();
          }, 3500);
          return;
        }

        setStatus(`Скачиваем в Downloads/${currentSettings.rootFolder || "civitred"}/${sanitizeSegment(payload.title, 75)}...`);
        chrome.runtime.sendMessage(
          {
            type: "CIS_SAVE_PACKAGE",
            payload,
            settings: currentSettings
          },
          (response) => {
            saveBtn.disabled = false;
            if (!response || !response.ok) {
              saveBtn.innerHTML = "<span>💾 Save Model Info & Media</span>";
              setStatus(`Ошибка: ${response ? response.error : "Extension background error"}`, true);
              return;
            }
            const r = response.result;
            saveBtn.classList.add("cis-success");
            saveBtn.innerHTML = "<span>✅ Saved Info & Media!</span>";
            setStatus(
              `✅ Сохранено ${r.filesSaved} инфо-файлов + ${r.mediaSaved} медиа в ${r.subfolder} (В базе: ${r.totalInDb})`
            );
            checkExistingLoraStatus();
            setTimeout(() => {
              saveBtn.classList.remove("cis-success");
              checkExistingLoraStatus();
            }, 3500);
          }
        );
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = "<span>💾 Save Model Info & Media</span>";
        setStatus(`Ошибка: ${err.message || err}`, true);
      }
    });

    panel.querySelector("#cis-preview-btn").addEventListener("click", async () => {
      setStatus("Загрузка предпросмотра...");
      const payload = await extractModelPayload();
      statusEl.className = "cis-status";
      showPreviewModal(payload);
    });

    const allVersionsBtn = panel.querySelector("#cis-save-all-versions-btn");
    allVersionsBtn.addEventListener("click", async () => {
      allVersionsBtn.disabled = true;
      try {
        let targetRootDirHandle = null;
        if (currentSettings.saveMode === "direct_documents" && window.showDirectoryPicker) {
          try {
            targetRootDirHandle = await ensureWritableCivitredHandle();
          } catch (e) {
            if (e && e.name === "AbortError") return;
          }
        }

        const modelId = getModelIdFromUrl();
        const nextExtracted = extractFromNextData(modelId);
        const apiData = (await fetchModelDataFromApi(modelId)) || (nextExtracted ? nextExtracted.modelData : null);
        if (!apiData || !Array.isArray(apiData.modelVersions) || apiData.modelVersions.length === 0) {
          setStatus("Не удалось найти список версий.", true);
          return;
        }
        setStatus(`Сохраняем все ${apiData.modelVersions.length} версий этой модели...`);
        let completed = 0;
        const multiSettings = { ...currentSettings, folderPreset: "lora_title_version" };
        for (const ver of apiData.modelVersions) {
          const payload = await extractModelPayload(ver);
          if (targetRootDirHandle) {
            await savePackageDirectlyToDir(targetRootDirHandle, payload, multiSettings);
          } else {
            await new Promise((resolve) => {
              chrome.runtime.sendMessage(
                { type: "CIS_SAVE_PACKAGE", payload, settings: multiSettings },
                () => resolve()
              );
            });
          }
          completed++;
          setStatus(`Сохранено ${completed} / ${apiData.modelVersions.length} версий (${ver.name})...`);
        }
        setStatus(`✅ Все ${completed} версий успешно сохранены!`);
        checkExistingLoraStatus();
      } catch (err) {
        setStatus(`Ошибка пакетного сохранения: ${err.message || err}`, true);
      } finally {
        allVersionsBtn.disabled = false;
      }
    });

    panel.querySelector("#cis-open-db-btn").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "CIS_OPEN_DATABASE" });
    });

    return panel;
  }

  function tryInjectWidget() {
    if (!location.pathname.startsWith("/models/")) {
      const existing = document.getElementById("cis-injected-panel");
      if (existing) existing.remove();
      return;
    }

    const existing = document.getElementById("cis-injected-panel");
    if (existing) {
      if (existing.classList.contains("cis-floating-fallback") && !forceFloatingMode) {
        const detailsBlock = findDetailsBlockContainer();
        const dlCard = findDownloadCardContainer();
        if (detailsBlock || dlCard) {
          existing.remove();
        } else {
          return;
        }
      } else {
        return;
      }
    }

    if (!forceFloatingMode) {
      const detailsBlock = findDetailsBlockContainer();
      if (detailsBlock && detailsBlock.parentElement && !["BUTTON", "A", "H1", "H2", "H3", "TR", "TBODY"].includes(detailsBlock.tagName)) {
        const widget = createWidgetElement(false);
        detailsBlock.parentElement.insertBefore(widget, detailsBlock);
        syncWidgetInputs();
        lastCheckedUrl = location.href;
        checkExistingLoraStatus();
        return;
      }

      const dlCard = findDownloadCardContainer();
      if (dlCard && dlCard.parentElement && !["BUTTON", "A", "H1", "H2", "H3"].includes(dlCard.tagName)) {
        const widget = createWidgetElement(false);
        dlCard.insertAdjacentElement("afterend", widget);
        syncWidgetInputs();
        lastCheckedUrl = location.href;
        checkExistingLoraStatus();
        return;
      }
    }

    if (document.body) {
      const widget = createWidgetElement(true);
      document.body.appendChild(widget);
      syncWidgetInputs();
      lastCheckedUrl = location.href;
      checkExistingLoraStatus();
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "CIS_TRIGGER_SAVE_FROM_POPUP") {
      (async () => {
        const payload = await extractModelPayload();
        if (currentSettings.saveMode === "direct_documents") {
          if (!cachedRootDirHandle) cachedRootDirHandle = await loadStoredDirHandle();
          if (cachedRootDirHandle) {
            const perm = await cachedRootDirHandle.queryPermission({ mode: "readwrite" });
            if (perm === "granted") {
              const res = await savePackageDirectlyToDir(cachedRootDirHandle, payload, currentSettings);
              checkExistingLoraStatus();
              sendResponse({ ok: true, result: res });
              return;
            }
          }
        }
        chrome.runtime.sendMessage(
          { type: "CIS_SAVE_PACKAGE", payload, settings: currentSettings },
          (res) => {
            checkExistingLoraStatus();
            sendResponse(res);
          }
        );
      })().catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }
  });

  let injectDebounceTimer = null;
  function scheduleTryInject() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastCheckedUrl = "";
    }
    clearTimeout(injectDebounceTimer);
    injectDebounceTimer = setTimeout(() => {
      tryInjectWidget();
      if (location.href !== lastCheckedUrl && document.getElementById("cis-injected-panel")) {
        lastCheckedUrl = location.href;
        checkExistingLoraStatus();
      }
    }, 250);
  }

  const observer = new MutationObserver(scheduleTryInject);

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  setInterval(() => {
    if (location.href !== lastUrl || !document.getElementById("cis-injected-panel")) {
      scheduleTryInject();
    }
  }, 1500);
  tryInjectWidget();
})();
