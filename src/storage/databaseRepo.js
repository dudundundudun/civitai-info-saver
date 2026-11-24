import {
  buildLoraTag,
  escapeCsvCell,
  escapeHtml,
  sanitizeHttpUrl,
  serializeJsonForScript
} from "../shared/sanitize.js";

const VIDEO_EXT_RE = /\.(mp4|webm|mov)(\?|$)/i;

let dbQueue = Promise.resolve();

function enqueueDbOp(fn) {
  const next = dbQueue.then(fn);
  dbQueue = next.catch(() => {});
  return next;
}

function getStorage(storageOverride) {
  return storageOverride || globalThis.chrome?.storage?.local;
}

/**
 * Picks a safe image thumbnail URL for database cards (never a .mp4/.webm video URL).
 */
export function resolveSafePreviewUrl(mediaList = []) {
  if (!Array.isArray(mediaList) || mediaList.length === 0) return "";

  for (const item of mediaList) {
    if (!item || item.isVideo) continue;
    const candidate = item.displayUrl || item.downloadUrl || item.posterUrl || "";
    const safe = sanitizeHttpUrl(candidate, "");
    if (safe && !VIDEO_EXT_RE.test(safe)) return safe;
  }

  for (const item of mediaList) {
    if (!item) continue;
    const poster = sanitizeHttpUrl(item.posterUrl || "", "");
    if (poster && !VIDEO_EXT_RE.test(poster)) return poster;
  }
  return "";
}

export function buildCompactRecord(payload, subfolder, existingRecord = null) {
  const recordKey = `${payload.modelId || "dom"}_${payload.versionId || payload.versionName || "v1"}`;
  const mediaList = Array.isArray(payload.media) ? payload.media : [];
  const previewUrl = resolveSafePreviewUrl(mediaList);

  const files = Array.isArray(payload.files)
    ? payload.files.map((f) => ({
        name: f.name || "",
        sizeKB: f.sizeKB || 0,
        sizeFormatted: f.sizeFormatted || "",
        format: f.format || "",
        primary: Boolean(f.primary)
      }))
    : [];

  return {
    key: recordKey,
    savedAt: new Date().toISOString(),
    modelId: payload.modelId || null,
    versionId: payload.versionId || null,
    title: payload.title || "Untitled Model",
    versionName: payload.versionName || "v1.0",
    fileName: payload.fileName || "",
    rawStorageFileName: payload.rawStorageFileName || payload.fileName || "",
    fileSizeFormatted: payload.fileSizeFormatted || "",
    fileFormat: payload.fileFormat || "SafeTensor",
    files,
    triggerWords: Array.isArray(payload.triggerWords) ? payload.triggerWords : [],
    modelType: payload.modelType || "LORA",
    baseModel: payload.baseModel || "Unknown",
    training: payload.training || "",
    usageTips: payload.usageTips || "",
    hashes: payload.hashes || {},
    air: payload.air || "",
    publishedAt: payload.publishedAt || "",
    stats: payload.stats || {},
    reviews: payload.reviews || "",
    creator: payload.creator || "",
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    pageUrl: sanitizeHttpUrl(payload.pageUrl || "", ""),
    descriptionText: String(payload.descriptionText || "").slice(0, 8000),
    versionDescriptionText: String(payload.versionDescriptionText || "").slice(0, 4000),
    detailsTableExtras: payload.detailsTableExtras || {},
    mediaCount: mediaList.length,
    videoCount: mediaList.filter((m) => m.isVideo).length,
    previewUrl,
    localSubfolder: subfolder || existingRecord?.localSubfolder || "",
    hasWeightsOnDisk: Boolean(payload.hasWeightsOnDisk ?? existingRecord?.hasWeightsOnDisk),
    favorite: Boolean(existingRecord?.favorite),
    notes: typeof existingRecord?.notes === "string" ? existingRecord.notes : "",
    userTags: Array.isArray(existingRecord?.userTags) ? existingRecord.userTags : []
  };
}

function normalizeLegacyRecord(record) {
  if (!record || typeof record !== "object") return record;
  let previewUrl = sanitizeHttpUrl(record.previewUrl || "", "");
  if (previewUrl && VIDEO_EXT_RE.test(previewUrl)) {
    previewUrl = "";
  }
  return {
    ...record,
    previewUrl,
    pageUrl: sanitizeHttpUrl(record.pageUrl || "", ""),
    favorite: Boolean(record.favorite),
    notes: typeof record.notes === "string" ? record.notes : "",
    userTags: Array.isArray(record.userTags) ? record.userTags : [],
    hasWeightsOnDisk: Boolean(record.hasWeightsOnDisk)
  };
}

