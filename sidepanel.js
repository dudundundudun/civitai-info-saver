import { isCivitaiModelUrl } from "./src/shared/folders.js";
import { resolveLang, t } from "./src/shared/i18n.js";
import { buildLoraTag, escapeHtml } from "./src/shared/sanitize.js";
import { getSettings, updateSettings } from "./src/shared/settings.js";
import { getAllRecords } from "./src/storage/databaseRepo.js";
import { authorizeStoredDir, getStoredDirInfo, pickRootDirectory } from "./src/storage/fsAccess.js";

let currentLang = "en";
let currentSettings = null;
let allRecords = [];
let activeTab = null;
let activeJobId = null;
let currentLoraTag = "";

function showToast(msg) {
  const el = document.getElementById("sp-toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(window.__spToast);
  window.__spToast = setTimeout(() => el.classList.remove("show"), 1800);
}

async function refreshFolderCard() {
  const info = await getStoredDirInfo(currentSettings.rootFolder);
  const badge = document.getElementById("sp-perm-badge");
  const pathEl = document.getElementById("sp-folder-path");
  const authBtn = document.getElementById("sp-auth-folder");

  if (!info.configured) {
    badge.className = "badge badge-amber";
    badge.textContent = "Not set";
    pathEl.textContent = t(currentLang, "folderNotSelected");
    authBtn.style.display = "none";
  } else if (info.permission === "readwrite") {
    badge.className = "badge badge-green";
    badge.textContent = "Ready (RW)";
    pathEl.textContent = t(currentLang, "folderReady", { path: info.displayRootPath });
    authBtn.style.display = "none";
  } else {
    badge.className = "badge badge-amber";
    badge.textContent = "Needs Access";
    pathEl.textContent = t(currentLang, "folderNeedsPerm", { path: info.displayRootPath });
    authBtn.style.display = "inline-flex";
  }
}

async function refreshActiveTabModel() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab || null;
  const infoEl = document.getElementById("sp-active-model");
  const actionsEl = document.getElementById("sp-active-actions");

  if (!tab?.id || !isCivitaiModelUrl(tab.url)) {
    infoEl.textContent = t(currentLang, "notOnModelPage");
    actionsEl.style.display = "none";
    currentLoraTag = "";
    return;
  }

  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "CIS_GET_ACTIVE_MODEL" });
    if (!res?.ok) {
      infoEl.textContent = tab.title || tab.url;
      actionsEl.style.display = "flex";
      return;
    }
    const m = res.meta || {};
    currentLoraTag = buildLoraTag(m.fileName, m.usageTips);
    infoEl.innerHTML = `<strong style="color:#fff;">${escapeHtml(m.title || "Model")}</strong> <span class="badge">${escapeHtml(m.versionName || "v1")}</span> <span class="badge">${escapeHtml(m.baseModel || "")}</span>`;
    actionsEl.style.display = "flex";
  } catch (e) {
    infoEl.textContent = tab.title || "Reload Civitai tab (F5)";
    actionsEl.style.display = "flex";
  }
}

