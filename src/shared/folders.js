import { getFileStem, sanitizeSegment } from "./sanitize.js";

export const CIVITAI_MODEL_URL_RE = /^https:\/\/(?:www\.)?civitai\.(?:com|red|green)\/models\/\d+/i;

export function isCivitaiModelUrl(url) {
  return Boolean(url && CIVITAI_MODEL_URL_RE.test(String(url)));
}

export function getRelativeLoraFolderParts(payload, settings) {
  const baseModel = sanitizeSegment(payload?.baseModel || "Unknown_Base", 40);
  const title = sanitizeSegment(payload?.title || "Untitled_Model", 80);
  const versionName = sanitizeSegment(payload?.versionName || "v1", 35);
  const fileStem = getFileStem(payload?.fileName || `${title}_${versionName}`);

  switch (settings?.folderPreset) {
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

export function buildTargetSubfolder(payload, settings) {
  const root = sanitizeSegment(settings?.rootFolder || "civitred", 50);
  const parts = getRelativeLoraFolderParts(payload, settings);
  return `${root}/${parts.join("/")}`;
}

export function formatSizeKB(sizeKB) {
  if (!sizeKB || isNaN(sizeKB)) return "";
  const kb = Number(sizeKB);
  if (kb >= 1024 * 1024) {
    return `${(kb / (1024 * 1024)).toFixed(2)} GB`;
  }
  if (kb >= 1024) {
    return `${(kb / 1024).toFixed(2)} MB`;
  }
  return `${kb.toFixed(0)} KB`;
}

export function formatCompactNumber(num) {
  if (num === undefined || num === null || num === "-" || isNaN(Number(num))) {
    return String(num || "0");
  }
  const n = Number(num);
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString("en-US");
}

const REJECTED_CONTENT_TYPE_RE = /^(?:text\/|application\/(?:json|xml|xhtml\+xml|javascript))/i;

/**
 * Rejects text/HTML/JSON/XML error payloads served with HTTP 200 by CDNs or anti-bot pages.
 */
export function isValidMediaContentType(contentType, isVideo = false) {
  const ct = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (!ct) return true; // Missing header: verify via magic bytes
  if (REJECTED_CONTENT_TYPE_RE.test(ct)) return false;
  if (ct === "application/octet-stream" || ct === "binary/octet-stream") return true;
  if (isVideo) {
    return ct.startsWith("video/");
  }
  return ct.startsWith("image/") || ct.startsWith("video/");
}

/**
 * Inspects initial file bytes to validate binary media headers and reject HTML/JSON payloads.
 * Returns { valid: boolean, ext: string|null, reason?: string }.
 */
export function detectMediaMagicBytes(bytes) {
  if (!bytes || bytes.length < 12) {
    return { valid: false, ext: null, reason: "Response too short to be valid media" };
  }

  // Reject HTML / XML / JSON payloads masquerading as media
  let textStart = "";
  for (let i = 0; i < Math.min(32, bytes.length); i++) {
    const c = bytes[i];
    if (c >= 32 && c < 127) textStart += String.fromCharCode(c);
    else if (c === 9 || c === 10 || c === 13) textStart += " ";
  }
  const trimmedText = textStart.trimStart().toLowerCase();
  if (
    trimmedText.startsWith("<!doctype") ||
    trimmedText.startsWith("<html") ||
    trimmedText.startsWith("<head") ||
    trimmedText.startsWith("<script") ||
    trimmedText.startsWith("<?xml") ||
    trimmedText.startsWith('{"error')
  ) {
    return { valid: false, ext: null, reason: "Received HTML/JSON error payload instead of media" };
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { valid: true, ext: "jpeg" };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { valid: true, ext: "png" };
  }
  // GIF87a / GIF89a
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return { valid: true, ext: "gif" };
  }
  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { valid: true, ext: "webp" };
  }
  // WebM / Matroska: 1A 45 DF A3
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { valid: true, ext: "webm" };
  }
  // ISO BMFF (MP4 / QuickTime / AVIF): ....ftyp
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).toLowerCase();
    if (brand === "avif" || brand === "avis") return { valid: true, ext: "avif" };
    if (brand === "qt  ") return { valid: true, ext: "mov" };
    return { valid: true, ext: "mp4" };
  }

  return { valid: true, ext: null };
}

export function inferExtFromContentTypeOrUrl(contentType, url, defaultExt, isVideo, magicExt = null) {
  if (magicExt) return magicExt;
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
