document.addEventListener("DOMContentLoaded", async () => {
  const stored = await chrome.storage.local.get(["cisSettings", "cisDatabase"]);
  const settings = stored.cisSettings || {};
  const db = stored.cisDatabase || [];

  document.getElementById("db-count").textContent = `${db.length} saved`;

  const trueByDefault = ["saveHtml", "saveMd", "saveTxt", "saveJson", "saveMedia", "includeVideos", "skipExistingMedia"];
  trueByDefault.forEach((key) => {
    const el = document.getElementById(key);
    if (!el) return;
    el.checked = settings[key] !== false;
    el.addEventListener("change", () => {
      settings[key] = el.checked;
      chrome.storage.local.set({ cisSettings: settings });
    });
  });

  const falseByDefault = ["saveWebuiPreview"];
  falseByDefault.forEach((key) => {
    const el = document.getElementById(key);
    if (!el) return;
    el.checked = Boolean(settings[key]);
    el.addEventListener("change", () => {
      settings[key] = el.checked;
      chrome.storage.local.set({ cisSettings: settings });
    });
  });

  const saveModeSelect = document.getElementById("saveMode");
  saveModeSelect.value = settings.saveMode || "direct_documents";
  saveModeSelect.addEventListener("change", () => {
    settings.saveMode = saveModeSelect.value;
    chrome.storage.local.set({ cisSettings: settings });
  });

  const rootInput = document.getElementById("rootFolder");
  rootInput.value = settings.rootFolder || "civitred";
  rootInput.addEventListener("input", () => {
    settings.rootFolder = rootInput.value.trim() || "civitred";
    chrome.storage.local.set({ cisSettings: settings });
  });

  const presetSelect = document.getElementById("folderPreset");
  presetSelect.value = settings.folderPreset || "lora_title_only";
  presetSelect.addEventListener("change", () => {
    settings.folderPreset = presetSelect.value;
    chrome.storage.local.set({ cisSettings: settings });
  });

  document.getElementById("open-db").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("database.html") });
  });

  const saveTabBtn = document.getElementById("save-current-tab");
  const statusEl = document.getElementById("popup-status");
  saveTabBtn.addEventListener("click", async () => {
    statusEl.style.display = "block";
    statusEl.textContent = "⏳ Сохраняем текущую вкладку...";
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      statusEl.textContent = "❌ Активная вкладка не найдена.";
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: "CIS_TRIGGER_SAVE_FROM_POPUP" }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) {
        statusEl.textContent = "⚠️ Обнови (F5) вкладку Civitai и попробуй снова.";
        return;
      }
      const r = res.result || {};
      const skippedText = r.skippedMedia ? `, пропущено ${r.skippedMedia}` : "";
      statusEl.textContent = `✅ Сохранено ${r.filesSaved} инфо + ${r.mediaSaved} медиа${skippedText}!`;
      document.getElementById("db-count").textContent = `${r.totalInDb} saved`;
    });
  });
});