function renderMiniDb() {
  const q = (document.getElementById("sp-db-search").value || "").toLowerCase().trim();
  const filtered = allRecords
    .filter((r) => {
      if (!q) return true;
      return [r.title, r.versionName, r.fileName, r.baseModel, (r.triggerWords || []).join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(q);
    })
    .slice(0, 30);

  const list = document.getElementById("sp-db-list");
  if (filtered.length === 0) {
    list.innerHTML = `<div class="muted" style="padding:10px;text-align:center;">No saved models match.</div>`;
    return;
  }

  list.innerHTML = filtered
    .map((r) => {
      const loraTag = buildLoraTag(r.fileName, r.usageTips);
      const triggers = (r.triggerWords || []).join(", ");
      return `
        <div class="db-mini-item">
          <div class="db-mini-title">${r.favorite ? "★ " : ""}${escapeHtml(r.title)}</div>
          <div class="muted">${escapeHtml(r.baseModel)} • ${escapeHtml(r.versionName)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:2px;">
            <button type="button" class="chip-btn" data-copy="${escapeHtml(loraTag)}">${escapeHtml(loraTag)}</button>
            ${triggers ? `<button type="button" class="chip-btn" data-copy="${escapeHtml(triggers)}" style="color:#74c0fc;">Triggers</button>` : ""}
          </div>
        </div>`;
    })
    .join("");
}

function syncSettingsControls() {
  const keys = [
    "saveHtml", "saveMd", "saveTxt", "saveJson", "saveCivitaiInfo",
    "obsidianFrontmatter", "saveMedia", "includeVideos", "skipExistingMedia", "saveWebuiPreview"
  ];
  for (const k of keys) {
    const el = document.getElementById(`sp-${k}`);
    if (el) el.checked = Boolean(currentSettings[k]);
  }
  document.getElementById("sp-saveMode").value = currentSettings.saveMode;
  document.getElementById("sp-rootFolder").value = currentSettings.rootFolder;
  document.getElementById("sp-folderPreset").value = currentSettings.folderPreset;
}

async function initPickMode(params) {
  document.getElementById("main-sp-view").style.display = "none";
  document.getElementById("pick-mode-view").style.display = "block";

  document.getElementById("pick-title").textContent = t(currentLang, "pickTitle");
  document.getElementById("pick-desc").textContent = t(currentLang, "pickDesc");
  document.getElementById("pick-select-btn").textContent = t(currentLang, "pickBtn");
  document.getElementById("pick-authorize-btn").textContent = t(currentLang, "authorizeFolder");
  document.getElementById("pick-cancel-btn").textContent = t(currentLang, "pickCancel");

  const info = await getStoredDirInfo(currentSettings.rootFolder);
  const pathBadge = document.getElementById("pick-current-path");
  const authBtn = document.getElementById("pick-authorize-btn");
  const statusEl = document.getElementById("pick-status");

  if (info.configured) {
    pathBadge.textContent = info.displayRootPath;
    if (info.permission !== "readwrite") {
      authBtn.style.display = "inline-flex";
    }
  } else {
    pathBadge.textContent = currentSettings.rootFolder || "civitred";
  }

  const targetTabId = params.get("tabId") ? Number(params.get("tabId")) : null;
  const autoResume = params.get("autoResume") === "1";

  const finishAuth = async () => {
    statusEl.textContent = t(currentLang, "pickDone");
    await chrome.runtime.sendMessage({
      type: "CIS_NOTIFY_FS_UPDATED",
      tabId: targetTabId,
      autoResume
    });
    setTimeout(() => window.close(), 350);
  };

  authBtn.addEventListener("click", async () => {
    try {
      const ok = await authorizeStoredDir();
      if (ok) await finishAuth();
      else statusEl.textContent = "Permission was not granted.";
    } catch (err) {
      statusEl.textContent = err?.message || String(err);
    }
  });

  document.getElementById("pick-select-btn").addEventListener("click", async () => {
    try {
      await pickRootDirectory(currentSettings.rootFolder);
      await finishAuth();
    } catch (err) {
      if (err?.name === "AbortError") return;
      statusEl.textContent = err?.message || String(err);
    }
  });

  document.getElementById("pick-cancel-btn").addEventListener("click", () => window.close());
}

document.addEventListener("DOMContentLoaded", async () => {
  currentSettings = await getSettings();
  currentLang = resolveLang(currentSettings.language);

  const params = new URLSearchParams(location.search);
  if (params.get("mode") === "pick") {
    await initPickMode(params);
    return;
  }

  allRecords = await getAllRecords();
  document.getElementById("sp-db-badge").textContent = t(currentLang, "savedCount", { count: allRecords.length });
  syncSettingsControls();
  await Promise.all([refreshFolderCard(), refreshActiveTabModel()]);
  renderMiniDb();

  document.getElementById("sp-open-db").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("database.html") });
  });

  document.getElementById("sp-pick-folder").addEventListener("click", async () => {
    try {
      await pickRootDirectory(currentSettings.rootFolder);
      await refreshFolderCard();
      await chrome.runtime.sendMessage({ type: "CIS_NOTIFY_FS_UPDATED" });
      showToast(t(currentLang, "pickDone"));
    } catch (err) {
      if (err?.name !== "AbortError") showToast(err?.message || "Folder pick failed");
    }
  });

  document.getElementById("sp-auth-folder").addEventListener("click", async () => {
    try {
      const ok = await authorizeStoredDir();
      await refreshFolderCard();
      if (ok) await chrome.runtime.sendMessage({ type: "CIS_NOTIFY_FS_UPDATED" });
    } catch (err) {
      showToast(err?.message || "Authorization failed");
    }
  });

  document.getElementById("sp-copy-lora").addEventListener("click", async () => {
    if (!currentLoraTag) return;
    await navigator.clipboard.writeText(currentLoraTag);
    showToast(t(currentLang, "copiedToast"));
  });

  document.getElementById("sp-save-btn").addEventListener("click", async () => {
    if (!activeTab?.id) return;
    activeJobId = crypto.randomUUID();
    const cancelBtn = document.getElementById("sp-cancel-btn");
    const progWrap = document.getElementById("sp-progress-wrap");
    const statusEl = document.getElementById("sp-save-status");
    cancelBtn.style.display = "inline-flex";
    progWrap.style.display = "block";
    statusEl.textContent = t(currentLang, "savingExtract");

    try {
      const res = await chrome.tabs.sendMessage(activeTab.id, {
        type: "CIS_TRIGGER_SAVE_FROM_POPUP",
        jobId: activeJobId
      });
      if (res?.ok) {
        statusEl.textContent = t(currentLang, "savingDone", {
          files: res.result.filesSaved,
          media: res.result.mediaSaved,
          skipped: res.result.skippedMedia ? ` (+${res.result.skippedMedia})` : "",
          path: res.result.subfolder,
          total: res.result.totalInDb
        });
      } else if (res?.cancelled) {
        statusEl.textContent = t(currentLang, "savingCancelled", { done: 0, total: "?" });
      } else if (res?.code !== "PICKER_OPENED") {
        statusEl.textContent = t(currentLang, "savingError", { error: res?.error || "Failed" });
      }
    } catch (err) {
      statusEl.textContent = t(currentLang, "savingError", { error: err?.message || String(err) });
    } finally {
      cancelBtn.style.display = "none";
      progWrap.style.display = "none";
      activeJobId = null;
    }
  });

  document.getElementById("sp-cancel-btn").addEventListener("click", () => {
    if (activeJobId) chrome.runtime.sendMessage({ type: "CIS_CANCEL_SAVE", jobId: activeJobId });
  });

  document.getElementById("sp-db-search").addEventListener("input", renderMiniDb);
  document.getElementById("sp-db-list").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-copy]");
    if (!btn) return;
    await navigator.clipboard.writeText(btn.getAttribute("data-copy") || "");
    showToast(t(currentLang, "copiedToast"));
  });

  const keys = [
    "saveHtml", "saveMd", "saveTxt", "saveJson", "saveCivitaiInfo",
    "obsidianFrontmatter", "saveMedia", "includeVideos", "skipExistingMedia", "saveWebuiPreview"
  ];
  for (const k of keys) {
    document.getElementById(`sp-${k}`)?.addEventListener("change", async (e) => {
      currentSettings = await updateSettings({ [k]: e.target.checked });
    });
  }
  document.getElementById("sp-saveMode").addEventListener("change", async (e) => {
    currentSettings = await updateSettings({ saveMode: e.target.value });
  });
  document.getElementById("sp-folderPreset").addEventListener("change", async (e) => {
    currentSettings = await updateSettings({ folderPreset: e.target.value });
  });
  let rootTimer = null;
  document.getElementById("sp-rootFolder").addEventListener("input", (e) => {
    clearTimeout(rootTimer);
    const val = e.target.value.trim() || "civitred";
    rootTimer = setTimeout(async () => {
      currentSettings = await updateSettings({ rootFolder: val });
      await refreshFolderCard();
    }, 250);
  });

  chrome.tabs.onActivated.addListener(refreshActiveTabModel);
  chrome.tabs.onUpdated.addListener((_, changeInfo) => {
    if (changeInfo.url || changeInfo.status === "complete") refreshActiveTabModel();
  });

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local") return;
    if (changes.cisSettings?.newValue) {
      currentSettings = changes.cisSettings.newValue;
      currentLang = resolveLang(currentSettings.language);
      syncSettingsControls();
      await refreshFolderCard();
    }
    if (changes.cisDatabase?.newValue) {
      allRecords = await getAllRecords();
      document.getElementById("sp-db-badge").textContent = t(currentLang, "savedCount", { count: allRecords.length });
      renderMiniDb();
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.target !== "ui") return;
    if (msg.type === "CIS_FS_HANDLE_UPDATED") refreshFolderCard();
    if (msg.type === "CIS_SAVE_PROGRESS" && msg.progress) {
      const p = msg.progress;
      const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 15;
      document.getElementById("sp-progress-fill").style.width = `${pct}%`;
      document.getElementById("sp-progress-text").textContent = `${p.done}/${p.total} (${((p.bytesDownloaded || 0) / 1048576).toFixed(1)} MB)`;
    }
  });
});
