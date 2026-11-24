import { buildLoraTag, escapeHtml, sanitizeHttpUrl } from "./src/shared/sanitize.js";
import { getSettings } from "./src/shared/settings.js";
import { getAllRecords } from "./src/storage/databaseRepo.js";
import { authorizeStoredDir, getStoredDirInfo, pickRootDirectory, scanRootFolderForSync } from "./src/storage/fsAccess.js";

let allRecords = [];
let currentSettings = null;
let lastDeleted = null;
let toastTimer = null;

function showToast(msg, undoRecord = null) {
  const toastEl = document.getElementById("db-toast");
  const msgEl = document.getElementById("db-toast-msg");
  const undoBtn = document.getElementById("db-undo-btn");

  msgEl.textContent = msg;
  lastDeleted = undoRecord;
  undoBtn.style.display = undoRecord ? "inline-flex" : "none";
  toastEl.classList.add("show");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("show");
    lastDeleted = null;
  }, undoRecord ? 5000 : 2200);
}

async function copyText(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast(`Copied: ${text.length > 42 ? `${text.slice(0, 42)}...` : text}`);
  } catch (e) {
    showToast("Clipboard permission unavailable");
  }
}

function renderBaseStatsStrip() {
  const strip = document.getElementById("base-stats-strip");
  const counts = new Map();
  for (const r of allRecords) {
    const b = r.baseModel || "Unknown";
    counts.set(b, (counts.get(b) || 0) + 1);
  }
  const activeBase = document.getElementById("filter-base").value;
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);

  strip.innerHTML =
    `<button type="button" class="stat-pill ${activeBase === "" ? "active" : ""}" data-base-pill="">All (${allRecords.length})</button>` +
    sorted
      .map(
        ([base, count]) =>
          `<button type="button" class="stat-pill ${activeBase === base ? "active" : ""}" data-base-pill="${escapeHtml(base)}">${escapeHtml(base)} (${count})</button>`
      )
      .join("");
}

function populateFilters() {
  const bases = Array.from(new Set(allRecords.map((r) => r.baseModel).filter(Boolean))).sort();
  const types = Array.from(new Set(allRecords.map((r) => r.modelType).filter(Boolean))).sort();

  const baseSel = document.getElementById("filter-base");
  const prevBase = baseSel.value;
  baseSel.innerHTML =
    `<option value="">All Base Models (${bases.length})</option>` +
    bases.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join("");
  if (bases.includes(prevBase)) baseSel.value = prevBase;

  const typeSel = document.getElementById("filter-type");
  const prevType = typeSel.value;
  typeSel.innerHTML =
    `<option value="">All Model Types (${types.length})</option>` +
    types.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  if (types.includes(prevType)) typeSel.value = prevType;

  renderBaseStatsStrip();
}

