import { isCivitaiModelUrl } from "./src/shared/folders.js";
import { resolveLang, t } from "./src/shared/i18n.js";
import { getSettings, updateSettings } from "./src/shared/settings.js";

const CHECKBOX_KEYS = [
  "saveHtml",
  "saveMd",
  "saveTxt",
  "saveJson",
  "saveCivitaiInfo",
  "obsidianFrontmatter",
  "saveMedia",
  "includeVideos",
  "skipExistingMedia",
  "saveWebuiPreview"
];

let activeTab = null;
let currentWindowId = null;
let activeJobId = null;
let currentLang = "en";

function applyTranslations(settings) {
  currentLang = resolveLang(settings.language);
  const root = settings.rootFolder || "civitred";

  document.getElementById("hdr-title").textContent = `⚡ ${t(currentLang, "extTitle")}`;
  document.getElementById("save-btn-label").textContent = t(currentLang, "saveCurrentTabBtn");
  document.getElementById("formats-heading").textContent = t(currentLang, "formatsTitle");
  document.getElementById("folder-heading").textContent = t(currentLang, "folderSectionTitle");
  document.getElementById("lbl-saveMode").textContent = t(currentLang, "saveModeLabel");
  document.getElementById("opt-direct").textContent = t(currentLang, "saveModeDirect");
  document.getElementById("opt-downloads").textContent = t(currentLang, "saveModeDownloads", { root });
  document.getElementById("lbl-rootFolder").textContent = t(currentLang, "rootFolderLabel");
  document.getElementById("lbl-folderPreset").textContent = t(currentLang, "folderPresetLabel");
  document.getElementById("opt-preset-title").textContent = t(currentLang, "presetTitleOnly", { root });
  document.getElementById("opt-preset-ver").textContent = t(currentLang, "presetTitleVersion", { root });
  document.getElementById("opt-preset-base").textContent = t(currentLang, "presetBaseTitle", { root });
  document.getElementById("opt-preset-file").textContent = t(currentLang, "presetFilenameOnly", { root });
  document.getElementById("lbl-language").textContent = t(currentLang, "languageLabel");
  document.getElementById("opt-lang-auto").textContent = t(currentLang, "langAuto");
  document.getElementById("popup-cancel-btn").textContent = t(currentLang, "cancelBtn");

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(currentLang, key);
  });
}

function setStatus(msg, isError = false) {
  const el = document.getElementById("popup-status");
  if (!msg) {
    el.className = "status-box";
    el.textContent = "";
    return;
  }
  el.textContent = msg;
  el.className = isError ? "status-box visible error" : "status-box visible";
}

function showProgress(progress) {
  const wrap = document.getElementById("popup-progress-wrap");
  const fill = document.getElementById("popup-progress-fill");
  const text = document.getElementById("popup-progress-text");
  if (!progress) {
    wrap.style.display = "none";
    return;
  }
  wrap.style.display = "block";
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 15;
  fill.style.width = `${pct}%`;
  const mb = ((progress.bytesDownloaded || 0) / (1024 * 1024)).toFixed(1);
  text.textContent = t(currentLang, "savingProgress", {
    done: progress.done || 0,
    total: progress.total || 0,
    mb
  });
}

function syncInputs(settings) {
  for (const key of CHECKBOX_KEYS) {
    const el = document.getElementById(key);
    if (el) el.checked = Boolean(settings[key]);
  }
  document.getElementById("saveMode").value = settings.saveMode;
  document.getElementById("rootFolder").value = settings.rootFolder;
  document.getElementById("folderPreset").value = settings.folderPreset;
  document.getElementById("language").value = settings.language;
}

