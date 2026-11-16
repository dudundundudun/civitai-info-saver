let allRecords = [];
let currentRootFolder = "civitred";

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderGrid() {
  const query = (document.getElementById("search-input").value || "").toLowerCase().trim();
  const baseFilter = document.getElementById("filter-base").value;
  const typeFilter = document.getElementById("filter-type").value;

  const filtered = allRecords.filter((r) => {
    if (baseFilter && r.baseModel !== baseFilter) return false;
    if (typeFilter && r.modelType !== typeFilter) return false;
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
      (r.tags || []).join(" "),
      r.descriptionText
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });

  document.getElementById("stats-line").textContent =
    `Showing ${filtered.length} of ${allRecords.length} saved model versions`;

  const grid = document.getElementById("models-grid");
  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:40px;text-align:center;color:#909296;background:#1a1b1e;border-radius:10px;">No matching models found. Visit any Civitai model page and click <strong>Save Model Info & Media</strong>!</div>`;
    return;
  }

  grid.innerHTML = filtered
    .map((r) => {
      const triggers = (r.triggerWords || []).join(", ") || "None";
      const thumbHtml = r.previewUrl
        ? `<img class="thumb" src="${escapeHtml(r.previewUrl)}" alt="Preview" loading="lazy" />`
        : `<div class="thumb" style="display:flex;align-items:center;justify-content:center;color:#495057;font-size:11px;">No Preview</div>`;

      return `
        <div class="model-card">
          <div class="card-top">
            ${thumbHtml}
            <div class="card-info">
              <h3 class="card-title">${escapeHtml(r.title)}</h3>
              <div class="badges">
                <span class="badge">${escapeHtml(r.modelType)}</span>
                <span class="badge">${escapeHtml(r.baseModel)}</span>
                <span class="badge">${escapeHtml(r.versionName)}</span>
              </div>
              <div class="kv"><strong>File:</strong> <code title="Click to copy filename" data-copy="${escapeHtml(r.fileName)}">${escapeHtml(r.fileName)} 📋</code></div>
              <div class="kv"><strong>Triggers:</strong> <code title="Click to copy trigger words" data-copy="${escapeHtml(triggers)}">${escapeHtml(triggers)} 📋</code></div>
              <div class="kv"><strong>Tips / Steps:</strong> ${escapeHtml(r.usageTips || "-")} | ${escapeHtml(r.training || "-")}</div>
              <div class="kv"><strong>Hash:</strong> ${escapeHtml(r.hashes?.AutoV2 || "-")} | <strong>Media:</strong> ${r.mediaCount || 0} (${r.videoCount || 0} vid)</div>
            </div>
          </div>
          <div class="card-footer">
            <span style="color:#909296;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(r.localSubfolder)}">📂 ${escapeHtml(r.localSubfolder || "")}</span>
            <div style="display:flex;align-items:center;gap:8px;">
              <button type="button" class="btn-danger-mini" data-del-key="${escapeHtml(r.key)}" title="Remove from database">🗑️</button>
              <a href="${escapeHtml(r.pageUrl)}" target="_blank" rel="noopener">Civitai Page ↗</a>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  grid.querySelectorAll("code[data-copy]").forEach((el) => {
    el.addEventListener("click", () => {
      navigator.clipboard.writeText(el.getAttribute("data-copy") || "");
      const orig = el.textContent;
      el.textContent = "✅ Copied!";
      setTimeout(() => {
        el.textContent = orig;
      }, 1200);
    });
  });

  grid.querySelectorAll("button[data-del-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-del-key");
      if (!key) return;
      chrome.runtime.sendMessage({ type: "CIS_DELETE_DB_RECORD", key }, (res) => {
        if (res && res.ok) {
          allRecords = allRecords.filter((item) => item.key !== key);
          populateFilters();
          renderGrid();
        }
      });
    });
  });
}

function populateFilters() {
  const bases = Array.from(new Set(allRecords.map((r) => r.baseModel).filter(Boolean))).sort();
  const types = Array.from(new Set(allRecords.map((r) => r.modelType).filter(Boolean))).sort();

  const baseSel = document.getElementById("filter-base");
  const prevBase = baseSel.value;
  baseSel.innerHTML = `<option value="">All Base Models (${bases.length})</option>` +
    bases.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join("");
  if (bases.includes(prevBase)) baseSel.value = prevBase;

  const typeSel = document.getElementById("filter-type");
  const prevType = typeSel.value;
  typeSel.innerHTML = `<option value="">All Model Types (${types.length})</option>` +
    types.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  if (types.includes(prevType)) typeSel.value = prevType;
}

function exportCsv() {
  const headers = [
    "Title",
    "Version",
    "Filename",
    "Trigger Words",
    "Model Type",
    "Base Model",
    "Usage Tips",
    "Training",
    "AutoV2 Hash",
    "AIR",
    "Published",
    "Local Subfolder",
    "Civitai URL"
  ];
  const rows = allRecords.map((r) => [
    r.title,
    r.versionName,
    r.fileName,
    (r.triggerWords || []).join(", "),
    r.modelType,
    r.baseModel,
    r.usageTips,
    r.training,
    r.hashes?.AutoV2 || "",
    r.air || "",
    r.publishedAt || "",
    r.localSubfolder || "",
    r.pageUrl || ""
  ]);

  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell || "").replace(/"/g, '""')}"`).join(","))
    .join("\n");

  chrome.runtime.sendMessage({
    type: "CIS_EXPORT_FILE",
    content: csvContent,
    mimeType: "text/csv;charset=utf-8",
    filename: `${currentRootFolder}/Civitai_Master_Database.csv`
  });
}