function getSortedFilteredRecords() {
  const query = (document.getElementById("search-input").value || "").toLowerCase().trim();
  const baseFilter = document.getElementById("filter-base").value;
  const typeFilter = document.getElementById("filter-type").value;
  const favOnly = document.getElementById("filter-fav").checked;
  const vidOnly = document.getElementById("filter-video").checked;
  const sortMode = document.getElementById("sort-select").value;

  const filtered = allRecords.filter((r) => {
    if (baseFilter && r.baseModel !== baseFilter) return false;
    if (typeFilter && r.modelType !== typeFilter) return false;
    if (favOnly && !r.favorite) return false;
    if (vidOnly && !(r.videoCount > 0)) return false;
    if (!query) return true;

    const haystack = [
      r.title,
      r.versionName,
      r.fileName,
      (r.triggerWords || []).join(" "),
      r.baseModel,
      r.modelType,
      r.training,
      r.usageTips,
      r.hashes?.AutoV2,
      r.hashes?.SHA256,
      r.air,
      r.creator,
      r.notes,
      (r.tags || []).join(" "),
      r.descriptionText
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });

  filtered.sort((a, b) => {
    if (sortMode === "title") return String(a.title || "").localeCompare(String(b.title || ""));
    if (sortMode === "media") return (b.mediaCount || 0) - (a.mediaCount || 0);
    if (sortMode === "published") return String(b.publishedAt || "").localeCompare(String(a.publishedAt || ""));
    return String(b.savedAt || "").localeCompare(String(a.savedAt || ""));
  });

  return filtered;
}

function renderGrid() {
  const filtered = getSortedFilteredRecords();
  document.getElementById("stats-line").textContent =
    `Showing ${filtered.length} of ${allRecords.length} saved model versions`;

  const grid = document.getElementById("models-grid");
  if (filtered.length === 0) {
    grid.innerHTML = `<div class="card" style="grid-column:1/-1;padding:40px;text-align:center;color:var(--muted);">No matching models found. Visit any Civitai model page and click <strong>Save Model Info &amp; Media</strong>, or scan your local folder!</div>`;
    return;
  }

  grid.innerHTML = filtered
    .map((r) => {
      const triggers = (r.triggerWords || []).join(", ");
      const loraTag = buildLoraTag(r.fileName, r.usageTips);
      const safePage = sanitizeHttpUrl(r.pageUrl, "#");
      const safePreview = sanitizeHttpUrl(r.previewUrl, "");

      const thumbHtml = safePreview
        ? `<img class="thumb" src="${escapeHtml(safePreview)}" alt="${escapeHtml(r.title)} preview" loading="lazy" />`
        : `<div class="thumb thumb-placeholder">${r.videoCount > 0 ? "🎬 Video<br/>Model" : "No<br/>Preview"}</div>`;

      return `
        <article class="model-card" data-key="${escapeHtml(r.key)}">
          <div class="card-top">
            ${thumbHtml}
            <div class="card-info">
              <div class="card-title-row">
                <h2 class="card-title">${escapeHtml(r.title)}</h2>
                <button type="button" class="fav-btn ${r.favorite ? "active" : ""}" data-action="toggle-fav" data-key="${escapeHtml(r.key)}" aria-label="Toggle favorite for ${escapeHtml(r.title)}" aria-pressed="${Boolean(r.favorite)}">${r.favorite ? "★" : "☆"}</button>
              </div>
              <div class="badges">
                <span class="badge">${escapeHtml(r.modelType)}</span>
                <span class="badge">${escapeHtml(r.baseModel)}</span>
                <span class="badge">${escapeHtml(r.versionName)}</span>
                ${r.hasWeightsOnDisk ? `<span class="badge badge-green">⚖️ Weights</span>` : ""}
              </div>
              <div class="kv">
                <strong>File:</strong>
                <button type="button" class="copy-chip" data-copy="${escapeHtml(r.fileName)}" title="Copy filename">${escapeHtml(r.fileName)} 📋</button>
              </div>
              <div class="kv">
                <strong>LoRA:</strong>
                <button type="button" class="copy-chip" style="color:var(--accent-bright);" data-copy="${escapeHtml(loraTag)}" title="Copy LoRA tag">${escapeHtml(loraTag)} 📋</button>
              </div>
              <div class="kv">
                <strong>Triggers:</strong>
                ${
                  triggers
                    ? `<button type="button" class="copy-chip" data-copy="${escapeHtml(triggers)}" title="Copy trigger words">${escapeHtml(triggers)} 📋</button>`
                    : `<span class="muted">None</span>`
                }
              </div>
              <div class="kv">
                <strong>Hash:</strong>
                ${
                  r.hashes?.AutoV2
                    ? `<button type="button" class="copy-chip" data-copy="${escapeHtml(r.hashes.AutoV2)}" title="Copy AutoV2 hash">${escapeHtml(r.hashes.AutoV2)}</button>`
                    : `<span>-</span>`
                }
                | <strong>Media:</strong> ${r.mediaCount || 0} (${r.videoCount || 0} vid)
              </div>
              ${r.notes ? `<div class="note-preview">${escapeHtml(r.notes.slice(0, 120))}</div>` : ""}
            </div>
          </div>
          <div class="card-footer">
            <span class="footer-path" title="${escapeHtml(r.localSubfolder)}">📂 ${escapeHtml(r.localSubfolder || "")}</span>
            <div class="footer-actions">
              <button type="button" class="btn" style="padding:3px 8px;font-size:11px;" data-action="open-detail" data-key="${escapeHtml(r.key)}">Details</button>
              <button type="button" class="btn btn-danger" style="padding:3px 8px;font-size:11px;" data-action="delete" data-key="${escapeHtml(r.key)}" aria-label="Remove ${escapeHtml(r.title)} from database">🗑️</button>
              ${safePage !== "#" ? `<a href="${escapeHtml(safePage)}" target="_blank" rel="noopener noreferrer">Civitai ↗</a>` : ""}
            </div>
          </div>
        </article>`;
    })
    .join("");
}

function openDetailDialog(record) {
  const dlg = document.getElementById("detail-dialog");
  const titleEl = document.getElementById("detail-dialog-title");
  const bodyEl = document.getElementById("detail-dialog-body");
  titleEl.textContent = `${record.title} (${record.versionName})`;

  const triggers = (record.triggerWords || []).join(", ") || "None";
  const loraTag = buildLoraTag(record.fileName, record.usageTips);
  const safePage = sanitizeHttpUrl(record.pageUrl, "#");

  bodyEl.innerHTML = `
    <table class="kv-table">
      <tr><th>Filename</th><td><button type="button" class="copy-chip" data-copy="${escapeHtml(record.fileName)}">${escapeHtml(record.fileName)}</button> (${escapeHtml(record.fileSizeFormatted || "N/A")})</td></tr>
      <tr><th>LoRA Tag</th><td><button type="button" class="copy-chip" data-copy="${escapeHtml(loraTag)}">${escapeHtml(loraTag)}</button></td></tr>
      <tr><th>Trigger Words</th><td>${escapeHtml(triggers)}</td></tr>
      <tr><th>Base / Type</th><td>${escapeHtml(record.baseModel)} / ${escapeHtml(record.modelType)}</td></tr>
      <tr><th>Usage Tips / Training</th><td>${escapeHtml(record.usageTips || "-")} | ${escapeHtml(record.training || "-")}</td></tr>
      <tr><th>Hashes / AIR</th><td>AutoV2: <code>${escapeHtml(record.hashes?.AutoV2 || "-")}</code> | AIR: <code>${escapeHtml(record.air || "-")}</code></td></tr>
      <tr><th>Creator &amp; Tags</th><td>${escapeHtml(record.creator || "-")} | ${escapeHtml((record.tags || []).join(", ") || "-")}</td></tr>
      <tr><th>Local Subfolder</th><td>${escapeHtml(record.localSubfolder || "-")}</td></tr>
      ${safePage !== "#" ? `<tr><th>Civitai Link</th><td><a href="${escapeHtml(safePage)}" target="_blank" rel="noopener noreferrer">${escapeHtml(safePage)}</a></td></tr>` : ""}
    </table>
    <div style="margin-bottom:12px;">
      <label class="field-label" for="detail-notes-input">Personal Notes</label>
      <textarea id="detail-notes-input" rows="3" placeholder="Add personal notes, recommended weights, checkpoint pairings...">${escapeHtml(record.notes || "")}</textarea>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
        <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="checkbox" id="detail-fav-chk" ${record.favorite ? "checked" : ""} /> ★ Mark as Favorite
        </label>
        <button type="button" class="btn btn-primary" id="detail-save-meta-btn">Save Notes</button>
      </div>
    </div>
    ${record.descriptionText ? `<div><strong style="display:block;margin-bottom:4px;">Description</strong><div style="white-space:pre-wrap;font-size:12px;color:var(--muted);max-height:180px;overflow-y:auto;background:var(--surface);padding:10px;border-radius:6px;">${escapeHtml(record.descriptionText)}</div></div>` : ""}
  `;

  bodyEl.querySelectorAll("button[data-copy]").forEach((b) => {
    b.addEventListener("click", () => copyText(b.getAttribute("data-copy") || ""));
  });

  document.getElementById("detail-save-meta-btn").addEventListener("click", async () => {
    const notes = document.getElementById("detail-notes-input").value;
    const favorite = document.getElementById("detail-fav-chk").checked;
    const res = await chrome.runtime.sendMessage({
      type: "CIS_UPDATE_DB_META",
      key: record.key,
      patch: { notes, favorite }
    });
    if (res?.ok && res.record) {
      const idx = allRecords.findIndex((x) => x.key === record.key);
      if (idx >= 0) allRecords[idx] = res.record;
      renderGrid();
      showToast("Notes saved");
      dlg.close();
    }
  });

  dlg.showModal();
}

async function handleScanFolder() {
  try {
    const info = await getStoredDirInfo(currentSettings.rootFolder);
    if (!info.configured) {
      await pickRootDirectory(currentSettings.rootFolder);
    } else if (info.permission === "none" || info.permission === "prompt") {
      const granted = await authorizeStoredDir();
      if (!granted) return;
    }

    showToast("Scanning local archive folder...");
    const scanRes = await scanRootFolderForSync(currentSettings.rootFolder);
    if (!scanRes.discovered || scanRes.discovered.length === 0) {
      showToast(`No model metadata files found in ${scanRes.displayRootPath}`);
      return;
    }

    const normalized = scanRes.discovered.map((d) => ({
      ...d.payload,
      localSubfolder: d.subfolder
    }));
    const impRes = await chrome.runtime.sendMessage({
      type: "CIS_IMPORT_DB",
      records: normalized,
      mode: "merge"
    });
    allRecords = await getAllRecords();
    populateFilters();
    renderGrid();
    showToast(`Folder sync complete: +${impRes.added} new, ${impRes.updated} updated`);
  } catch (err) {
    if (err?.name !== "AbortError") {
      showToast(`Scan failed: ${err?.message || err}`);
    }
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  currentSettings = await getSettings();
  allRecords = await getAllRecords();
  populateFilters();
  renderGrid();

  let searchTimer = null;
  document.getElementById("search-input").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderGrid, 150);
  });
  document.getElementById("sort-select").addEventListener("change", renderGrid);
  document.getElementById("filter-base").addEventListener("change", () => {
    renderBaseStatsStrip();
    renderGrid();
  });
  document.getElementById("filter-type").addEventListener("change", renderGrid);
  document.getElementById("filter-fav").addEventListener("change", renderGrid);
  document.getElementById("filter-video").addEventListener("change", renderGrid);

  document.getElementById("base-stats-strip").addEventListener("click", (e) => {
    const pill = e.target.closest("button[data-base-pill]");
    if (!pill) return;
    document.getElementById("filter-base").value = pill.getAttribute("data-base-pill") || "";
    renderBaseStatsStrip();
    renderGrid();
  });

  // Delegated grid interactions (no per-card listener overhead or scroll jumps)
  document.getElementById("models-grid").addEventListener("click", async (e) => {
    const copyBtn = e.target.closest("button[data-copy]");
    if (copyBtn) {
      await copyText(copyBtn.getAttribute("data-copy") || "");
      return;
    }

    const actionBtn = e.target.closest("button[data-action]");
    if (!actionBtn) return;
    const action = actionBtn.getAttribute("data-action");
    const key = actionBtn.getAttribute("data-key");
    const rec = allRecords.find((item) => item.key === key);
    if (!rec) return;

    if (action === "toggle-fav") {
      const nextFav = !rec.favorite;
      const res = await chrome.runtime.sendMessage({
        type: "CIS_UPDATE_DB_META",
        key,
        patch: { favorite: nextFav }
      });
      if (res?.ok && res.record) {
        const idx = allRecords.findIndex((item) => item.key === key);
        if (idx >= 0) allRecords[idx] = res.record;
        renderGrid();
      }
    } else if (action === "open-detail") {
      openDetailDialog(rec);
    } else if (action === "delete") {
      const res = await chrome.runtime.sendMessage({ type: "CIS_DELETE_DB_RECORD", key });
      if (res?.ok) {
        allRecords = allRecords.filter((item) => item.key !== key);
        const card = actionBtn.closest(".model-card");
        if (card) card.remove();
        populateFilters();
        if (allRecords.length === 0) renderGrid();
        else {
          document.getElementById("stats-line").textContent =
            `Showing ${getSortedFilteredRecords().length} of ${allRecords.length} saved model versions`;
        }
        showToast(`Removed "${rec.title}".`, { record: rec, index: res.deletedIndex || 0 });
      }
    }
  });

  document.getElementById("db-undo-btn").addEventListener("click", async () => {
    if (!lastDeleted) return;
    const { record, index } = lastDeleted;
    lastDeleted = null;
    await chrome.runtime.sendMessage({ type: "CIS_RESTORE_DB_RECORD", record, index });
    allRecords = await getAllRecords();
    populateFilters();
    renderGrid();
    showToast(`Restored "${record.title}".`);
  });

  document.getElementById("detail-close-btn").addEventListener("click", () => {
    document.getElementById("detail-dialog").close();
  });

  document.getElementById("export-csv-btn").addEventListener("click", async () => {
    const res = await chrome.runtime.sendMessage({ type: "CIS_EXPORT_FILE", exportType: "csv" });
    showToast(res?.ok ? "Exported CSV to Downloads!" : `Export failed: ${res?.error || ""}`);
  });

  document.getElementById("export-json-btn").addEventListener("click", async () => {
    const res = await chrome.runtime.sendMessage({ type: "CIS_EXPORT_FILE", exportType: "json" });
    showToast(res?.ok ? "Exported JSON backup to Downloads!" : `Export failed: ${res?.error || ""}`);
  });

  document.getElementById("export-html-btn").addEventListener("click", async () => {
    const res = await chrome.runtime.sendMessage({ type: "CIS_EXPORT_FILE", exportType: "html" });
    showToast(res?.ok ? "Exported HTML catalog to Downloads!" : `Export failed: ${res?.error || ""}`);
  });

  document.getElementById("import-json-btn").addEventListener("click", () => {
    document.getElementById("import-file-input").click();
  });

  let pendingImportRecords = null;
  const importDlg = document.getElementById("import-dialog");

  async function runImport(mode) {
    if (!pendingImportRecords) return;
    const recordsToImport = pendingImportRecords;
    pendingImportRecords = null;
    importDlg.close();
    const res = await chrome.runtime.sendMessage({ type: "CIS_IMPORT_DB", records: recordsToImport, mode });
    allRecords = await getAllRecords();
    populateFilters();
    renderGrid();
    showToast(`Imported JSON (${mode}): +${res.added} added, ${res.updated} updated`);
  }

  document.getElementById("import-merge-btn").addEventListener("click", () => runImport("merge"));
  document.getElementById("import-replace-btn").addEventListener("click", () => runImport("replace"));
  document.getElementById("import-cancel-btn").addEventListener("click", () => {
    pendingImportRecords = null;
    importDlg.close();
  });
  document.getElementById("import-close-btn").addEventListener("click", () => {
    pendingImportRecords = null;
    importDlg.close();
  });

  document.getElementById("import-file-input").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed)) throw new Error("Expected a JSON array of model records.");
      pendingImportRecords = parsed;
      document.getElementById("import-summary-text").textContent =
        `Found ${parsed.length} model record(s) in "${file.name}". Merge with existing ${allRecords.length} records or replace the database?`;
      importDlg.showModal();
    } catch (err) {
      showToast(`Import failed: ${err?.message || err}`);
    }
  });

  document.getElementById("scan-folder-btn").addEventListener("click", handleScanFolder);

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === "local" && changes.cisDatabase?.newValue) {
      allRecords = await getAllRecords();
      populateFilters();
      renderGrid();
    }
  });
});