document.addEventListener("DOMContentLoaded", async () => {
  const [settings, dbRes, tabs] = await Promise.all([
    getSettings(),
    chrome.storage.local.get(["cisDatabase"]),
    chrome.tabs.query({ active: true, currentWindow: true })
  ]);

  const db = Array.isArray(dbRes?.cisDatabase) ? dbRes.cisDatabase : [];
  activeTab = tabs?.[0] || null;
  currentWindowId = activeTab?.windowId ?? null;

  applyTranslations(settings);
  syncInputs(settings);
  document.getElementById("db-count").textContent = t(currentLang, "savedCount", { count: db.length });

  const saveBtn = document.getElementById("save-current-tab");
  const hintEl = document.getElementById("not-model-hint");
  const onModelPage = isCivitaiModelUrl(activeTab?.url);

  if (!onModelPage) {
    saveBtn.disabled = true;
    hintEl.style.display = "block";
    hintEl.textContent = t(currentLang, "notOnModelPage");
  }

  for (const key of CHECKBOX_KEYS) {
    const el = document.getElementById(key);
    el?.addEventListener("change", async () => {
      const updated = await updateSettings({ [key]: el.checked });
      applyTranslations(updated);
    });
  }

  document.getElementById("saveMode").addEventListener("change", async (e) => {
    const updated = await updateSettings({ saveMode: e.target.value });
    applyTranslations(updated);
  });

  document.getElementById("folderPreset").addEventListener("change", async (e) => {
    const updated = await updateSettings({ folderPreset: e.target.value });
    applyTranslations(updated);
  });

  document.getElementById("language").addEventListener("change", async (e) => {
    const updated = await updateSettings({ language: e.target.value });
    applyTranslations(updated);
    const { cisDatabase = [] } = await chrome.storage.local.get(["cisDatabase"]);
    document.getElementById("db-count").textContent = t(currentLang, "savedCount", { count: cisDatabase.length });
    if (!onModelPage) hintEl.textContent = t(currentLang, "notOnModelPage");
  });

  let rootTimer = null;
  document.getElementById("rootFolder").addEventListener("input", (e) => {
    clearTimeout(rootTimer);
    const val = e.target.value.trim() || "civitred";
    rootTimer = setTimeout(async () => {
      const updated = await updateSettings({ rootFolder: val });
      applyTranslations(updated);
    }, 250);
  });

  // Open side panel synchronously on user gesture (no await before open!)
  document.getElementById("open-sidepanel").addEventListener("click", () => {
    if (chrome.sidePanel?.open && currentWindowId !== null) {
      chrome.sidePanel.open({ windowId: currentWindowId }).catch(() => {});
      window.close();
    }
  });

  document.getElementById("open-db").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("database.html") });
  });

  document.getElementById("popup-cancel-btn").addEventListener("click", async () => {
    if (!activeJobId) return;
    await chrome.runtime.sendMessage({ type: "CIS_CANCEL_SAVE", jobId: activeJobId });
  });

  saveBtn.addEventListener("click", async () => {
    if (!activeTab?.id || saveBtn.disabled) return;
    saveBtn.disabled = true;
    activeJobId = crypto.randomUUID();
    setStatus(t(currentLang, "savingExtract"));
    showProgress({ done: 0, total: 0, bytesDownloaded: 0 });

    try {
      const res = await chrome.tabs.sendMessage(activeTab.id, {
        type: "CIS_TRIGGER_SAVE_FROM_POPUP",
        jobId: activeJobId
      });
      showProgress(null);

      if (res?.code === "PICKER_OPENED") {
        setStatus(t(currentLang, "pickTitle"));
        return;
      }
      if (res?.cancelled) {
        setStatus(t(currentLang, "savingCancelled", { done: res.result?.mediaSaved || 0, total: "?" }));
        return;
      }
      if (!res?.ok) {
        setStatus(t(currentLang, "savingError", { error: res?.error || "Failed" }), true);
        return;
      }

      const r = res.result || {};
      const skipped = r.skippedMedia ? ` (+${r.skippedMedia} skipped)` : "";
      if (Array.isArray(r.errors) && r.errors.length > 0) {
        setStatus(
          `${t(currentLang, "savingPartial", {
            errCount: r.errors.length,
            files: r.filesSaved,
            media: r.mediaSaved,
            skipped
          })} ${r.errors.slice(0, 2).join("; ")}`,
          true
        );
      } else {
        setStatus(
          t(currentLang, "savingDone", {
            files: r.filesSaved,
            media: r.mediaSaved,
            skipped,
            path: r.subfolder,
            total: r.totalInDb
          })
        );
      }
      if (r.totalInDb !== undefined) {
        document.getElementById("db-count").textContent = t(currentLang, "savedCount", { count: r.totalInDb });
      }
    } catch (err) {
      showProgress(null);
      setStatus(t(currentLang, "savingError", { error: err?.message || "Reload Civitai tab (F5) and retry" }), true);
    } finally {
      activeJobId = null;
      saveBtn.disabled = !isCivitaiModelUrl(activeTab?.url);
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.target !== "ui") return;
    if (msg.type === "CIS_SAVE_PROGRESS" && (!activeJobId || msg.jobId === activeJobId)) {
      showProgress(msg.progress);
    }
  });
});
