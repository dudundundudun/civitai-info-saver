(() => {
  const ROOT = (globalThis.__CIS__ = globalThis.__CIS__ || {});
  const MODEL_CACHE_LIMIT = 20;
  const cachedModelApiData = new Map();

  function getCachedModel(modelId) {
    if (!cachedModelApiData.has(modelId)) return null;
    const val = cachedModelApiData.get(modelId);
    cachedModelApiData.delete(modelId);
    cachedModelApiData.set(modelId, val);
    return val;
  }

  function setCachedModel(modelId, data) {
    if (cachedModelApiData.has(modelId)) {
      cachedModelApiData.delete(modelId);
    } else if (cachedModelApiData.size >= MODEL_CACHE_LIMIT) {
      const oldestKey = cachedModelApiData.keys().next().value;
      if (oldestKey !== undefined) cachedModelApiData.delete(oldestKey);
    }
    cachedModelApiData.set(modelId, data);
  }

  function getModelIdFromUrl() {
    const match = location.pathname.match(/^\/models\/(\d+)/);
    return match ? match[1] : null;
  }

  function formatSizeKB(sizeKB) {
    if (!sizeKB || isNaN(sizeKB)) return "";
    const kb = Number(sizeKB);
    if (kb >= 1024 * 1024) return `${(kb / (1024 * 1024)).toFixed(2)} GB`;
    if (kb >= 1024) return `${(kb / 1024).toFixed(2)} MB`;
    return `${kb.toFixed(0)} KB`;
  }

  function extractCivitaiUuid(urlOrStr) {
    if (!urlOrStr) return null;
    const m = String(urlOrStr).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    return m ? m[1].toLowerCase() : null;
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

  function normalizeHashes(rawHashes) {
    const out = {};
    if (!rawHashes) return out;
    if (Array.isArray(rawHashes)) {
      for (const h of rawHashes) {
        if (h && h.type && h.hash) out[h.type] = h.hash;
      }
    } else if (typeof rawHashes === "object") {
      Object.assign(out, rawHashes);
    }
    return out;
  }

  // Targeted DOM version detection (avoids full-page layout reflow)
  function detectActiveVersionId(apiData) {
    const params = new URLSearchParams(location.search);
    if (params.get("modelVersionId")) {
      return String(params.get("modelVersionId"));
    }

    const dlLinks = document.querySelectorAll('a[href*="/api/download/models/"]');
    for (const link of dlLinks) {
      const m = (link.getAttribute("href") || "").match(/\/api\/download\/models\/(\d+)/);
      if (m) return String(m[1]);
    }

    const detailNodes = document.querySelectorAll('[class*="detailRow"], table tr');
    for (const node of detailNodes) {
      const txt = node.textContent || "";
      const airMatch = txt.match(/civitai\s*:\s*\d+\s*@\s*(\d+)/i);
      if (airMatch) return String(airMatch[1]);
    }

    if (apiData && Array.isArray(apiData.modelVersions) && apiData.modelVersions.length > 0) {
      const activeBtns = document.querySelectorAll(
        'button[data-active="true"], a[data-active="true"], button[aria-selected="true"]'
      );
      for (const btn of activeBtns) {
        const txt = (btn.textContent || "").replace(/\s+/g, " ").trim();
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

  async function fetchModelDataFromApi(modelId) {
    if (!modelId) return null;
    const cached = getCachedModel(modelId);
    if (cached) return cached;
    try {
      const resp = await fetch(`${location.origin}/api/v1/models/${modelId}`, {
        credentials: "include"
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      setCachedModel(modelId, data);
      return data;
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

  function collectLiveDomMedia() {
    const byUuid = new Map();
    const orderedItems = [];
    const seenKeys = new Set();

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
      container.querySelectorAll("video").forEach((vid) => {
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

      container.querySelectorAll("img[src*='image.civitai.']").forEach((img) => {
        if (img.closest('[class*="TypographyStylesProvider"], [class*="RenderHtml"], footer, header')) return;
        const src = img.currentSrc || img.getAttribute("src") || "";
        if (!src) return;
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
    return cardRoot || dlBtn.closest("div[class]") || dlBtn.parentElement;
  }

  function findDetailsBlockContainer() {
    const versionDetailsBtn = document.querySelector('button[id$="-control-version-details"]');
    if (versionDetailsBtn) {
      const accRoot = versionDetailsBtn.closest('.mantine-Accordion-root, [class*="Accordion-root"], [data-accordion]');
      if (accRoot) return accRoot;
      if (versionDetailsBtn.parentElement?.parentElement) return versionDetailsBtn.parentElement.parentElement;
    }

    const detailsBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => (b.textContent || "").replace(/\s+/g, " ").trim() === "Details"
    );
    if (detailsBtn) {
      const accRoot = detailsBtn.closest('.mantine-Accordion-root, [class*="Accordion-root"], [data-accordion]');
      if (accRoot) return accRoot;
      if (detailsBtn.parentElement?.parentElement) return detailsBtn.parentElement.parentElement;
    }

    const detailRow = document.querySelector('[class*="detailRow"]');
    if (detailRow) {
      const accRoot = detailRow.closest('.mantine-Accordion-root, [class*="Accordion-root"]');
      if (accRoot) return accRoot;
    }
    return null;
  }

  function htmlToPlainTextSafe(html) {
    if (!html) return "";
    const doc = new DOMParser().parseFromString(String(html), "text/html");
    doc.querySelectorAll("script, style, iframe, object, embed").forEach((el) => el.remove());
    doc.querySelectorAll("br").forEach((el) => el.replaceWith("\n"));
    doc.querySelectorAll("p, div, h1, h2, h3, h4, h5, h6, blockquote").forEach((el) => {
      el.prepend(doc.createTextNode("\n"));
      el.append(doc.createTextNode("\n"));
    });
    doc.querySelectorAll("li").forEach((el) => el.prepend(doc.createTextNode("\n• ")));
    doc.querySelectorAll("a[href]").forEach((el) => {
      const href = el.getAttribute("href") || "";
      const text = (el.textContent || "").trim();
      if (/^https?:/i.test(href) && text && text !== href) {
        el.replaceWith(`${text} (${href})`);
      }
    });
    return (doc.body.textContent || "")
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function scrapeDetailsTableFromDom() {
    const detailsMap = {};
    const triggerWordsFromDom = [];

    function processKeyValue(rawKey, valueEl) {
      const key = (rawKey || "").replace(/\s+/g, " ").trim();
      if (!key || !valueEl) return;

      let val = (valueEl.textContent || "").replace(/\s+/g, " ").trim();
      if (/^Stats$/i.test(key)) {
        val = val.replace(/(?:\b0\s*1\s*2\s*3\s*4\s*5\s*6\s*7\s*8\s*9\b\s*)+/g, " ").replace(/\s+/g, " ").trim();
      }
      if (!val) return;
      detailsMap[key] = val;

      if (/trigger\s*word/i.test(key)) {
        const badges = valueEl.querySelectorAll("[class*='Badge-label'], [class*='Badge'], [class*='badge'], button, span");
        badges.forEach((b) => {
          const t = (b.textContent || "").replace(/\s+/g, " ").trim();
          if (t && t.length > 1 && !/^(copy|trigger words)$/i.test(t) && !triggerWordsFromDom.includes(t)) {
            triggerWordsFromDom.push(t);
          }
        });
        if (triggerWordsFromDom.length === 0 && val) triggerWordsFromDom.push(val);
      }
    }

    document.querySelectorAll('[class*="detailRow"]').forEach((row) => {
      const labelEl = row.querySelector('[class*="detailLabel"]') || row.children[0];
      const valueEl = row.querySelector('[class*="detailValue"]') || row.children[1];
      if (labelEl && valueEl) processKeyValue(labelEl.textContent, valueEl);
    });

    document.querySelectorAll("table tr").forEach((tr) => {
      const cells = tr.querySelectorAll("td, th");
      if (cells.length >= 2) processKeyValue(cells[0].textContent, cells[1]);
    });

    let domFilename = "";
    const dlCard = findDownloadCardContainer();
    if (dlCard) {
      const textLines = (dlCard.textContent || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
      const fileLine = textLines.find((line) => /\.(safetensors|ckpt|pt|bin|pth|gguf|onnx|zip)|safet\.\.\./i.test(line));
      if (fileLine) domFilename = fileLine;
    }

    const allProse = Array.from(
      document.querySelectorAll("[class*='TypographyStylesProvider'], [class*='RenderHtml']")
    ).filter((el) => !el.closest('.mantine-Accordion-root, [class*="Accordion"], [class*="Comment"], footer'));
    const proseBlocks =
      allProse.length > 0
        ? allProse
        : Array.from(document.querySelectorAll("[class*='TypographyStylesProvider'], [class*='RenderHtml']"));

    const domDescriptionHtml = proseBlocks.map((el) => el.innerHTML).join("\n");
    const domDescriptionText = proseBlocks.map((el) => (el.textContent || "").trim()).filter(Boolean).join("\n\n");

    return {
      detailsMap,
      triggerWordsFromDom,
      domFilename,
      domDescriptionHtml,
      domDescriptionText
    };
  }

  function resolveCivitaiMediaItem(imgObj, index, cdnBase, domMediaByUuid) {
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

    const fileStem = itemName ? itemName.replace(/\.[a-zA-Z0-9]+$/, "") : uuid || `media_${index + 1}`;

    if (rawUrl && !rawUrl.startsWith("http")) {
      const defaultExt = isVideo ? "mp4" : "jpeg";
      const fallbackName = itemName || `${rawUrl}.${defaultExt}`;
      const mod = isVideo ? "anim=true,transcode=true,width=450,optimized=true" : "width=450";
      rawUrl = `${base}/${rawUrl}/${mod}/${encodeURIComponent(fallbackName)}`;
    }

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
      if (domMatch?.videoUrl) candidateUrls.push(domMatch.videoUrl);
      if (uuid) {
        candidateUrls.push(`${base}/${uuid}/anim=true,transcode=true,width=450,optimized=true/${encodeURIComponent(fileStem)}.mp4`);
        candidateUrls.push(`${base}/${uuid}/transcode=true,width=450/${encodeURIComponent(fileStem)}.mp4`);
      }
      if (pageAlignedRawUrl) {
        candidateUrls.push(pageAlignedRawUrl.replace(/\.[a-zA-Z0-9]+(\?|$)/, ".mp4$1"));
      }
      if (domMatch?.webmUrl) candidateUrls.push(domMatch.webmUrl);

      const dedupCandidates = uniqueNonEmptyUrls(candidateUrls);
      const displayVideoUrl =
        domMatch?.videoUrl ||
        (uuid ? `${base}/${uuid}/anim=true,transcode=true,width=450,optimized=true/${encodeURIComponent(fileStem)}.mp4` : "") ||
        dedupCandidates[0] ||
        "";
      const posterUrl =
        domMatch?.posterUrl ||
        (uuid ? `${base}/${uuid}/anim=false,transcode=true,width=450/${encodeURIComponent(fileStem)}.jpeg` : "");

      return {
        index: index + 1,
        id: imgObj.id || uuid || index + 1,
        uuid: uuid || null,
        isVideo: true,
        type: "video",
        extension: "mp4",
        fallbackExtension: "mp4",
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
    if (!["jpg", "jpeg", "png", "webp", "gif", "avif"].includes(ext)) ext = "jpeg";

    const candidateUrls = [];
    if (uuid) candidateUrls.push(`${base}/${uuid}/original=true/${encodeURIComponent(fileStem)}.${ext}`);
    if (pageAlignedRawUrl && /image\.civitai\./i.test(pageAlignedRawUrl)) {
      candidateUrls.push(pageAlignedRawUrl.replace(/\/(width=[^/]+|anim=[^/]+)\//, "/original=true/"));
    }
    if (domMatch?.displayUrl) candidateUrls.push(domMatch.displayUrl);
    if (uuid) {
      candidateUrls.push(`${base}/${uuid}/width=1080/${encodeURIComponent(fileStem)}.${ext}`);
      candidateUrls.push(`${base}/${uuid}/width=450/${encodeURIComponent(fileStem)}.${ext}`);
    }
    candidateUrls.push(pageAlignedRawUrl, rawUrl);

    const dedupCandidates = uniqueNonEmptyUrls(candidateUrls);
    const displayImgUrl = domMatch?.displayUrl || pageAlignedRawUrl || dedupCandidates[0] || "";

    return {
      index: index + 1,
      id: imgObj.id || uuid || index + 1,
      uuid: uuid || null,
      isVideo: false,
      type: "image",
      extension: ext,
      fallbackExtension: ext,
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

  async function getQuickModelMetaForCheck() {
    const modelId = getModelIdFromUrl();
    if (!modelId) return null;
    const nextExtracted = extractFromNextData(modelId);
    const nextData = nextExtracted ? nextExtracted.modelData : null;
    const apiData = getCachedModel(modelId) || nextData || (await fetchModelDataFromApi(modelId));
    const versionId = detectActiveVersionId(apiData);

    let activeVer = null;
    if (apiData && Array.isArray(apiData.modelVersions)) {
      activeVer =
        apiData.modelVersions.find((v) => String(v.id) === String(versionId)) ||
        apiData.modelVersions[0];
    }

    const title =
      (apiData && apiData.name) ||
      (document.querySelector("h1")?.textContent || "").trim() ||
      "Untitled_Model";
    const versionName = (activeVer && activeVer.name) || "v1";
    const baseModel = (activeVer && activeVer.baseModel) || "Unknown_Base";
    const files = activeVer && Array.isArray(activeVer.files) ? activeVer.files : [];
    const primaryFile = files.find((f) => f.primary) || files[0] || {};
    const fileName = primaryFile.overrideName || primaryFile.name || `${title}_${versionName}`;
    const usageTips = activeVer?.settings?.strength !== undefined ? `STRENGTH: ${activeVer.settings.strength}` : "";

    return { modelId, versionId, title, versionName, baseModel, fileName, usageTips };
  }

  async function extractModelPayload(specificVersionObj = null) {
    const modelId = getModelIdFromUrl();
    const nextExtracted = extractFromNextData(modelId);
    const nextModelData = nextExtracted ? nextExtracted.modelData : null;
    const apiData = (await fetchModelDataFromApi(modelId)) || nextModelData;
    const activeOnPageVerId = detectActiveVersionId(apiData || nextModelData);
    const targetVerId = specificVersionObj ? String(specificVersionObj.id) : activeOnPageVerId;
    const isActivePageVersion = !specificVersionObj || String(targetVerId) === String(activeOnPageVerId);

    // Only scrape live DOM details/media when extracting the currently displayed version!
    const domScraped = isActivePageVersion
      ? scrapeDetailsTableFromDom()
      : { detailsMap: {}, triggerWordsFromDom: [], domFilename: "", domDescriptionHtml: "", domDescriptionText: "" };
    const detailsMap = domScraped.detailsMap || {};
    const cdnBase = detectCdnBaseFromDom();
    const liveDomMedia = isActivePageVersion ? collectLiveDomMedia() : { byUuid: new Map(), orderedItems: [] };

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

    const allVersionsList = (apiData?.modelVersions || nextModelData?.modelVersions || []).map((v) => ({
      id: v.id,
      name: v.name
    }));

    const title =
      (apiData && apiData.name) ||
      (nextModelData && nextModelData.name) ||
      (document.querySelector("h1")?.textContent || "").trim() ||
      "Civitai_Model";

    const versionName = (activeVersion && activeVersion.name) || (nextVersion && nextVersion.name) || "v1.0";
    const versionId = (activeVersion && activeVersion.id) || (nextVersion && nextVersion.id) || targetVerId;

    const apiFiles = activeVersion && Array.isArray(activeVersion.files) ? activeVersion.files : [];
    const nextFiles = nextVersion && Array.isArray(nextVersion.files) ? nextVersion.files : [];
    const combinedRawFiles = apiFiles.length > 0 ? apiFiles : nextFiles;
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

    const files = combinedRawFiles.map((f) => {
      const m = f.metadata || {};
      const fmt = [m.fp, m.format, m.size].filter(Boolean).join(" ") || "SafeTensor";
      return {
        name: f.overrideName || f.name || fileName,
        rawName: f.name || "",
        sizeKB: f.sizeKB || 0,
        sizeFormatted: formatSizeKB(f.sizeKB),
        format: fmt,
        primary: Boolean(f.primary),
        hashes: normalizeHashes(f.hashes),
        downloadUrl: f.downloadUrl || (versionId ? `${location.origin}/api/download/models/${versionId}?type=${encodeURIComponent(f.type || "Model")}` : "")
      };
    });

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

    const rawDescriptionHtml =
      (apiData && apiData.description) ||
      (nextModelData && nextModelData.description) ||
      domScraped.domDescriptionHtml ||
      "";
    const descriptionText = htmlToPlainTextSafe(rawDescriptionHtml) || domScraped.domDescriptionText || "";

    const rawVersionDescriptionHtml =
      (activeVersion && activeVersion.description) ||
      (nextVersion && nextVersion.description) ||
      "";
    const versionDescriptionText = htmlToPlainTextSafe(rawVersionDescriptionHtml);

    const modelType = (apiData && apiData.type) || (nextModelData && nextModelData.type) || detailsMap["Type"] || "LORA";
    const baseModel = (activeVersion && activeVersion.baseModel) || (nextVersion && nextVersion.baseModel) || detailsMap["Base Model"] || "Unknown";

    const training = detailsMap["Training"] || "";
    let usageTips = detailsMap["Usage Tips"] || "";
    if (!usageTips && nextVersion?.settings?.strength !== undefined) {
      usageTips = `STRENGTH: ${nextVersion.settings.strength}`;
    } else if (!usageTips && activeVersion?.settings?.strength !== undefined) {
      usageTips = `STRENGTH: ${activeVersion.settings.strength}`;
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

    const air = detailsMap["AIR"] || (modelId && versionId ? `civitai:${modelId}@${versionId}` : "");

    const stats =
      (activeVersion && activeVersion.stats) ||
      (nextVersion && nextVersion.rank) ||
      (apiData && apiData.stats) ||
      (nextModelData && nextModelData.rank) ||
      {};
    const dlCount = stats.downloadCount ?? stats.downloadCountAllTime ?? "-";
    const likesCount = stats.thumbsUpCount ?? stats.thumbsUpCountAllTime ?? "-";
    const statsSummary = `Downloads: ${dlCount} | Likes: ${likesCount}`;

    const creator = apiData?.creator?.username || nextModelData?.user?.username || "";
    const rawTags = apiData?.tags || nextModelData?.tagsOnModels || [];
    const tags = Array.isArray(rawTags)
      ? rawTags.map((t) => (typeof t === "string" ? t : t?.tag?.name || t?.name || "")).filter(Boolean)
      : [];

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
        (isActivePageVersion ? nextExtracted.infiniteImagesByVersion["all"] : []) ||
        [];
      addRawMediaList(verItems);
    }
    if (isActivePageVersion && liveDomMedia.orderedItems.length > 0) {
      addRawMediaList(liveDomMedia.orderedItems);
    }

    const media = rawMediaSources.map((img, idx) =>
      resolveCivitaiMediaItem(img, idx, cdnBase, liveDomMedia.byUuid)
    );

    const pageUrl =
      modelId && versionId
        ? `${location.origin}/models/${modelId}?modelVersionId=${versionId}`
        : location.href;

    return {
      modelId,
      versionId,
      title,
      versionName,
      allVersionsList,
      fileName,
      rawStorageFileName,
      fileSizeFormatted,
      fileFormat,
      files,
      triggerWords,
      rawDescriptionHtml,
      descriptionText,
      rawVersionDescriptionHtml,
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
  }

  ROOT.scraper = {
    getModelIdFromUrl,
    fetchModelDataFromApi,
    extractFromNextData,
    getQuickModelMetaForCheck,
    extractModelPayload,
    findDownloadCardContainer,
    findDetailsBlockContainer
  };
})();