function exportJson() {
  chrome.runtime.sendMessage({
    type: "CIS_EXPORT_FILE",
    content: JSON.stringify(allRecords, null, 2),
    mimeType: "application/json;charset=utf-8",
    filename: `${currentRootFolder}/Civitai_Master_Database.json`
  });
}

function exportStandaloneHtml() {
  const embeddedJson = JSON.stringify(allRecords).replace(/<\/script>/gi, "<\\/script>");
  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Civitai Master Catalog</title>
<style>body{background:#101113;color:#e9ecef;font-family:sans-serif;padding:24px}input{width:100%;padding:10px;background:#1a1b1e;color:#fff;border:1px solid #373a40;border-radius:6px;margin-bottom:16px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #2c2e33;padding:8px;text-align:left}th{background:#1a1b1e;color:#74c0fc}code{color:#63e6be;background:#141517;padding:2px 5px;border-radius:4px}</style>
</head><body>
<h1>🗂️ Civitai Saved Models Master Catalog (${allRecords.length} Models)</h1>
<input type="search" id="q" placeholder="Filter by title, filename, trigger words, base model, hash..." oninput="filter()" />
<table><thead><tr><th>Title & Version</th><th>Base / Type</th><th>Full Filename</th><th>Trigger Words</th><th>Tips / Hash</th><th>Link</th></tr></thead><tbody id="tb"></tbody></table>
<script>
const data = ${embeddedJson};
function esc(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function filter(){
  const q = document.getElementById('q').value.toLowerCase();
  const rows = data.filter(r => JSON.stringify(r).toLowerCase().includes(q));
  document.getElementById('tb').innerHTML = rows.map(r => \`<tr>
    <td><strong>\${esc(r.title)}</strong><br><small>\${esc(r.versionName)}</small></td>
    <td>\${esc(r.baseModel)}<br><small>\${esc(r.modelType)}</small></td>
    <td><code>\${esc(r.fileName)}</code></td>
    <td><code>\${esc((r.triggerWords||[]).join(', '))}</code></td>
    <td>\${esc(r.usageTips)}<br><small>\${esc((r.hashes&&r.hashes.AutoV2)||'')}</small></td>
    <td><a href="\${esc(r.pageUrl||'#')}" target="_blank" rel="noopener" style="color:#339af0">Open ↗</a></td>
  </tr>\`).join('');
}
filter();
</script></body></html>`;

  chrome.runtime.sendMessage({
    type: "CIS_EXPORT_FILE",
    content: html,
    mimeType: "text/html;charset=utf-8",
    filename: `${currentRootFolder}/Civitai_Master_Catalog.html`
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const stored = await chrome.storage.local.get(["cisDatabase", "cisSettings"]);
  allRecords = Array.isArray(stored.cisDatabase) ? stored.cisDatabase : [];
  if (stored.cisSettings && stored.cisSettings.rootFolder) {
    currentRootFolder = stored.cisSettings.rootFolder;
  }
  populateFilters();
  renderGrid();

  let searchTimer = null;
  document.getElementById("search-input").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderGrid, 150);
  });
  document.getElementById("filter-base").addEventListener("change", renderGrid);
  document.getElementById("filter-type").addEventListener("change", renderGrid);
  document.getElementById("export-csv-btn").addEventListener("click", exportCsv);
  document.getElementById("export-json-btn").addEventListener("click", exportJson);
  document.getElementById("export-html-btn").addEventListener("click", exportStandaloneHtml);
});