export async function getAllRecords(storageOverride = null) {
  const storage = getStorage(storageOverride);
  if (!storage) return [];
  const stored = await storage.get(["cisDatabase"]);
  const db = Array.isArray(stored?.cisDatabase) ? stored.cisDatabase : [];
  return db.map(normalizeLegacyRecord);
}

export function upsertRecord(payload, subfolder, storageOverride = null) {
  return enqueueDbOp(async () => {
    const storage = getStorage(storageOverride);
    const stored = await storage.get(["cisDatabase"]);
    const db = Array.isArray(stored?.cisDatabase) ? [...stored.cisDatabase] : [];

    const recordKey = `${payload.modelId || "dom"}_${payload.versionId || payload.versionName || "v1"}`;
    const existingIdx = db.findIndex((item) => item.key === recordKey);
    const existing = existingIdx >= 0 ? db[existingIdx] : null;
    const compact = buildCompactRecord(payload, subfolder, existing);

    if (existingIdx >= 0) {
      db[existingIdx] = compact;
    } else {
      db.unshift(compact);
    }

    await storage.set({ cisDatabase: db });
    return { record: compact, totalInDb: db.length };
  });
}

export function deleteRecord(key, storageOverride = null) {
  return enqueueDbOp(async () => {
    const storage = getStorage(storageOverride);
    const stored = await storage.get(["cisDatabase"]);
    const db = Array.isArray(stored?.cisDatabase) ? [...stored.cisDatabase] : [];
    const idx = db.findIndex((item) => item.key === key);
    const deletedRecord = idx >= 0 ? db[idx] : null;
    const nextDb = idx >= 0 ? db.filter((item) => item.key !== key) : db;

    await storage.set({ cisDatabase: nextDb });
    return { deletedRecord, deletedIndex: idx, totalInDb: nextDb.length };
  });
}

export function restoreRecord(record, index = 0, storageOverride = null) {
  return enqueueDbOp(async () => {
    if (!record || !record.key) return { ok: false, totalInDb: 0 };
    const storage = getStorage(storageOverride);
    const stored = await storage.get(["cisDatabase"]);
    const db = Array.isArray(stored?.cisDatabase) ? [...stored.cisDatabase] : [];
    if (!db.some((item) => item.key === record.key)) {
      const insertAt = Math.max(0, Math.min(index, db.length));
      db.splice(insertAt, 0, normalizeLegacyRecord(record));
      await storage.set({ cisDatabase: db });
    }
    return { ok: true, totalInDb: db.length };
  });
}

export function updateRecordMeta(key, patch, storageOverride = null) {
  return enqueueDbOp(async () => {
    const storage = getStorage(storageOverride);
    const stored = await storage.get(["cisDatabase"]);
    const db = Array.isArray(stored?.cisDatabase) ? [...stored.cisDatabase] : [];
    const idx = db.findIndex((item) => item.key === key);
    if (idx < 0) return { ok: false, record: null };

    const cur = db[idx];
    const updated = {
      ...cur,
      ...(typeof patch.notes === "string" ? { notes: patch.notes.slice(0, 4000) } : {}),
      ...(typeof patch.favorite === "boolean" ? { favorite: patch.favorite } : {}),
      ...(typeof patch.hasWeightsOnDisk === "boolean" ? { hasWeightsOnDisk: patch.hasWeightsOnDisk } : {}),
      ...(Array.isArray(patch.userTags) ? { userTags: patch.userTags.map(String).filter(Boolean).slice(0, 30) } : {})
    };
    db[idx] = updated;
    await storage.set({ cisDatabase: db });
    return { ok: true, record: normalizeLegacyRecord(updated) };
  });
}

