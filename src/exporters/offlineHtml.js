import { formatCompactNumber } from "../shared/folders.js";
import { sanitizeDescriptionHtml } from "../shared/htmlSanitizer.js";
import {
  buildLoraTag,
  buildSafeMediaFilename,
  escapeHtml,
  sanitizeHttpUrl,
  sanitizeSegment,
  serializeJsonForScript
} from "../shared/sanitize.js";

function uniqueNonEmpty(list) {
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

function renderStaticMediaCardHtml(item) {
  const firstSrc = item.localSrc || item.displaySrc || item.cdnSrc || "";
  const safeCdnHref = sanitizeHttpUrl(item.cdnSrc || item.displaySrc, "#");
  const posterAttr = item.posterSrc ? ` poster="${escapeHtml(item.posterSrc)}"` : "";
  const mediaEl = item.isVideo
    ? `<video src="${escapeHtml(firstSrc)}"${posterAttr} preload="metadata" autoplay loop muted playsinline controls data-fb-idx="0" data-media-idx="${item.idx}"></video>`
    : `<button type="button" class="civ-media-zoom-btn" data-action="lightbox" data-idx="${item.idx}" aria-label="Open media #${escapeHtml(item.idxStr)} in lightbox"><img src="${escapeHtml(firstSrc)}" alt="Example #${escapeHtml(item.idxStr)}" loading="eager" data-fb-idx="0" data-media-idx="${item.idx}" /></button>`;

  const hasPrompt = Boolean(item.prompt || item.negativePrompt || item.steps || item.sampler);
  const promptBlock = item.prompt
    ? `<div>
        <div class="civ-prompt-hdr">
          <span>PROMPT</span>
          <button type="button" class="civ-copy-mini" data-action="copy-prompt" data-idx="${item.idx}">Copy 📋</button>
        </div>
        <div class="civ-prompt-box">${escapeHtml(item.prompt)}</div>
      </div>`
    : "";
  const negBlock = item.negativePrompt
    ? `<div>
        <div class="civ-prompt-hdr">
          <span>NEGATIVE PROMPT</span>
          <button type="button" class="civ-copy-mini" data-action="copy-neg" data-idx="${item.idx}">Copy 📋</button>
        </div>
        <div class="civ-prompt-box">${escapeHtml(item.negativePrompt)}</div>
      </div>`
    : "";

  return `
    <div class="civ-media-card" data-card-idx="${item.idx}">
      ${mediaEl}
      <div class="civ-media-top-right">
        ${item.isVideo ? `<button type="button" class="civ-media-icon-btn" data-action="lightbox" data-idx="${item.idx}" title="Open Video in Lightbox" aria-label="Open video #${escapeHtml(item.idxStr)} in lightbox">⛶</button>` : ""}
        ${item.prompt ? `<button type="button" class="civ-media-icon-btn" data-action="copy-prompt" data-idx="${item.idx}" title="Copy Generation Prompt" aria-label="Copy prompt for media #${escapeHtml(item.idxStr)}">📋</button>` : ""}
        ${safeCdnHref !== "#" ? `<a href="${escapeHtml(safeCdnHref)}" target="_blank" rel="noopener noreferrer" class="civ-media-icon-btn" title="Open Original on Civitai CDN" aria-label="Open original #${escapeHtml(item.idxStr)} on Civitai CDN">🔗</a>` : ""}
      </div>
      <div class="civ-media-bottom-bar">
        <div class="civ-reactions-pill">
          <span style="color:#ffd43b;">⚡ #${escapeHtml(item.idxStr)}</span>
          <span>${item.isVideo ? "🎬 Video" : "🖼️ Image"}</span>
        </div>
        ${hasPrompt ? `<button type="button" class="civ-info-i-btn" data-action="toggle-prompt" data-idx="${item.idx}" title="Show Generation Prompt & Parameters" aria-label="Show generation info for media #${escapeHtml(item.idxStr)}">i</button>` : ""}
      </div>
      <div class="civ-prompt-overlay" id="prompt-ov-${item.idx}">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong style="color:#74c0fc;">Generation Data (#${escapeHtml(item.idxStr)})</strong>
          <button type="button" class="civ-btn-top" style="padding:2px 8px;font-size:11px;" data-action="toggle-prompt" data-idx="${item.idx}" aria-label="Close generation info">✕ Close</button>
        </div>
        ${promptBlock}
        ${negBlock}
        <div style="font-size:11.5px;color:#adb5bd;">
          Steps: <strong>${escapeHtml(item.steps || "-")}</strong> | Sampler: <strong>${escapeHtml(item.sampler || "-")}</strong> | CFG: <strong>${escapeHtml(item.cfgScale || "-")}</strong> | Seed: <strong>${escapeHtml(item.seed || "-")}</strong>
        </div>
      </div>
    </div>`;
}

export function buildOfflineHtml(payload, loraStem) {
  const cleanLoraStem = sanitizeSegment(loraStem || payload.title || "LoRA_Model", 75);
  const triggerList = Array.isArray(payload.triggerWords) ? payload.triggerWords : [];
  const triggerStr = triggerList.length > 0 ? triggerList.join(", ") : "";
  const loraTag = buildLoraTag(payload.fileName, payload.usageTips);

  let pageOrigin = "https://civitai.com";
  try {
    if (payload.pageUrl) pageOrigin = new URL(payload.pageUrl).origin;
  } catch (e) {}

  const safePageUrl = sanitizeHttpUrl(payload.pageUrl, "#", pageOrigin);
  const safeDescHtml = sanitizeDescriptionHtml(payload.rawDescriptionHtml || payload.descriptionHtml || "", pageOrigin);
  const safeVerDescHtml = sanitizeDescriptionHtml(
    payload.rawVersionDescriptionHtml || payload.versionDescriptionHtml || "",
    pageOrigin
  );

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
      const verUrl = payload.modelId
        ? sanitizeHttpUrl(`${pageOrigin}/models/${payload.modelId}?modelVersionId=${v.id}`, safePageUrl)
        : safePageUrl;
      return `<a href="${escapeHtml(verUrl)}" target="_blank" rel="noopener noreferrer" class="civ-version-tab ${isAct ? "active" : ""}">
        <span>🏷️</span>
        <span>${escapeHtml(v.name || "v1.0")}</span>
      </a>`;
    })
    .join("\n");

  const tagPillsHtml = (payload.tags || [])
    .slice(0, 14)
    .map((t, idx) => `<span class="civ-tag-pill ${idx === 0 ? "primary-tag" : ""}">${escapeHtml(String(t).toUpperCase())}</span>`)
    .join("\n");

  const triggerBadgesHtml =
    triggerList.length > 0
      ? triggerList
          .map(
            (tw) =>
              `<button type="button" class="civ-trigger-badge" data-action="copy-text" data-copy="${escapeHtml(tw)}" title="Click to copy trigger word">
                <span>${escapeHtml(String(tw).toUpperCase())}</span>
                <span>❐</span>
              </button>`
          )
          .join(" ")
      : `<span style="color:#909296;font-size:12px;">No trigger words</span>`;

  const autoV2Hash = payload.hashes?.AutoV2 || (payload.hashes?.SHA256 ? payload.hashes.SHA256.slice(0, 10) : "N/A");
  const airFull = payload.air || `civitai:${payload.modelId || "0"}@${payload.versionId || "0"}`;
  const mIdStr = String(payload.modelId || "0");
  const vIdStr = String(payload.versionId || "0");

  const directModelDownloadUrl = payload.versionId
    ? sanitizeHttpUrl(`${pageOrigin}/api/download/models/${payload.versionId}`, safePageUrl)
    : safePageUrl;

  const filesList =
    Array.isArray(payload.files) && payload.files.length > 0
      ? payload.files
      : [
          {
            name: payload.fileName,
            format: payload.fileFormat || "SafeTensor",
            sizeFormatted: payload.fileSizeFormatted || "",
            primary: true,
            downloadUrl: directModelDownloadUrl
          }
        ];

  const fileRowsHtml = filesList
    .map((f, idx) => {
      const fUrl = sanitizeHttpUrl(f.downloadUrl || directModelDownloadUrl, safePageUrl);
      const formatLabel = f.format || payload.fileFormat || "SafeTensor";
      return `
        <div class="civ-file-block ${idx > 0 ? "civ-file-extra" : ""}">
          <div class="civ-file-row">
            <div class="civ-file-icon" aria-hidden="true">📦</div>
            <div class="civ-file-meta">
              <div class="civ-file-format">${escapeHtml(formatLabel)}${f.primary ? ' <span class="civ-primary-pill">Primary</span>' : ""}</div>
              <button type="button" class="civ-file-name-btn" data-action="copy-text" data-copy="${escapeHtml(f.name || payload.fileName)}" title="Click to copy filename">
                ${escapeHtml(f.name || payload.fileName)} 📋
              </button>
              <div class="civ-file-sub">${escapeHtml(f.sizeFormatted || payload.fileSizeFormatted || "Model File")}</div>
            </div>
          </div>
          ${fUrl !== "#" ? `<a href="${escapeHtml(fUrl)}" target="_blank" rel="noopener noreferrer" class="civ-dl-btn"><span>⬇ Download (${escapeHtml(f.sizeFormatted || "File")})</span></a>` : ""}
        </div>`;
    })
    .join("\n");

  const clientMediaItems = (payload.media || []).map((m, i) => {
    const idxStr = String(i + 1).padStart(2, "0");
    const rawLocalName = m.localFileName || buildSafeMediaFilename(i, cleanLoraStem, m.extension);
    const localSrc = encodeURI(rawLocalName);
    const safeDisplay = sanitizeHttpUrl(m.displayUrl, "");
    const safeDownload = sanitizeHttpUrl(m.downloadUrl, "");
    const safeFallback = sanitizeHttpUrl(m.fallbackUrl, "");
    const safePoster = sanitizeHttpUrl(m.posterUrl, "");
    const extraCandidates = Array.isArray(m.candidateUrls)
      ? m.candidateUrls.map((u) => sanitizeHttpUrl(u, "")).filter(Boolean)
      : [];

    const fallbacks = uniqueNonEmpty([localSrc, safeDisplay, safeDownload, safeFallback, ...extraCandidates]);
    return {
      idx: i,
      idxStr,
      isVideo: Boolean(m.isVideo),
      localSrc,
      cdnSrc: safeDownload || safeDisplay,
      displaySrc: safeDisplay || safeDownload,
      posterSrc: safePoster,
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

  const clientMediaJson = serializeJsonForScript(clientMediaItems);
  const firstItem = clientMediaItems[0];
  const isLandscapeMedia = Boolean(
    firstItem && firstItem.width && firstItem.height && firstItem.width > firstItem.height * 1.15
  );

  const initialSlice = clientMediaItems.slice(0, 2);
  const initialStageHtml =
    initialSlice.length > 0
      ? initialSlice.map(renderStaticMediaCardHtml).join("\n")
      : `<div style="grid-column:1/-1;padding:48px;text-align:center;color:#909296;background:#141517;border-radius:12px;border:1px solid #2c2e33;">No preview media found on this page.</div>`;

  const initialStageClasses = [
    "civ-carousel-pair",
    initialSlice.length === 1 ? "single-item" : "",
    isLandscapeMedia ? "landscape-cards" : ""
  ]
    .filter(Boolean)
    .join(" ");

  const thumbStripHtml =
    clientMediaItems.length > 1
      ? `<div class="civ-thumb-strip" id="civ-thumb-strip">
          ${clientMediaItems
            .map((item, idx) => {
              const activeCls = idx < 2 ? "active" : "";
              const thumbUrl = item.isVideo ? item.posterSrc || "" : item.localSrc || item.displaySrc;
              return `<button type="button" class="civ-thumb-item ${activeCls}" data-action="jump-media" data-idx="${idx}" title="${item.isVideo ? "Video" : "Image"} #${item.idxStr}" aria-label="Jump to media #${item.idxStr}">
                ${
                  item.isVideo && !thumbUrl
                    ? `<span class="civ-thumb-vid-tag">🎬 #${item.idxStr}</span>`
                    : `<img src="${escapeHtml(thumbUrl || item.localSrc)}" alt="#${item.idxStr}" data-media-idx="${item.idx}" data-fb-idx="0" />`
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

  const imageCount = clientMediaItems.filter((m) => !m.isVideo).length;
  const videoCount = clientMediaItems.filter((m) => m.isVideo).length;
  const promptCount = clientMediaItems.filter((m) => m.prompt || m.negativePrompt).length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(payload.title)} - Civitai Offline Page</title>
  <style>
    :root {
      --dark-9: #101113; --dark-8: #141517; --dark-7: #1a1b1e;
      --dark-6: #25262b; --dark-5: #2c2e33; --dark-4: #373a40;
      --gray-2: #e9ecef; --gray-4: #ced4da; --gray-5: #adb5bd; --gray-6: #909296;
      --blue-6: #228be6; --blue-7: #1c7ed6; --blue-8: #1971c2;
      --green-5: #40c057; --indigo-light: rgba(92, 124, 250, 0.22); --indigo-text: #bac8ff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; background-color: var(--dark-7); color: var(--gray-2);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px; line-height: 1.55; -webkit-font-smoothing: antialiased;
    }
    a { color: #4dabf7; text-decoration: none; }
    a:hover { text-decoration: underline; }
    button:focus-visible, a:focus-visible, input:focus-visible { outline: 2px solid #74c0fc; outline-offset: 2px; }

    .civ-navbar {
      background: var(--dark-8); border-bottom: 1px solid var(--dark-5);
      padding: 0 24px; height: 56px; display: flex; align-items: center;
      justify-content: space-between; gap: 16px; position: sticky; top: 0; z-index: 100;
    }
    .civ-logo-group { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
    .civ-logo { font-size: 21px; font-weight: 900; letter-spacing: 1px; color: #fff; display: flex; align-items: center; text-decoration: none !important; }
    .civ-logo span { background: linear-gradient(135deg, #228be6, #15aabf); color: #fff; padding: 1px 5px; border-radius: 4px; margin-left: 2px; font-size: 18px; }
    .civ-pro-badge { background: linear-gradient(135deg, #3b5bdb, #228be6); color: #fff; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px; }
    .civ-search-input {
      background: var(--dark-6); border: 1px solid var(--dark-4); border-radius: 6px;
      padding: 7px 12px; width: 380px; max-width: 36vw; color: #fff; font-size: 13px;
    }
    .civ-nav-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .civ-btn-top {
      background: var(--dark-6); border: 1px solid var(--dark-4); color: var(--gray-2);
      padding: 6px 12px; border-radius: 6px; font-size: 12.5px; font-weight: 600;
      cursor: pointer; text-decoration: none !important; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
    }
    .civ-btn-top:hover { background: var(--dark-5); border-color: var(--blue-6); color: #fff; }

    .civ-subnav {
      background: var(--dark-8); border-bottom: 1px solid var(--dark-5);
      padding: 6px 24px; display: flex; align-items: center; gap: 8px; overflow-x: auto; font-size: 12.5px;
    }
    .civ-subnav-btn {
      background: transparent; border: 1px solid transparent; color: var(--gray-5);
      padding: 4px 12px; border-radius: 999px; font-weight: 600; cursor: pointer; white-space: nowrap; font-size: 12.5px;
    }
    .civ-subnav-btn:hover { background: var(--dark-6); color: #fff; }
    .civ-subnav-btn.active { background: var(--dark-5); color: #fff; border-color: var(--dark-4); }

    .civ-container { max-width: 1460px; margin: 0 auto; padding: 18px 28px 60px; }
    .civ-header-block { margin-bottom: 14px; }
    .civ-title-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 8px; }
    .civ-h1 { margin: 0; font-size: 26px; font-weight: 800; color: #fff; line-height: 1.25; }
    .civ-stat-chip { background: var(--dark-6); border: 1px solid var(--dark-4); color: var(--gray-2); padding: 3px 9px; border-radius: 6px; font-size: 12px; font-weight: 700; display: inline-flex; align-items: center; gap: 5px; }
    .civ-substats-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 8px; }
    .civ-mini-stat { background: var(--dark-8); border: 1px solid var(--dark-5); color: var(--gray-4); padding: 2px 8px; border-radius: 5px; font-size: 11.5px; font-weight: 600; }
    .civ-meta-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--gray-6); font-size: 12px; margin-bottom: 12px; }
    .civ-tag-pill { background: var(--dark-6); color: var(--gray-4); border: 1px solid var(--dark-4); padding: 2px 8px; border-radius: 4px; font-size: 10.5px; font-weight: 700; }
    .civ-tag-pill.primary-tag { background: rgba(34, 139, 230, 0.24); color: #74c0fc; border-color: rgba(34, 139, 230, 0.45); }

    .civ-version-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
    .civ-version-tab { background: var(--dark-6); border: 1px solid var(--dark-4); color: var(--gray-2); padding: 5px 11px; border-radius: 6px; font-size: 12.5px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px; text-decoration: none !important; }
    .civ-version-tab:hover { background: var(--dark-5); color: #fff; }
    .civ-version-tab.active { background: var(--blue-8); border-color: var(--blue-6); color: #fff; }

    .civ-main-grid { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 24px; align-items: start; }
    @media (max-width: 1060px) { .civ-main-grid { grid-template-columns: 1fr; } }

    .civ-carousel-wrapper { margin-bottom: 22px; }
    .civ-carousel-stage-wrap { position: relative; min-height: 320px; }
    .civ-carousel-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .civ-carousel-pair.single-item { grid-template-columns: minmax(0, 680px); }
    .civ-carousel-pair.grid-all-mode { grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); }
    @media (max-width: 720px) { .civ-carousel-pair { grid-template-columns: 1fr; } }

    .civ-media-card { position: relative; background: var(--dark-9); border: 1px solid var(--dark-5); border-radius: 12px; overflow: hidden; height: 450px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35); }
    .civ-carousel-pair.landscape-cards .civ-media-card { height: 340px; }
    .civ-media-zoom-btn { border: none; background: transparent; padding: 0; width: 100%; height: 100%; display: block; cursor: zoom-in; }
    .civ-media-card img, .civ-media-card video { width: 100%; height: 100%; object-fit: cover; display: block; background: #0c0d0f; }
    body.fit-contain-mode .civ-media-card img, body.fit-contain-mode .civ-media-card video { object-fit: contain; }
    .civ-media-top-right { position: absolute; top: 10px; right: 10px; display: flex; gap: 6px; z-index: 4; }
    .civ-media-icon-btn { width: 28px; height: 28px; border-radius: 50%; background: rgba(20, 21, 23, 0.78); backdrop-filter: blur(6px); border: 1px solid rgba(255, 255, 255, 0.18); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 12px; cursor: pointer; text-decoration: none !important; padding: 0; }
    .civ-media-icon-btn:hover { background: rgba(34, 139, 230, 0.9); }
    .civ-media-bottom-bar { position: absolute; bottom: 10px; left: 10px; right: 10px; display: flex; align-items: center; justify-content: space-between; pointer-events: none; z-index: 4; }
    .civ-reactions-pill { pointer-events: auto; background: rgba(20, 21, 23, 0.8); backdrop-filter: blur(6px); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 6px; padding: 3px 9px; display: inline-flex; align-items: center; gap: 8px; font-size: 11.5px; font-weight: 700; color: #fff; }
    .civ-info-i-btn { pointer-events: auto; width: 28px; height: 28px; border-radius: 50%; background: rgba(20, 21, 23, 0.85); backdrop-filter: blur(6px); border: 1px solid rgba(255, 255, 255, 0.25); color: #fff; font-weight: 700; font-style: italic; font-family: Georgia, serif; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; }
    .civ-info-i-btn:hover { background: var(--blue-6); border-color: #74c0fc; }
    .civ-prompt-overlay { position: absolute; inset: 0; background: rgba(16, 17, 19, 0.95); backdrop-filter: blur(8px); padding: 14px; overflow-y: auto; display: none; flex-direction: column; gap: 10px; z-index: 6; font-size: 12.5px; }
    .civ-prompt-overlay.open { display: flex; }
    .civ-prompt-hdr { font-size: 11px; color: #909296; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; font-weight: 700; }
    .civ-copy-mini { background: var(--dark-6); border: 1px solid var(--dark-4); color: #74c0fc; border-radius: 4px; padding: 2px 7px; font-size: 11px; font-weight: 600; cursor: pointer; }
    .civ-copy-mini:hover { background: var(--blue-8); color: #fff; }
    .civ-prompt-box { background: var(--dark-7); border: 1px solid var(--dark-4); border-radius: 6px; padding: 8px 10px; font-family: monospace; font-size: 11.5px; color: var(--gray-2); white-space: pre-wrap; word-break: break-word; }

    .civ-carousel-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 38px; height: 38px; border-radius: 50%; background: rgba(26, 27, 30, 0.85); border: 1px solid rgba(255, 255, 255, 0.22); color: #fff; font-size: 20px; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 10; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5); padding: 0; }
    .civ-carousel-nav:hover { background: var(--blue-7); border-color: #74c0fc; }
    .civ-carousel-nav.prev { left: 10px; }
    .civ-carousel-nav.next { right: 10px; }

    .civ-thumb-strip { display: flex; gap: 6px; overflow-x: auto; padding: 8px 0 4px; }
    .civ-thumb-item { position: relative; width: 58px; height: 44px; border-radius: 6px; overflow: hidden; border: 2px solid var(--dark-4); background: var(--dark-9); padding: 0; cursor: pointer; flex-shrink: 0; opacity: 0.65; }
    .civ-thumb-item:hover, .civ-thumb-item.active { opacity: 1; border-color: var(--blue-6); }
    .civ-thumb-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .civ-thumb-vid-tag { font-size: 10px; color: #74c0fc; font-weight: 700; }
    .civ-thumb-badge { position: absolute; bottom: 2px; right: 2px; background: rgba(0, 0, 0, 0.75); color: #fff; font-size: 9px; padding: 1px 4px; border-radius: 3px; }
    .civ-carousel-dots { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; color: var(--gray-6); font-size: 12px; }
    .civ-carousel-links { display: flex; align-items: center; gap: 10px; }
    .civ-link-btn { background: transparent; border: none; padding: 2px 4px; cursor: pointer; color: #74c0fc; font-weight: 600; font-size: 12px; }
    .civ-link-btn:hover { text-decoration: underline; }

    .civ-description-section { margin-top: 14px; padding-top: 6px; }
    .civ-prose { color: var(--gray-2); font-size: 14.5px; line-height: 1.62; overflow-wrap: break-word; }
    .civ-prose h1, .civ-prose h2, .civ-prose h3, .civ-prose h4 { color: #fff; margin-top: 16px; margin-bottom: 10px; font-weight: 700; }
    .civ-prose p { margin: 0 0 12px 0; }
    .civ-prose img { max-width: 100%; height: auto; border-radius: 8px; }
    .civ-prose pre, .civ-prose code { background: var(--dark-8); border: 1px solid var(--dark-5); border-radius: 5px; padding: 2px 6px; font-family: monospace; font-size: 13px; color: #74c0fc; }
    .civ-prose pre { padding: 12px; overflow-x: auto; }
    .civ-prose blockquote { margin: 14px 0; padding: 10px 16px; border-left: 4px solid var(--blue-6); background: var(--dark-8); border-radius: 0 6px 6px 0; }

    .civ-sidebar { display: flex; flex-direction: column; gap: 12px; }
    .civ-card { background: var(--dark-6); border: 1px solid var(--dark-4); border-radius: 8px; overflow: hidden; }
    .civ-card-inner { padding: 12px 14px; }
    .civ-loaded-dot { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--green-5); font-weight: 700; background: rgba(64, 192, 87, 0.12); border: 1px solid rgba(64, 192, 87, 0.3); padding: 2px 8px; border-radius: 999px; margin-bottom: 8px; }
    .civ-loaded-dot::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--green-5); }
    .civ-create-btn { width: 100%; background: var(--blue-6); color: #fff !important; border: none; border-radius: 6px; padding: 9px 14px; font-size: 13.5px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; text-decoration: none !important; margin-bottom: 10px; }
    .civ-create-btn:hover { background: var(--blue-7); }
    .civ-icon-bar { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
    .civ-square-btn { background: var(--dark-5); border: 1px solid var(--dark-4); color: var(--gray-4); height: 32px; border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 13px; text-decoration: none !important; padding: 0; }
    .civ-square-btn:hover { background: var(--dark-4); color: #fff; border-color: var(--blue-6); }

    .civ-dl-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--dark-4); font-size: 13px; }
    .civ-dl-header strong { color: #fff; font-weight: 600; }
    .civ-dl-header span { color: var(--gray-6); font-size: 11.5px; }
    .civ-dl-body { padding: 12px 14px; background: var(--dark-7); display: flex; flex-direction: column; gap: 10px; }
    .civ-file-extra { padding-top: 10px; border-top: 1px solid var(--dark-5); }
    .civ-file-row { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 8px; }
    .civ-file-icon { width: 32px; height: 32px; border-radius: 6px; background: rgba(34, 139, 230, 0.16); border: 1px solid rgba(34, 139, 230, 0.35); color: #74c0fc; display: flex; align-items: center; justify-content: center; font-size: 15px; flex-shrink: 0; margin-top: 2px; }
    .civ-file-meta { flex: 1; min-width: 0; }
    .civ-file-format { font-size: 13px; font-weight: 700; color: #fff; line-height: 1.3; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .civ-primary-pill { font-size: 10px; background: rgba(64, 192, 87, 0.18); color: #69db7c; border: 1px solid rgba(64, 192, 87, 0.35); padding: 1px 5px; border-radius: 4px; }
    .civ-file-name-btn { background: transparent; border: none; padding: 2px 0; font-size: 12px; color: var(--gray-4); font-family: monospace; word-break: break-all; cursor: pointer; text-align: left; }
    .civ-file-name-btn:hover { color: #74c0fc; text-decoration: underline; }
    .civ-file-sub { font-size: 11.5px; color: var(--gray-6); }
    .civ-dl-btn { width: 100%; background: rgba(34, 139, 230, 0.18); border: 1px solid rgba(34, 139, 230, 0.35); color: #74c0fc !important; border-radius: 6px; padding: 8px 12px; font-size: 12.5px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; text-decoration: none !important; }
    .civ-dl-btn:hover { background: rgba(34, 139, 230, 0.28); color: #fff !important; }

    .civ-accordion-header { width: 100%; background: var(--dark-6); border: none; color: #fff; padding: 11px 14px; font-size: 13.5px; font-weight: 600; display: flex; align-items: center; justify-content: space-between; cursor: pointer; border-bottom: 1px solid var(--dark-4); }
    .civ-accordion-header:hover { background: var(--dark-5); }
    .civ-acc-chevron { transition: transform .15s ease; }
    .civ-accordion-header[aria-expanded="false"] .civ-acc-chevron { transform: rotate(180deg); }
    .civ-accordion-body { background: var(--dark-7); }
    .civ-accordion-body.collapsed { display: none; }

    .civ-detail-row { display: grid; grid-template-columns: 105px 1fr; align-items: center; padding: 8px 14px; border-bottom: 1px solid var(--dark-5); font-size: 12.5px; gap: 10px; }
    .civ-detail-row:last-child { border-bottom: none; }
    .civ-detail-label { color: var(--gray-5); font-weight: 500; }
    .civ-detail-value { color: var(--gray-2); display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; text-align: right; }
    .civ-type-badge { background: var(--dark-8); border: 1px solid var(--dark-4); color: #fff; font-size: 10.5px; font-weight: 800; padding: 2px 9px; border-radius: 999px; }
    .civ-teal-badge { background: rgba(18, 184, 134, 0.18); color: #38d9a9; border: 1px solid rgba(18, 184, 134, 0.35); font-size: 10.5px; font-weight: 800; padding: 2px 8px; border-radius: 4px; text-transform: uppercase; }
    .civ-hash-box { display: inline-flex; align-items: center; border: 1px solid var(--dark-4); border-radius: 4px; overflow: hidden; font-family: monospace; font-size: 11px; cursor: pointer; background: transparent; padding: 0; color: inherit; }
    .civ-hash-box .h-lbl { background: var(--dark-8); color: var(--gray-4); padding: 2px 7px; font-weight: 700; border-right: 1px solid var(--dark-4); }
    .civ-hash-box .h-val { background: var(--dark-6); color: #fff; padding: 2px 8px; }
    .civ-trigger-badge { background: var(--indigo-light); color: var(--indigo-text); border: 1px solid rgba(116, 143, 252, 0.35); padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; text-align: left; word-break: break-word; }
    .civ-trigger-badge:hover { background: rgba(92, 124, 250, 0.35); color: #fff; }
    .civ-air-box { display: inline-flex; align-items: center; gap: 3px; background: var(--dark-8); border: 1px solid var(--dark-4); padding: 2px 7px; border-radius: 4px; font-family: monospace; font-size: 11px; color: var(--gray-4); cursor: pointer; }
    .civ-air-num { background: var(--blue-8); color: #fff; padding: 0 5px; border-radius: 3px; font-weight: 700; }

    #civ-toast { position: fixed; bottom: 24px; right: 24px; background: #0ca678; color: #fff; padding: 10px 18px; border-radius: 8px; font-weight: 700; font-size: 13px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5); opacity: 0; pointer-events: none; transition: opacity 0.2s ease; z-index: 9999; }
    #civ-toast.show { opacity: 1; }
    #civ-toast.error { background: #e03131; }

    dialog#civ-lightbox {
      margin: auto; border: none; padding: 0; background: transparent;
      max-width: 94vw; max-height: 92vh; overflow: visible; color: #e9ecef;
    }
    dialog#civ-lightbox::backdrop { background: rgba(10, 11, 13, 0.92); backdrop-filter: blur(4px); }
    .civ-lb-frame { position: relative; display: flex; flex-direction: column; align-items: center; gap: 10px; }
    .civ-lb-stage { position: relative; display: flex; align-items: center; justify-content: center; }
    .civ-lb-stage img, .civ-lb-stage video { max-width: 88vw; max-height: 78vh; border-radius: 8px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.8); background: #000; }
    .civ-lb-controls { display: flex; align-items: center; gap: 10px; }
    .civ-lb-prompt { max-width: 820px; width: 100%; background: var(--dark-8); border: 1px solid var(--dark-4); border-radius: 8px; padding: 10px 14px; font-family: monospace; font-size: 12px; color: var(--gray-2); max-height: 150px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; }
  </style>
  <script>
    const MEDIA_ITEMS = ${clientMediaJson};
    const IS_LANDSCAPE_DEFAULT = ${isLandscapeMedia ? "true" : "false"};

    function handleMediaError(el) {
      const idxAttr = el.getAttribute("data-media-idx");
      const idx = idxAttr !== null ? Number(idxAttr) : -1;
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

    document.addEventListener("error", (ev) => {
      const t = ev.target;
      if (t && (t.tagName === "IMG" || t.tagName === "VIDEO") && t.hasAttribute("data-media-idx")) {
        handleMediaError(t);
      }
    }, true);
  </script>
</head>
<body>
  <header class="civ-navbar">
    <div class="civ-logo-group">
      ${safePageUrl !== "#" ? `<a href="${escapeHtml(safePageUrl)}" target="_blank" rel="noopener noreferrer" class="civ-logo">CIVIT<span>AI</span></a>` : `<span class="civ-logo">CIVIT<span>AI</span></span>`}
      <span class="civ-pro-badge">Offline Archive</span>
    </div>
    <input type="search" id="civ-search-input" class="civ-search-input" aria-label="Filter media prompts" placeholder="Filter media by prompt or sampler..." />
    <div class="civ-nav-right">
      <button type="button" class="civ-btn-top" id="toggle-fit-mode" data-action="toggle-fit" title="Switch between Cover crop and Full Fit">📐 Fit / Crop</button>
      <button type="button" class="civ-btn-top" id="toggle-gallery-mode" data-action="toggle-gallery">🖼️ Show All Media (${clientMediaItems.length})</button>
      ${safePageUrl !== "#" ? `<a href="${escapeHtml(safePageUrl)}" target="_blank" rel="noopener noreferrer" class="civ-btn-top">🌐 Open on Civitai ↗</a>` : ""}
    </div>
  </header>

  <nav class="civ-subnav" aria-label="Media filter">
    <button type="button" class="civ-subnav-btn active" data-action="set-filter" data-filter="all">All Media (${clientMediaItems.length})</button>
    <button type="button" class="civ-subnav-btn" data-action="set-filter" data-filter="images">Images (${imageCount})</button>
    <button type="button" class="civ-subnav-btn" data-action="set-filter" data-filter="videos">Videos (${videoCount})</button>
    <button type="button" class="civ-subnav-btn" data-action="set-filter" data-filter="prompts">With Prompts (${promptCount})</button>
  </nav>

  <main class="civ-container">
    <div class="civ-header-block">
      <div class="civ-title-row">
        <h1 class="civ-h1">${escapeHtml(payload.title)}</h1>
        <span class="civ-stat-chip" title="Likes">👍 ${escapeHtml(likesFormatted)}</span>
        <span class="civ-stat-chip" title="Downloads">⬇ ${escapeHtml(dlFormatted)}</span>
      </div>
      <div class="civ-substats-row">
        ${collCountRaw ? `<span class="civ-mini-stat" title="Collections">🔖 ${escapeHtml(collFormatted)}</span>` : ""}
        ${genCountRaw ? `<span class="civ-mini-stat" title="Generations">🖌 ${escapeHtml(genFormatted)}</span>` : ""}
        ${buzzCountRaw ? `<span class="civ-mini-stat" title="Buzz"><span style="color:#ffd43b;">⚡</span> ${escapeHtml(buzzFormatted)}</span>` : ""}
      </div>
      <div class="civ-meta-row">
        <span>Updated: ${escapeHtml(payload.publishedAt || "Recently")}</span>
        ${payload.creator ? `<span>• by <strong style="color:#fff;">${escapeHtml(payload.creator)}</strong></span>` : ""}
        ${tagPillsHtml}
      </div>
      <div class="civ-version-tabs">${versionPillsHtml}</div>
    </div>

    <div class="civ-main-grid">
      <div class="civ-left-col">
        <div class="civ-carousel-wrapper">
          <div class="civ-carousel-stage-wrap">
            <button type="button" class="civ-carousel-nav prev" id="car-prev" style="${clientMediaItems.length > 2 ? "display:flex;" : "display:none;"}" data-action="step-carousel" data-delta="-2" aria-label="Previous media">‹</button>
            <div class="${initialStageClasses}" id="media-stage">${initialStageHtml}</div>
            <button type="button" class="civ-carousel-nav next" id="car-next" style="${clientMediaItems.length > 2 ? "display:flex;" : "display:none;"}" data-action="step-carousel" data-delta="2" aria-label="Next media">›</button>
          </div>
          ${thumbStripHtml}
          <div class="civ-carousel-dots">
            <span id="car-counter">Showing ${clientMediaItems.length > 0 ? `1–${Math.min(2, clientMediaItems.length)}` : "0"} of ${clientMediaItems.length} example media</span>
            <div class="civ-carousel-links">
              <button type="button" class="civ-link-btn" data-action="toggle-fit">📐 Toggle Fit/Crop</button>
              <button type="button" class="civ-link-btn" data-action="toggle-gallery" id="car-mode-link">Switch to Full Grid View (${clientMediaItems.length}) ⊞</button>
            </div>
          </div>
        </div>

        <section class="civ-description-section" aria-label="Model description">
          <div class="civ-prose">
            ${safeDescHtml || `<pre style="white-space:pre-wrap">${escapeHtml(payload.descriptionText || "No description provided.")}</pre>`}
          </div>
        </section>
      </div>

      <aside class="civ-sidebar">
        <div class="civ-card">
          <div class="civ-card-inner">
            <div class="civ-loaded-dot">Saved Offline</div>
            <button type="button" class="civ-create-btn" data-action="copy-text" data-copy="${escapeHtml(loraTag)}">
              <span>📋 Copy ${escapeHtml(loraTag)}</span>
            </button>
            <div class="civ-icon-bar">
              <button type="button" class="civ-square-btn" title="Copy Full Filename" aria-label="Copy full filename" data-action="copy-text" data-copy="${escapeHtml(payload.fileName)}">📄</button>
              <button type="button" class="civ-square-btn" title="Copy Trigger Words" aria-label="Copy trigger words" data-action="copy-text" data-copy="${escapeHtml(triggerStr)}">🏷️</button>
              <button type="button" class="civ-square-btn" title="Copy AutoV2 Hash" aria-label="Copy AutoV2 hash" data-action="copy-text" data-copy="${escapeHtml(autoV2Hash)}">#️⃣</button>
              <button type="button" class="civ-square-btn" title="Copy AIR Identifier" aria-label="Copy AIR ID" data-action="copy-text" data-copy="${escapeHtml(airFull)}">🔗</button>
              <button type="button" class="civ-square-btn" title="Toggle All Media Grid" aria-label="Toggle media grid" data-action="toggle-gallery">🖼️</button>
              ${safePageUrl !== "#" ? `<a href="${escapeHtml(safePageUrl)}" target="_blank" rel="noopener noreferrer" class="civ-square-btn" title="Open Original Page" aria-label="Open original page">↗</a>` : `<button type="button" class="civ-square-btn" data-action="copy-text" data-copy="${escapeHtml(loraTag)}" aria-label="Copy LoRA tag">⚡</button>`}
            </div>
          </div>
        </div>

        <div class="civ-card">
          <div class="civ-dl-header">
            <strong>Files</strong>
            <span>${filesList.length} ${filesList.length === 1 ? "variant" : "variants"}</span>
          </div>
          <div class="civ-dl-body">
            ${fileRowsHtml}
          </div>
        </div>

        <div class="civ-card">
          <button type="button" class="civ-accordion-header" aria-expanded="true" aria-controls="details-acc-body" data-action="toggle-acc">
            <span>Details</span>
            <span class="civ-acc-chevron" aria-hidden="true">^</span>
          </button>
          <div class="civ-accordion-body" id="details-acc-body">
            <div class="civ-detail-row"><div class="civ-detail-label">Type</div><div class="civ-detail-value"><span class="civ-type-badge">${escapeHtml(payload.modelType || "LORA")}</span></div></div>
            <div class="civ-detail-row"><div class="civ-detail-label">Stats</div><div class="civ-detail-value" style="font-weight:600;gap:10px;"><span>⬇ ${escapeHtml(dlFormatted)}</span>${genCountRaw ? `<span>🖌 ${escapeHtml(genFormatted)}</span>` : ""}<span>👍 ${escapeHtml(likesFormatted)}</span></div></div>
            <div class="civ-detail-row"><div class="civ-detail-label">Reviews</div><div class="civ-detail-value"><span style="color:var(--green-5);font-weight:600;">${escapeHtml(payload.reviews || "N/A")}</span></div></div>
            <div class="civ-detail-row"><div class="civ-detail-label">Published</div><div class="civ-detail-value">${escapeHtml(payload.publishedAt || "N/A")}</div></div>
            <div class="civ-detail-row"><div class="civ-detail-label">Base Model</div><div class="civ-detail-value" style="font-weight:600;color:#fff;">${escapeHtml(payload.baseModel || "Unknown")}</div></div>
            ${payload.training ? `<div class="civ-detail-row"><div class="civ-detail-label">Training</div><div class="civ-detail-value"><span class="civ-teal-badge">${escapeHtml(payload.training)}</span></div></div>` : ""}
            ${payload.usageTips ? `<div class="civ-detail-row"><div class="civ-detail-label">Usage Tips</div><div class="civ-detail-value"><span class="civ-teal-badge">${escapeHtml(payload.usageTips)}</span></div></div>` : ""}
            <div class="civ-detail-row"><div class="civ-detail-label">Hash</div><div class="civ-detail-value"><button type="button" class="civ-hash-box" data-action="copy-text" data-copy="${escapeHtml(autoV2Hash)}" title="Click to copy AutoV2 hash"><span class="h-lbl">AUTOV2</span><span class="h-val">${escapeHtml(autoV2Hash)}</span></button></div></div>
            <div class="civ-detail-row"><div class="civ-detail-label">Trigger Words</div><div class="civ-detail-value">${triggerBadgesHtml}</div></div>
            <div class="civ-detail-row"><div class="civ-detail-label">AIR</div><div class="civ-detail-value"><button type="button" class="civ-air-box" data-action="copy-text" data-copy="${escapeHtml(airFull)}" title="Click to copy AIR ID"><span>civitai:</span><span class="civ-air-num">${escapeHtml(mIdStr)}</span><span>@</span><span class="civ-air-num">${escapeHtml(vIdStr)}</span><span>❐</span></button></div></div>
            ${extraDetailRowsHtml}
          </div>
        </div>

        <div class="civ-card">
          <button type="button" class="civ-accordion-header" aria-expanded="${safeVerDescHtml ? "true" : "false"}" aria-controls="ver-acc-body" data-action="toggle-acc">
            <span>About this version</span>
            <span class="civ-acc-chevron" aria-hidden="true">^</span>
          </button>
          <div class="civ-accordion-body ${safeVerDescHtml ? "" : "collapsed"}" id="ver-acc-body" style="padding:14px;font-size:13px;">
            ${safeVerDescHtml || `<div style="color:var(--gray-6);">Version: <strong>${escapeHtml(payload.versionName)}</strong><br/>File: <code>${escapeHtml(payload.fileName)}</code></div>`}
          </div>
        </div>
      </aside>
    </div>
  </main>

  <dialog id="civ-lightbox" aria-label="Media preview lightbox">
    <div class="civ-lb-frame">
      <div class="civ-lb-stage" id="civ-lb-content"></div>
      <div class="civ-lb-controls">
        <button type="button" class="civ-btn-top" id="lb-prev" data-action="lb-step" data-delta="-1" aria-label="Previous media">‹ Prev</button>
        <span id="lb-counter" style="font-size:12px;color:#adb5bd;"></span>
        <button type="button" class="civ-btn-top" id="lb-next" data-action="lb-step" data-delta="1" aria-label="Next media">Next ›</button>
        <button type="button" class="civ-btn-top" id="lb-copy-prompt" data-action="lb-copy-prompt" style="display:none;">📋 Copy Prompt</button>
        <button type="button" class="civ-btn-top" data-action="lb-close" aria-label="Close lightbox">✕ Close</button>
      </div>
      <div class="civ-lb-prompt" id="civ-lb-prompt" style="display:none;"></div>
    </div>
  </dialog>

  <div id="civ-toast" role="status" aria-live="polite"></div>

  <script>
    let carouselIndex = 0;
    let isFullGridMode = false;
    let activeFilter = "all";
    let searchQuery = "";
    let lightboxItemPos = 0;

    function escHtmlClient(s) {
      return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    function safeUrlClient(u) {
      return /^https?:\\/\\//i.test(String(u || "")) ? u : "#";
    }
    function showToast(msg, isErr = false) {
      const t = document.getElementById("civ-toast");
      if (!t) return;
      t.textContent = msg;
      t.className = isErr ? "show error" : "show";
      clearTimeout(window.__toastTimer);
      window.__toastTimer = setTimeout(() => { t.className = ""; }, 1900);
    }
    async function copyText(text) {
      if (!text) {
        showToast("Nothing to copy", true);
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        showToast("📋 Copied: " + (text.length > 42 ? text.slice(0, 42) + "..." : text));
      } catch {
        try {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          const ok = document.execCommand("copy");
          ta.remove();
          showToast(ok ? "📋 Copied!" : "Failed to copy to clipboard", !ok);
        } catch {
          showToast("Failed to copy to clipboard", true);
        }
      }
    }
    function getFilteredItems() {
      return MEDIA_ITEMS.filter((m) => {
        if (activeFilter === "images" && m.isVideo) return false;
        if (activeFilter === "videos" && !m.isVideo) return false;
        if (activeFilter === "prompts" && !m.prompt && !m.negativePrompt) return false;
        if (searchQuery) {
          const hay = (m.prompt + " " + m.negativePrompt + " " + m.sampler + " " + m.seed).toLowerCase();
          if (!hay.includes(searchQuery)) return false;
        }
        return true;
      });
    }
    function buildMediaCardHtml(item) {
      const firstSrc = item.localSrc || item.displaySrc || item.cdnSrc || "";
      const safeCdn = safeUrlClient(item.cdnSrc || item.displaySrc);
      const posterAttr = item.posterSrc ? \` poster="\${escHtmlClient(item.posterSrc)}"\` : "";
      const mediaEl = item.isVideo
        ? \`<video src="\${escHtmlClient(firstSrc)}"\${posterAttr} preload="metadata" autoplay loop muted playsinline controls data-fb-idx="0" data-media-idx="\${item.idx}"></video>\`
        : \`<button type="button" class="civ-media-zoom-btn" data-action="lightbox" data-idx="\${item.idx}" aria-label="Open media #\${escHtmlClient(item.idxStr)} in lightbox"><img src="\${escHtmlClient(firstSrc)}" alt="Example #\${escHtmlClient(item.idxStr)}" loading="lazy" data-fb-idx="0" data-media-idx="\${item.idx}" /></button>\`;
      const hasPrompt = Boolean(item.prompt || item.negativePrompt || item.steps || item.sampler);
      return \`
        <div class="civ-media-card" data-card-idx="\${item.idx}">
          \${mediaEl}
          <div class="civ-media-top-right">
            \${item.isVideo ? \`<button type="button" class="civ-media-icon-btn" data-action="lightbox" data-idx="\${item.idx}" title="Open Video in Lightbox" aria-label="Open video #\${escHtmlClient(item.idxStr)} in lightbox">⛶</button>\` : ""}
            \${item.prompt ? \`<button type="button" class="civ-media-icon-btn" data-action="copy-prompt" data-idx="\${item.idx}" title="Copy Generation Prompt" aria-label="Copy prompt">📋</button>\` : ""}
            \${safeCdn !== "#" ? \`<a href="\${escHtmlClient(safeCdn)}" target="_blank" rel="noopener noreferrer" class="civ-media-icon-btn" title="Open Original on Civitai CDN" aria-label="Open original">🔗</a>\` : ""}
          </div>
          <div class="civ-media-bottom-bar">
            <div class="civ-reactions-pill">
              <span style="color:#ffd43b;">⚡ #\${escHtmlClient(item.idxStr)}</span>
              <span>\${item.isVideo ? "🎬 Video" : "🖼️ Image"}</span>
            </div>
            \${hasPrompt ? \`<button type="button" class="civ-info-i-btn" data-action="toggle-prompt" data-idx="\${item.idx}" title="Show Generation Prompt" aria-label="Show generation info">i</button>\` : ""}
          </div>
          <div class="civ-prompt-overlay" id="prompt-ov-\${item.idx}">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <strong style="color:#74c0fc;">Generation Data (#\${escHtmlClient(item.idxStr)})</strong>
              <button type="button" class="civ-btn-top" style="padding:2px 8px;font-size:11px;" data-action="toggle-prompt" data-idx="\${item.idx}">✕ Close</button>
            </div>
            \${item.prompt ? \`<div><div class="civ-prompt-hdr"><span>PROMPT</span><button type="button" class="civ-copy-mini" data-action="copy-prompt" data-idx="\${item.idx}">Copy 📋</button></div><div class="civ-prompt-box">\${escHtmlClient(item.prompt)}</div></div>\` : ""}
            \${item.negativePrompt ? \`<div><div class="civ-prompt-hdr"><span>NEGATIVE PROMPT</span><button type="button" class="civ-copy-mini" data-action="copy-neg" data-idx="\${item.idx}">Copy 📋</button></div><div class="civ-prompt-box">\${escHtmlClient(item.negativePrompt)}</div></div>\` : ""}
            <div style="font-size:11.5px;color:#adb5bd;">Steps: <strong>\${escHtmlClient(item.steps || "-")}</strong> | Sampler: <strong>\${escHtmlClient(item.sampler || "-")}</strong> | CFG: <strong>\${escHtmlClient(item.cfgScale || "-")}</strong> | Seed: <strong>\${escHtmlClient(item.seed || "-")}</strong></div>
          </div>
        </div>\`;
    }
    function updateThumbHighlight(visibleSlice) {
      const visibleIds = new Set(visibleSlice.map((m) => m.idx));
      document.querySelectorAll(".civ-thumb-item").forEach((btn) => {
        const idx = Number(btn.getAttribute("data-idx"));
        btn.classList.toggle("active", visibleIds.has(idx));
      });
    }
    function renderMediaStage() {
      const stage = document.getElementById("media-stage");
      const prevBtn = document.getElementById("car-prev");
      const nextBtn = document.getElementById("car-next");
      const counter = document.getElementById("car-counter");
      const modeLink = document.getElementById("car-mode-link");
      const topBtn = document.getElementById("toggle-gallery-mode");
      const items = getFilteredItems();

      if (items.length === 0) {
        stage.className = "civ-carousel-pair single-item";
        stage.innerHTML = '<div style="grid-column:1/-1;padding:40px;text-align:center;color:#909296;background:#141517;border-radius:12px;">No matching media items.</div>';
        if (prevBtn) prevBtn.style.display = "none";
        if (nextBtn) nextBtn.style.display = "none";
        if (counter) counter.textContent = "Showing 0 matching media items";
        updateThumbHighlight([]);
        return;
      }

      if (carouselIndex >= items.length) carouselIndex = 0;
      if (isFullGridMode) {
        stage.className = "civ-carousel-pair grid-all-mode" + (IS_LANDSCAPE_DEFAULT ? " landscape-cards" : "");
        stage.innerHTML = items.map(buildMediaCardHtml).join("");
        if (prevBtn) prevBtn.style.display = "none";
        if (nextBtn) nextBtn.style.display = "none";
        if (counter) counter.textContent = \`Showing all \${items.length} media items\`;
        if (modeLink) modeLink.textContent = "Switch back to 2-Up Carousel ‹›";
        if (topBtn) topBtn.textContent = "🎠 2-Up Carousel View";
        updateThumbHighlight(items);
      } else {
        const slice = items.slice(carouselIndex, carouselIndex + 2);
        const pairLandscape = slice.some((m) => m.width && m.height && m.width > m.height * 1.15) || IS_LANDSCAPE_DEFAULT;
        stage.className = "civ-carousel-pair" + (slice.length === 1 ? " single-item" : "") + (pairLandscape ? " landscape-cards" : "");
        stage.innerHTML = slice.map(buildMediaCardHtml).join("");
        if (prevBtn) prevBtn.style.display = items.length > 2 ? "flex" : "none";
        if (nextBtn) nextBtn.style.display = items.length > 2 ? "flex" : "none";
        const endIdx = Math.min(carouselIndex + slice.length, items.length);
        if (counter) counter.textContent = \`Showing \${carouselIndex + 1}–\${endIdx} of \${items.length} example media\`;
        if (modeLink) modeLink.textContent = \`Switch to Full Grid View (\${items.length}) ⊞\`;
        if (topBtn) topBtn.textContent = \`🖼️ Show All Media (\${items.length})\`;
        updateThumbHighlight(slice);
      }
    }
    function stepCarousel(delta) {
      const items = getFilteredItems();
      if (items.length <= 2) return;
      carouselIndex += delta;
      if (carouselIndex < 0) carouselIndex = Math.max(0, items.length - (items.length % 2 === 0 ? 2 : 1));
      else if (carouselIndex >= items.length) carouselIndex = 0;
      renderMediaStage();
    }
    function renderLightboxAtPos(pos) {
      const items = getFilteredItems();
      if (items.length === 0) return;
      lightboxItemPos = ((pos % items.length) + items.length) % items.length;
      const item = items[lightboxItemPos];
      const content = document.getElementById("civ-lb-content");
      const promptEl = document.getElementById("civ-lb-prompt");
      const copyBtn = document.getElementById("lb-copy-prompt");
      const counter = document.getElementById("lb-counter");
      const firstSrc = item.localSrc || item.displaySrc || item.cdnSrc || "";
      content.innerHTML = item.isVideo
        ? \`<video src="\${escHtmlClient(firstSrc)}" controls autoplay loop playsinline data-fb-idx="0" data-media-idx="\${item.idx}"></video>\`
        : \`<img src="\${escHtmlClient(firstSrc)}" alt="Media #\${escHtmlClient(item.idxStr)}" data-fb-idx="0" data-media-idx="\${item.idx}" />\`;
      counter.textContent = \`\${lightboxItemPos + 1} / \${items.length} (#\${item.idxStr})\`;
      if (item.prompt || item.negativePrompt) {
        promptEl.style.display = "block";
        promptEl.textContent = (item.prompt ? "Prompt: " + item.prompt : "") + (item.negativePrompt ? "\\nNegative: " + item.negativePrompt : "");
        copyBtn.style.display = item.prompt ? "inline-flex" : "none";
      } else {
        promptEl.style.display = "none";
        copyBtn.style.display = "none";
      }
    }
    function openLightbox(idx) {
      const items = getFilteredItems();
      const pos = Math.max(0, items.findIndex((m) => m.idx === idx));
      renderLightboxAtPos(pos);
      const dlg = document.getElementById("civ-lightbox");
      if (!dlg.open) dlg.showModal();
    }
    function closeLightbox() {
      const dlg = document.getElementById("civ-lightbox");
      if (dlg.open) dlg.close();
    }
    document.getElementById("civ-lightbox").addEventListener("close", () => {
      const content = document.getElementById("civ-lb-content");
      content.querySelectorAll("video").forEach((v) => { try { v.pause(); } catch {} });
      content.innerHTML = "";
    });
    document.getElementById("civ-lightbox").addEventListener("click", (e) => {
      if (e.target.id === "civ-lightbox") closeLightbox();
    });
    document.getElementById("civ-search-input").addEventListener("input", (e) => {
      searchQuery = String(e.target.value || "").toLowerCase().trim();
      carouselIndex = 0;
      renderMediaStage();
    });
    document.addEventListener("click", (e) => {
      const target = e.target.closest("[data-action]");
      if (!target) return;
      const action = target.getAttribute("data-action");
      if (action === "copy-text") copyText(target.getAttribute("data-copy") || "");
      else if (action === "copy-prompt") {
        const item = MEDIA_ITEMS[Number(target.getAttribute("data-idx"))];
        if (item?.prompt) copyText(item.prompt);
      } else if (action === "copy-neg") {
        const item = MEDIA_ITEMS[Number(target.getAttribute("data-idx"))];
        if (item?.negativePrompt) copyText(item.negativePrompt);
      } else if (action === "toggle-prompt") {
        const ov = document.getElementById("prompt-ov-" + target.getAttribute("data-idx"));
        if (ov) ov.classList.toggle("open");
      } else if (action === "toggle-fit") {
        document.body.classList.toggle("fit-contain-mode");
      } else if (action === "toggle-gallery") {
        isFullGridMode = !isFullGridMode;
        renderMediaStage();
      } else if (action === "step-carousel") {
        stepCarousel(Number(target.getAttribute("data-delta") || "0"));
      } else if (action === "jump-media") {
        const rawIdx = Number(target.getAttribute("data-idx") || "0");
        const items = getFilteredItems();
        const pos = items.findIndex((m) => m.idx === rawIdx);
        if (pos >= 0) {
          isFullGridMode = false;
          carouselIndex = Math.floor(pos / 2) * 2;
          renderMediaStage();
        }
      } else if (action === "set-filter") {
        activeFilter = target.getAttribute("data-filter") || "all";
        carouselIndex = 0;
        document.querySelectorAll(".civ-subnav-btn").forEach((b) => b.classList.toggle("active", b === target));
        renderMediaStage();
      } else if (action === "toggle-acc") {
        const panelId = target.getAttribute("aria-controls");
        const panel = panelId ? document.getElementById(panelId) : null;
        if (panel) {
          const collapsed = panel.classList.toggle("collapsed");
          target.setAttribute("aria-expanded", String(!collapsed));
        }
      } else if (action === "lightbox") {
        openLightbox(Number(target.getAttribute("data-idx") || "0"));
      } else if (action === "lb-step") {
        renderLightboxAtPos(lightboxItemPos + Number(target.getAttribute("data-delta") || "0"));
      } else if (action === "lb-copy-prompt") {
        const item = getFilteredItems()[lightboxItemPos];
        if (item?.prompt) copyText(item.prompt);
      } else if (action === "lb-close") {
        closeLightbox();
      }
    });
    document.addEventListener("keydown", (e) => {
      const dlg = document.getElementById("civ-lightbox");
      if (dlg && dlg.open) {
        if (e.key === "ArrowLeft") { e.preventDefault(); renderLightboxAtPos(lightboxItemPos - 1); }
        else if (e.key === "ArrowRight") { e.preventDefault(); renderLightboxAtPos(lightboxItemPos + 1); }
        return;
      }
      if (document.activeElement && document.activeElement.tagName === "INPUT") return;
      if (e.key === "ArrowLeft" && !isFullGridMode) stepCarousel(-2);
      if (e.key === "ArrowRight" && !isFullGridMode) stepCarousel(2);
      if (e.key === "/") {
        e.preventDefault();
        document.getElementById("civ-search-input")?.focus();
      }
    });
  </script>
</body>
</html>`;
}
