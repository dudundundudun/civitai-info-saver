const WINDOWS_RESERVED_NAMES_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const CONTROL_AND_UNSAFE_PATH_CHARS_RE = /[<>:"/\\|?*#%&+\x00-\x1F\x7F]/g;

/**
 * Sanitizes a single path segment for Windows/POSIX filesystems and URL-fragment safety.
 * Replaces [ with ( and ] with ), neutralizes Windows reserved device names, and trims safely.
 */
export function sanitizeSegment(str, maxLen = 90) {
  if (str === null || str === undefined || str === "") return "Unknown";
  const cleaned = String(str)
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(CONTROL_AND_UNSAFE_PATH_CHARS_RE, " - ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s-]+|[.\s-]+$/g, "");

  let result = (cleaned || "Unknown")
    .slice(0, maxLen)
    .trim()
    .replace(/[.\s-]+$/g, "");

  if (!result) result = "Unknown";

  if (WINDOWS_RESERVED_NAMES_RE.test(result)) {
    const base = result.length >= maxLen ? result.slice(0, Math.max(1, maxLen - 1)) : result;
    result = `${base}_`;
  }
  return result;
}

export function sanitizeFilenamePreservingExt(filename, maxStemLen = 85) {
  if (!filename) return "file";
  const raw = String(filename);
  const lastDot = raw.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === raw.length - 1) {
    return sanitizeSegment(raw, maxStemLen);
  }
  const stem = sanitizeSegment(raw.slice(0, lastDot), maxStemLen);
  const ext = raw
    .slice(lastDot + 1)
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()
    .slice(0, 10);
  return ext ? `${stem}.${ext}` : stem;
}

export function getFileStem(filename) {
  if (!filename) return "model";
  const raw = String(filename);
  const lastDot = raw.lastIndexOf(".");
  if (lastDot <= 0) return sanitizeSegment(raw, 80);
  return sanitizeSegment(raw.slice(0, lastDot), 80);
}

export function buildSafeMediaFilename(indexZeroBased, loraStem, ext) {
  const idxStr = String(indexZeroBased + 1).padStart(2, "0");
  const cleanStem = sanitizeSegment(loraStem || "LoRA_Model", 75);
  const cleanExt = String(ext || "jpeg").replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "jpeg";
  return sanitizeFilenamePreservingExt(`${idxStr}_${cleanStem}.${cleanExt}`, 95);
}

export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Validates that a URL uses http: or https: (optionally resolving relative /paths against baseOrigin).
 */
export function sanitizeHttpUrl(url, fallback = "#", baseOrigin = "") {
  if (!url || typeof url !== "string") return fallback;
  const cleaned = url.replace(/[\x00-\x1F\x7F]/g, "").trim();
  if (!cleaned) return fallback;

  try {
    const resolved =
      cleaned.startsWith("/") && !cleaned.startsWith("//") && baseOrigin
        ? new URL(cleaned, baseOrigin)
        : new URL(cleaned);
    if (resolved.protocol === "https:" || resolved.protocol === "http:") {
      return resolved.href;
    }
  } catch (e) {
    // Invalid URL falls through to fallback
  }
  return fallback;
}

/**
 * Safely serializes JSON for embedding inside an HTML <script> element.
 */
export function serializeJsonForScript(obj) {
  const json = JSON.stringify(obj ?? null);
  return (json === undefined ? "null" : json)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function escapeMarkdownCell(str) {
  return String(str ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

export function formatMarkdownCode(str) {
  const s = String(str ?? "");
  if (!s) return "``";
  if (s.includes("\n")) {
    let maxRun = 2;
    const matches = s.match(/`+/g);
    if (matches) {
      for (const m of matches) maxRun = Math.max(maxRun, m.length);
    }
    const fence = "`".repeat(maxRun + 1);
    return `\n${fence}text\n${s}\n${fence}`;
  }
  let maxRun = 0;
  const matches = s.match(/`+/g);
  if (matches) {
    for (const m of matches) maxRun = Math.max(maxRun, m.length);
  }
  const delim = "`".repeat(maxRun + 1);
  const pad = s.startsWith("`") || s.endsWith("`") ? " " : "";
  return `${delim}${pad}${s}${pad}${delim}`;
}

/**
 * Neutralizes CSV formula injection (=, +, -, @, tab, CR) and quotes safely.
 */
export function escapeCsvCell(val) {
  let s = String(val ?? "");
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  return `"${s.replace(/"/g, '""')}"`;
}

export function extractRecommendedWeight(usageTips) {
  const raw = String(usageTips || "");
  if (!raw) return "1";
  const explicitMatch = raw.match(/(?:strength|weight)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  if (explicitMatch) {
    const n = Number(explicitMatch[1]);
    if (Number.isFinite(n) && n > 0 && n <= 5) return explicitMatch[1];
  }
  const fallbackMatch = raw.match(/\b(0\.\d+|1(?:\.\d+)?)\b/);
  if (fallbackMatch) return fallbackMatch[1];
  return "1";
}

export function buildLoraTag(fileName, usageTips = "") {
  const rawName = String(fileName || "model").split(/[\\/]/).pop() || "model";
  const withoutExt = rawName.replace(/\.(safetensors|ckpt|pt|bin|pth|gguf|onnx|zip)$/i, "");
  const cleanStem = withoutExt.replace(/[<>:"\r\n]/g, "").trim() || "model";
  const weight = extractRecommendedWeight(usageTips);
  return `<lora:${cleanStem}:${weight}>`;
}