export function importRecords(records, mode = "merge", storageOverride = null) {
  return enqueueDbOp(async () => {
    if (!Array.isArray(records)) {
      throw new Error("Invalid backup format: expected a JSON array of model records.");
    }
    const valid = records
      .filter((r) => r && typeof r === "object" && (r.title || r.key || r.modelId))
      .map((r) => {
        const key = r.key || `${r.modelId || "import"}_${r.versionId || r.versionName || "v1"}`;
        return normalizeLegacyRecord({ ...r, key });
      });

    const storage = getStorage(storageOverride);
    if (mode === "replace") {
      await storage.set({ cisDatabase: valid });
      return { added: valid.length, updated: 0, totalInDb: valid.length };
    }

    const stored = await storage.get(["cisDatabase"]);
    const db = Array.isArray(stored?.cisDatabase) ? [...stored.cisDatabase] : [];
    const byKey = new Map(db.map((item, i) => [item.key, i]));

    let added = 0;
    let updated = 0;
    for (const incoming of valid) {
      const existingIdx = byKey.get(incoming.key);
      if (existingIdx !== undefined) {
        const prev = db[existingIdx];
        db[existingIdx] = {
          ...prev,
          ...incoming,
          notes: prev.notes || incoming.notes || "",
          favorite: Boolean(prev.favorite || incoming.favorite),
          hasWeightsOnDisk: Boolean(prev.hasWeightsOnDisk || incoming.hasWeightsOnDisk)
        };
        updated++;
      } else {
        db.push(incoming);
        byKey.set(incoming.key, db.length - 1);
        added++;
      }
    }

    await storage.set({ cisDatabase: db });
    return { added, updated, totalInDb: db.length };
  });
}

export function buildCsvExport(records) {
  const headers = [
    "Title",
    "Version",
    "Filename",
    "LoRA Tag",
    "Trigger Words",
    "Model Type",
    "Base Model",
    "Usage Tips",
    "Training",
    "AutoV2 Hash",
    "AIR",
    "Published",
    "Favorite",
    "Weights On Disk",
    "Notes",
    "Local Subfolder",
    "Civitai URL"
  ];
  const rows = (records || []).map((r) => [
    r.title,
    r.versionName,
    r.fileName,
    buildLoraTag(r.fileName, r.usageTips),
    (r.triggerWords || []).join(", "),
    r.modelType,
    r.baseModel,
    r.usageTips,
    r.training,
    r.hashes?.AutoV2 || "",
    r.air || "",
    r.publishedAt || "",
    r.favorite ? "Yes" : "No",
    r.hasWeightsOnDisk ? "Yes" : "No",
    r.notes || "",
    r.localSubfolder || "",
    sanitizeHttpUrl(r.pageUrl || "", "")
  ]);

  const csvBody = [headers, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\r\n");

  return `\uFEFF${csvBody}`;
}

export function buildStandaloneCatalogHtml(records) {
  const cleanRecords = (records || []).map((r) => ({
    key: r.key,
    title: r.title || "",
    versionName: r.versionName || "",
    fileName: r.fileName || "",
    loraTag: buildLoraTag(r.fileName, r.usageTips),
    triggerWords: Array.isArray(r.triggerWords) ? r.triggerWords : [],
    baseModel: r.baseModel || "",
    modelType: r.modelType || "",
    usageTips: r.usageTips || "",
    training: r.training || "",
    autov2: r.hashes?.AutoV2 || "",
    air: r.air || "",
    tags: Array.isArray(r.tags) ? r.tags : [],
    creator: r.creator || "",
    notes: r.notes || "",
    favorite: Boolean(r.favorite),
    pageUrl: sanitizeHttpUrl(r.pageUrl || "", "#")
  }));

  const embeddedJson = serializeJsonForScript(cleanRecords);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Civitai Saved Models Master Catalog</title>
  <style>
    * { box-sizing: border-box; }
    body { background: #101113; color: #e9ecef; font-family: system-ui, -apple-system, sans-serif; padding: 24px; margin: 0; }
    h1 { margin: 0 0 14px; font-size: 22px; color: #74c0fc; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
    input, select { padding: 9px 12px; background: #1a1b1e; color: #fff; border: 1px solid #373a40; border-radius: 6px; font-size: 13px; }
    input { flex: 1; min-width: 240px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border: 1px solid #2c2e33; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #1a1b1e; color: #74c0fc; position: sticky; top: 0; }
    .copy-btn { background: #141517; color: #63e6be; border: 1px solid #2c2e33; padding: 3px 7px; border-radius: 4px; font-family: monospace; font-size: 12px; cursor: pointer; text-align: left; }
    .copy-btn:hover { border-color: #339af0; }
    .copy-btn:focus-visible, input:focus-visible, select:focus-visible, a:focus-visible { outline: 2px solid #74c0fc; outline-offset: 2px; }
    a { color: #4dabf7; font-weight: 600; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .muted { color: #909296; font-size: 12px; }
    #toast { position: fixed; bottom: 20px; right: 20px; background: #0ca678; color: #fff; padding: 8px 14px; border-radius: 6px; font-weight: 600; opacity: 0; pointer-events: none; transition: opacity .2s; }
    #toast.show { opacity: 1; }
  </style>
</head>
<body>
  <h1>Civitai Saved Models Master Catalog (${cleanRecords.length})</h1>
  <div class="toolbar">
    <input type="search" id="q" aria-label="Filter models" placeholder="Filter by title, filename, trigger words, base model, hash, notes..." />
    <select id="base-filter" aria-label="Filter by base model"><option value="">All Base Models</option></select>
    <select id="type-filter" aria-label="Filter by model type"><option value="">All Model Types</option></select>
  </div>
  <table>
    <thead>
      <tr>
        <th>Title &amp; Version</th>
        <th>Base / Type</th>
        <th>Filename &amp; LoRA Tag</th>
        <th>Trigger Words</th>
        <th>Tips / Hash / Notes</th>
        <th>Link</th>
      </tr>
    </thead>
    <tbody id="tb"></tbody>
  </table>
  <div id="toast" role="status" aria-live="polite"></div>
  <script>
    const DATA = ${embeddedJson};
    function esc(s) {
      return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    function safeUrl(u) {
      return /^https?:\\/\\//i.test(String(u || "")) ? u : "#";
    }
    function toast(msg) {
      const el = document.getElementById("toast");
      el.textContent = msg;
      el.classList.add("show");
      clearTimeout(window.__t);
      window.__t = setTimeout(() => el.classList.remove("show"), 1600);
    }
    async function copyVal(val) {
      try {
        await navigator.clipboard.writeText(val);
        toast("Copied!");
      } catch {
        const ta = document.createElement("textarea");
        ta.value = val;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        toast("Copied!");
      }
    }
    function populateSelects() {
      const bases = Array.from(new Set(DATA.map(r => r.baseModel).filter(Boolean))).sort();
      const types = Array.from(new Set(DATA.map(r => r.modelType).filter(Boolean))).sort();
      const bSel = document.getElementById("base-filter");
      const tSel = document.getElementById("type-filter");
      bases.forEach(b => {
        const o = document.createElement("option");
        o.value = b; o.textContent = b; bSel.appendChild(o);
      });
      types.forEach(t => {
        const o = document.createElement("option");
        o.value = t; o.textContent = t; tSel.appendChild(o);
      });
    }
    function render() {
      const q = document.getElementById("q").value.toLowerCase().trim();
      const bf = document.getElementById("base-filter").value;
      const tf = document.getElementById("type-filter").value;
      const rows = DATA.filter(r => {
        if (bf && r.baseModel !== bf) return false;
        if (tf && r.modelType !== tf) return false;
        if (!q) return true;
        const hay = [r.title, r.versionName, r.fileName, r.triggerWords.join(" "), r.baseModel, r.modelType, r.training, r.usageTips, r.autov2, r.air, r.tags.join(" "), r.creator, r.notes].join(" ").toLowerCase();
        return hay.includes(q);
      });
      document.getElementById("tb").innerHTML = rows.map(r => {
        const triggers = r.triggerWords.join(", ");
        const href = safeUrl(r.pageUrl);
        return \`<tr>
          <td><strong>\${r.favorite ? "★ " : ""}\${esc(r.title)}</strong><br><span class="muted">\${esc(r.versionName)}</span></td>
          <td>\${esc(r.baseModel)}<br><span class="muted">\${esc(r.modelType)}</span></td>
          <td>
            <button type="button" class="copy-btn" data-copy="\${esc(r.fileName)}">\${esc(r.fileName)}</button><br>
            <button type="button" class="copy-btn" style="margin-top:4px;color:#74c0fc;" data-copy="\${esc(r.loraTag)}">\${esc(r.loraTag)}</button>
          </td>
          <td>\${triggers ? \`<button type="button" class="copy-btn" data-copy="\${esc(triggers)}">\${esc(triggers)}</button>\` : '<span class="muted">None</span>'}</td>
          <td>\${esc(r.usageTips || "-")}<br><span class="muted">\${esc(r.autov2 || "")}</span>\${r.notes ? \`<div class="muted" style="margin-top:4px;color:#ffd43b;">\${esc(r.notes)}</div>\` : ""}</td>
          <td>\${href !== "#" ? \`<a href="\${esc(href)}" target="_blank" rel="noopener noreferrer">Open ↗</a>\` : "-"}</td>
        </tr>\`;
      }).join("");
    }
    document.getElementById("q").addEventListener("input", render);
    document.getElementById("base-filter").addEventListener("change", render);
    document.getElementById("type-filter").addEventListener("change", render);
    document.getElementById("tb").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-copy]");
      if (btn) copyVal(btn.getAttribute("data-copy") || "");
    });
    populateSelects();
    render();
  </script>
</body>
</html>`;
}
