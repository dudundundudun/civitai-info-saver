(() => {
  const ROOT = (globalThis.__CIS__ = globalThis.__CIS__ || {});

  const WIDGET_STYLES = `
    :host {
      display: block;
      width: 100%;
      margin: 10px 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      color: #e9ecef;
    }
    :host(.cis-floating) {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 348px;
      margin: 0;
      z-index: 2147483646;
    }
    * { box-sizing: border-box; }
    button:focus-visible, select:focus-visible, summary:focus-visible, input:focus-visible {
      outline: 2px solid #74c0fc;
      outline-offset: 2px;
    }
    .cis-panel {
      background: linear-gradient(180deg, #1f2128 0%, #17181c 100%);
      border: 1px solid #373a40;
      border-left: 4px solid #339af0;
      border-radius: 8px;
      padding: 10px 12px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
    }
    :host(.cis-floating) .cis-panel {
      border-color: #339af0;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.78);
    }
    .cis-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }
    .cis-title {
      font-size: 11.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #74c0fc;
    }
    .cis-pin-btn {
      font-size: 10.5px;
      background: rgba(18, 184, 134, 0.16);
      color: #38d9a9;
      border: 1px solid rgba(18, 184, 134, 0.4);
      padding: 2px 7px;
      border-radius: 4px;
      font-weight: 600;
      cursor: pointer;
    }
    .cis-pin-btn:hover { background: rgba(18, 184, 134, 0.28); }
    .cis-banner {
      display: none;
      margin-bottom: 8px;
      padding: 7px 9px;
      border-radius: 6px;
      font-size: 11.5px;
      line-height: 1.38;
      font-weight: 600;
      border: 1px solid transparent;
    }
    .cis-banner.visible { display: block; }
    .cis-banner.found { background: rgba(18, 184, 134, 0.16); border-color: rgba(32, 201, 151, 0.5); color: #63e6be; }
    .cis-banner.other { background: rgba(250, 176, 5, 0.14); border-color: rgba(250, 176, 5, 0.45); color: #ffe066; }
    .cis-banner.perm { background: rgba(51, 154, 240, 0.12); border-color: rgba(51, 154, 240, 0.35); color: #a5d8ff; }
    .cis-primary-row {
      display: flex;
      gap: 6px;
      align-items: stretch;
    }
    .cis-main-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      background: linear-gradient(135deg, #1971c2 0%, #1864ab 100%);
      color: #ffffff;
      border: 1px solid #4dabf7;
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }
    .cis-main-btn.saved {
      background: linear-gradient(135deg, #2b8a3e 0%, #237032 100%);
      border-color: #51cf66;
    }
    .cis-main-btn.success {
      background: linear-gradient(135deg, #0ca678 0%, #099268 100%);
      border-color: #20c997;
    }
    .cis-main-btn:hover:not(:disabled) { filter: brightness(1.08); }
    .cis-main-btn:disabled { opacity: 0.65; cursor: wait; }
    .cis-mini-btn {
      background: #25262b;
      color: #ced4da;
      border: 1px solid #373a40;
      border-radius: 5px;
      padding: 4px 8px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }
    .cis-mini-btn:hover:not(:disabled) {
      background: #2c2e33;
      color: #ffffff;
      border-color: #4dabf7;
    }
    .cis-mini-btn:disabled { opacity: 0.6; cursor: wait; }
    .cis-mini-btn.danger { color: #ff8787; border-color: rgba(255, 135, 135, 0.4); }
    .cis-progress-wrap {
      margin-top: 7px;
      display: none;
    }
    .cis-progress-wrap.visible { display: block; }
    .cis-progress-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .cis-progress-track {
      flex: 1;
      height: 6px;
      background: #101113;
      border-radius: 999px;
      overflow: hidden;
      border: 1px solid #2c2e33;
    }
    .cis-progress-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #339af0, #63e6be);
      transition: width 0.2s ease;
    }
    .cis-actions-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      margin-top: 8px;
    }
    .cis-actions-left { display: flex; flex-wrap: wrap; gap: 5px; }
    .cis-details {
      margin-top: 8px;
      padding-top: 7px;
      border-top: 1px solid #2c2e33;
    }
    .cis-details summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      cursor: pointer;
      font-size: 11px;
      color: #adb5bd;
      list-style: none;
      user-select: none;
    }
    .cis-details summary::-webkit-details-marker { display: none; }
    .cis-summary-meta {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #909296;
    }
    .cis-dir-box {
      margin-top: 8px;
      background: #141517;
      border: 1px solid #2c2e33;
      border-radius: 6px;
      padding: 7px 9px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .cis-dir-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .cis-dir-status {
      font-size: 11px;
      color: #63e6be;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cis-dir-status.unset { color: #ffd43b; }
    .cis-formats-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 5px;
      margin-top: 8px;
      background: #141517;
      padding: 8px;
      border-radius: 6px;
      border: 1px solid #25262b;
    }
    .cis-chk {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      color: #d0d2d6;
      cursor: pointer;
    }
    .cis-chk input { width: 13px; height: 13px; accent-color: #228be6; margin: 0; }
    .cis-select-row {
      margin-top: 7px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .cis-select-row label { font-size: 10.5px; color: #909296; font-weight: 600; text-transform: uppercase; }
    .cis-select {
      width: 100%;
      background: #141517;
      color: #e9ecef;
      border: 1px solid #373a40;
      border-radius: 5px;
      padding: 5px 7px;
      font-size: 11.5px;
    }
    .cis-status {
      margin-top: 7px;
      font-size: 11.5px;
      line-height: 1.4;
      color: #63e6be;
      display: none;
      word-break: break-word;
    }
    .cis-status.visible { display: block; }
    .cis-status.error { color: #ff8787; }
    dialog.cis-dialog {
      margin: auto;
      border: 1px solid #373a40;
      border-radius: 10px;
      background: #1a1b1e;
      color: #e9ecef;
      max-width: 760px;
      width: calc(100% - 32px);
      max-height: 85vh;
      padding: 0;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.72);
    }
    dialog.cis-dialog::backdrop { background: rgba(0, 0, 0, 0.78); }
    .cis-dlg-hdr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 13px 16px;
      border-bottom: 1px solid #2c2e33;
    }
    .cis-dlg-hdr h3 { margin: 0; font-size: 15px; color: #74c0fc; }
    .cis-dlg-body { padding: 14px 16px; overflow-y: auto; max-height: calc(85vh - 56px); font-size: 12.5px; }
    .cis-kv-table { width: 100%; border-collapse: collapse; }
    .cis-kv-table th, .cis-kv-table td { border: 1px solid #2c2e33; padding: 6px 9px; text-align: left; vertical-align: top; }
    .cis-kv-table th { width: 145px; background: #25262b; color: #909296; }
    .cis-pill { background: rgba(34, 139, 230, 0.15); color: #74c0fc; border: 1px solid rgba(34, 139, 230, 0.35); padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 11.5px; word-break: break-all; }
  `;

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatMsg(messages, key, params = {}) {
    let text = messages?.[key] || key;
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v ?? ""));
    }
    return text;
  }

  const CHECKBOX_BINDINGS = [
    ["cis-chk-html", "saveHtml"],
    ["cis-chk-md", "saveMd"],
    ["cis-chk-txt", "saveTxt"],
    ["cis-chk-json", "saveJson"],
    ["cis-chk-info", "saveCivitaiInfo"],
    ["cis-chk-yaml", "obsidianFrontmatter"],
    ["cis-chk-media", "saveMedia"],
    ["cis-chk-videos", "includeVideos"],
    ["cis-chk-skip-existing", "skipExistingMedia"],
    ["cis-chk-webui-preview", "saveWebuiPreview"]
  ];

  function createWidgetHost({
    isFloating,
    settings,
    messages,
    onTogglePin,
    onSettingChange,
    onSaveClick,
    onCancelClick,
    onRetryFailedClick,
    onPreviewClick,
    onAllVersionsClick,
    onOpenDbClick,
    onPickFolderClick
  }) {
    const host = document.createElement("div");
    host.id = "cis-shadow-host";
    if (isFloating) host.classList.add("cis-floating");

    const shadow = host.attachShadow({ mode: "open" });
    const styleEl = document.createElement("style");
    styleEl.textContent = WIDGET_STYLES;

    const root = document.createElement("div");
    root.className = "cis-panel";

    root.innerHTML = `
      <div class="cis-header">
        <span class="cis-title" id="cis-hdr-title">⚡ ${escapeHtml(formatMsg(messages, "extTitle"))}</span>
        <button type="button" class="cis-pin-btn" id="cis-pin-toggle">${isFloating ? "📌 " + escapeHtml(formatMsg(messages, "pinFloating")) : "📌 " + escapeHtml(formatMsg(messages, "pinDocked"))}</button>
      </div>

      <div id="cis-exists-banner" class="cis-banner" role="status" aria-live="polite"></div>

      <div class="cis-primary-row">
        <button id="cis-save-btn" class="cis-main-btn" type="button">
          <span>💾 ${escapeHtml(formatMsg(messages, "saveCurrentPage"))}</span>
        </button>
        <button id="cis-copy-lora-btn" class="cis-mini-btn" type="button" title="${escapeHtml(formatMsg(messages, "copyLoraTag"))}">&lt;lora&gt;</button>
      </div>

      <div id="cis-progress-wrap" class="cis-progress-wrap">
        <div class="cis-progress-row">
          <div class="cis-progress-track"><div id="cis-progress-fill" class="cis-progress-fill"></div></div>
          <button type="button" class="cis-mini-btn danger" id="cis-cancel-btn">${escapeHtml(formatMsg(messages, "cancelBtn"))}</button>
        </div>
        <div id="cis-progress-text" style="font-size:11px;color:#adb5bd;margin-top:3px;"></div>
      </div>

      <div class="cis-actions-bar">
        <div class="cis-actions-left">
          <button type="button" class="cis-mini-btn" id="cis-preview-btn">👁️ ${escapeHtml(formatMsg(messages, "previewBtn"))}</button>
          <button type="button" class="cis-mini-btn" id="cis-all-ver-btn">📦 ${escapeHtml(formatMsg(messages, "allVersionsBtn"))}</button>
          <button type="button" class="cis-mini-btn danger" id="cis-retry-btn" style="display:none;">🔁 Retry</button>
        </div>
        <button type="button" class="cis-mini-btn" id="cis-open-db-btn">🔍 ${escapeHtml(formatMsg(messages, "dbBtn"))}</button>
      </div>

      <details class="cis-details" id="cis-settings-details">
        <summary>
          <span>⚙️ ${escapeHtml(formatMsg(messages, "settingsToggle"))}</span>
          <span class="cis-summary-meta" id="cis-summary-meta"></span>
        </summary>

        <div class="cis-dir-box">
          <div class="cis-dir-top">
            <span id="cis-dir-status" class="cis-dir-status"></span>
            <button type="button" class="cis-mini-btn" id="cis-pick-dir-btn">📁 ${escapeHtml(formatMsg(messages, "chooseFolder"))}</button>
          </div>
          <select id="cis-save-mode" class="cis-select" aria-label="Save mode">
            <option value="direct_documents">${escapeHtml(formatMsg(messages, "saveModeDirect"))}</option>
            <option value="downloads_subfolder">${escapeHtml(formatMsg(messages, "saveModeDownloads", { root: settings?.rootFolder || "civitred" }))}</option>
          </select>
        </div>

        <div class="cis-formats-grid">
          <label class="cis-chk"><input type="checkbox" id="cis-chk-html" /> <span>${escapeHtml(formatMsg(messages, "fmtHtml"))}</span></label>
          <label class="cis-chk"><input type="checkbox" id="cis-chk-md" /> <span>${escapeHtml(formatMsg(messages, "fmtMd"))}</span></label>
          <label class="cis-chk"><input type="checkbox" id="cis-chk-txt" /> <span>${escapeHtml(formatMsg(messages, "fmtTxt"))}</span></label>
          <label class="cis-chk"><input type="checkbox" id="cis-chk-json" /> <span>${escapeHtml(formatMsg(messages, "fmtJson"))}</span></label>
          <label class="cis-chk"><input type="checkbox" id="cis-chk-info" /> <span>${escapeHtml(formatMsg(messages, "fmtCivitaiInfo"))}</span></label>
          <label class="cis-chk"><input type="checkbox" id="cis-chk-yaml" /> <span>${escapeHtml(formatMsg(messages, "fmtObsidianYaml"))}</span></label>
          <label class="cis-chk"><input type="checkbox" id="cis-chk-media" /> <span>${escapeHtml(formatMsg(messages, "fmtMedia"))}</span></label>
          <label class="cis-chk"><input type="checkbox" id="cis-chk-videos" /> <span>${escapeHtml(formatMsg(messages, "fmtVideos"))}</span></label>
          <label class="cis-chk"><input type="checkbox" id="cis-chk-skip-existing" /> <span>${escapeHtml(formatMsg(messages, "fmtSkipExisting"))}</span></label>
          <label class="cis-chk"><input type="checkbox" id="cis-chk-webui-preview" /> <span>${escapeHtml(formatMsg(messages, "fmtWebuiPreview"))}</span></label>
        </div>

        <div class="cis-select-row">
          <label for="cis-folder-preset">${escapeHtml(formatMsg(messages, "folderPresetLabel"))}</label>
          <select id="cis-folder-preset" class="cis-select">
            <option value="lora_title_only">${escapeHtml(formatMsg(messages, "presetTitleOnly", { root: settings?.rootFolder || "civitred" }))}</option>
            <option value="lora_title_version">${escapeHtml(formatMsg(messages, "presetTitleVersion", { root: settings?.rootFolder || "civitred" }))}</option>
            <option value="base_and_lora_title">${escapeHtml(formatMsg(messages, "presetBaseTitle", { root: settings?.rootFolder || "civitred" }))}</option>
            <option value="filename_only">${escapeHtml(formatMsg(messages, "presetFilenameOnly", { root: settings?.rootFolder || "civitred" }))}</option>
          </select>
        </div>
      </details>

      <div id="cis-status-msg" class="cis-status" role="status" aria-live="polite"></div>

      <dialog id="cis-preview-dialog" class="cis-dialog" aria-labelledby="cis-dlg-title">
        <div class="cis-dlg-hdr">
          <h3 id="cis-dlg-title">📋 Model Preview</h3>
          <button type="button" class="cis-mini-btn" id="cis-close-dlg">✕</button>
        </div>
        <div class="cis-dlg-body" id="cis-dlg-body"></div>
      </dialog>
    `;

    shadow.appendChild(styleEl);
    shadow.appendChild(root);

    const $ = (id) => shadow.getElementById(id);

    let currentLoraTag = "";
    let failedIndices = [];

    for (const [id, key] of CHECKBOX_BINDINGS) {
      $(id)?.addEventListener("change", (e) => onSettingChange({ [key]: e.target.checked }));
    }
    $("cis-save-mode").addEventListener("change", (e) => onSettingChange({ saveMode: e.target.value }));
    $("cis-folder-preset").addEventListener("change", (e) => onSettingChange({ folderPreset: e.target.value }));
    $("cis-pin-toggle").addEventListener("click", onTogglePin);
    $("cis-save-btn").addEventListener("click", () => onSaveClick(null));
    $("cis-cancel-btn").addEventListener("click", onCancelClick);
    $("cis-retry-btn").addEventListener("click", () => {
      if (failedIndices.length > 0) onRetryFailedClick([...failedIndices]);
    });
    $("cis-preview-btn").addEventListener("click", onPreviewClick);
    $("cis-all-ver-btn").addEventListener("click", onAllVersionsClick);
    $("cis-open-db-btn").addEventListener("click", onOpenDbClick);
    $("cis-pick-dir-btn").addEventListener("click", onPickFolderClick);
    $("cis-close-dlg").addEventListener("click", () => $("cis-preview-dialog").close());
    $("cis-preview-dialog").addEventListener("click", (e) => {
      if (e.target === $("cis-preview-dialog")) $("cis-preview-dialog").close();
    });
    $("cis-copy-lora-btn").addEventListener("click", async () => {
      if (!currentLoraTag) return;
      try {
        await navigator.clipboard.writeText(currentLoraTag);
        setStatus(`✅ ${formatMsg(currentMessages, "copiedToast")} ${currentLoraTag}`);
      } catch (e) {
        setStatus("Clipboard copy blocked by browser", true);
      }
    });

    let currentMessages = messages || {};

    function syncSettings(s, msgs) {
      if (msgs) currentMessages = msgs;
      for (const [id, key] of CHECKBOX_BINDINGS) {
        const el = $(id);
        if (el) el.checked = Boolean(s[key]);
      }
      $("cis-save-mode").value = s.saveMode || "direct_documents";
      $("cis-folder-preset").value = s.folderPreset || "lora_title_only";

      const enabledFmts = [];
      if (s.saveHtml) enabledFmts.push("HTML");
      if (s.saveMd) enabledFmts.push("MD");
      if (s.saveTxt) enabledFmts.push("TXT");
      if (s.saveJson) enabledFmts.push("JSON");
      if (s.saveMedia) enabledFmts.push(s.includeVideos ? "Media+Vid" : "Imgs");

      const rootLabel = s.saveMode === "downloads_subfolder" ? `Downloads/${s.rootFolder || "civitred"}` : s.rootFolder || "civitred";
      $("cis-summary-meta").textContent = `${rootLabel} · ${enabledFmts.join(", ")}`;
    }

    function updateFolderStatus(folderInfo, s) {
      const dirStatusEl = $("cis-dir-status");
      const pickBtn = $("cis-pick-dir-btn");
      if (s.saveMode === "downloads_subfolder") {
        dirStatusEl.textContent = `📂 ${formatMsg(currentMessages, "downloadsFolderReady", { root: s.rootFolder || "civitred" })}`;
        dirStatusEl.className = "cis-dir-status";
        pickBtn.style.display = "none";
      } else {
        pickBtn.style.display = "inline-block";
        if (!folderInfo || !folderInfo.configured) {
          dirStatusEl.textContent = `📁 ${formatMsg(currentMessages, "folderNotSelected")}`;
          dirStatusEl.className = "cis-dir-status unset";
          pickBtn.textContent = `📁 ${formatMsg(currentMessages, "chooseFolder")}`;
        } else if (folderInfo.permissionRequired) {
          dirStatusEl.textContent = `🔒 ${formatMsg(currentMessages, "folderNeedsPerm", { path: folderInfo.displayRootPath || s.rootFolder })}`;
          dirStatusEl.className = "cis-dir-status unset";
          pickBtn.textContent = `🔓 ${formatMsg(currentMessages, "authorizeFolder")}`;
        } else {
          dirStatusEl.textContent = `✅ ${formatMsg(currentMessages, "folderReady", { path: folderInfo.displayRootPath || s.rootFolder })}`;
          dirStatusEl.className = "cis-dir-status";
          pickBtn.textContent = `📁 ${formatMsg(currentMessages, "chooseFolder")}`;
        }
      }
    }

    function updateDuplicateBanner(checkData, s) {
      const banner = $("cis-exists-banner");
      const saveBtn = $("cis-save-btn");
      currentLoraTag = checkData?.loraTag || "";
      $("cis-copy-lora-btn").disabled = !currentLoraTag;

      const fi = checkData?.folderInfo;
      updateFolderStatus(fi, s);

      if (fi && fi.exists) {
        const parts = [];
        if (fi.infoExts?.length) parts.push(fi.infoExts.join(", "));
        if (fi.mediaCount > 0) parts.push(`${fi.mediaCount} media`);
        const details = parts.length > 0 ? ` (${parts.join(" + ")})` : "";
        banner.className = "cis-banner visible found";
        banner.textContent = `✅ ${formatMsg(currentMessages, "alreadySavedBanner", { files: fi.totalFiles, path: fi.displayPath, details })}`;
        if (!saveBtn.disabled) {
          saveBtn.className = "cis-main-btn saved";
          saveBtn.innerHTML = `<span>🔄 ${escapeHtml(formatMsg(currentMessages, "alreadySavedBtn"))}</span>`;
        }
        return;
      }

      if (checkData?.inDbExact || (checkData?.downloadFilesCount || 0) > 0) {
        const where = checkData?.inDbExact?.localSubfolder || `Downloads/${s.rootFolder || "civitred"}`;
        const extra = checkData?.downloadFilesCount > 0 ? ` (Downloads: ${checkData.downloadFilesCount})` : "";
        banner.className = "cis-banner visible found";
        banner.textContent = `✅ ${formatMsg(currentMessages, "dbSavedBanner", { path: where, extra })}`;
        if (!saveBtn.disabled) {
          saveBtn.className = "cis-main-btn saved";
          saveBtn.innerHTML = `<span>🔄 ${escapeHtml(formatMsg(currentMessages, "alreadySavedBtn"))}</span>`;
        }
        return;
      }

      if (Array.isArray(checkData?.inDbOtherVersions) && checkData.inDbOtherVersions.length > 0) {
        const versions = checkData.inDbOtherVersions.map((v) => v.versionName).filter(Boolean).slice(0, 3).join(", ");
        banner.className = "cis-banner visible other";
        banner.textContent = `ℹ️ ${formatMsg(currentMessages, "otherVersionBanner", { versions })}`;
      } else if (fi?.permissionRequired && s.saveMode === "direct_documents") {
        banner.className = "cis-banner visible perm";
        banner.textContent = `🔒 ${formatMsg(currentMessages, "needsPermBanner", { root: fi.displayRootPath || s.rootFolder || "civitred" })}`;
      } else {
        banner.className = "cis-banner";
        banner.textContent = "";
      }

      if (!saveBtn.disabled) {
        saveBtn.className = "cis-main-btn";
        saveBtn.innerHTML = `<span>💾 ${escapeHtml(formatMsg(currentMessages, "saveCurrentPage"))}</span>`;
      }
    }

    function setSavingState(isSaving, labelText = "") {
      const saveBtn = $("cis-save-btn");
      const allBtn = $("cis-all-ver-btn");
      const progWrap = $("cis-progress-wrap");
      saveBtn.disabled = isSaving;
      allBtn.disabled = isSaving;
      if (isSaving) {
        saveBtn.innerHTML = `<span>⏳ ${escapeHtml(labelText || formatMsg(currentMessages, "savingExtract"))}</span>`;
        progWrap.classList.add("visible");
      } else {
        progWrap.classList.remove("visible");
        $("cis-progress-fill").style.width = "0%";
        $("cis-progress-text").textContent = "";
      }
    }

    function updateProgress(p) {
      if (!p) return;
      const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 12;
      $("cis-progress-fill").style.width = `${pct}%`;
      const mb = ((p.bytesDownloaded || 0) / (1024 * 1024)).toFixed(1);
      $("cis-progress-text").textContent = formatMsg(currentMessages, "savingProgress", {
        done: p.done || 0,
        total: p.total || 0,
        mb
      });
    }

    function setFailedIndices(indices) {
      failedIndices = Array.isArray(indices) ? indices : [];
      const retryBtn = $("cis-retry-btn");
      if (failedIndices.length > 0) {
        retryBtn.style.display = "inline-block";
        retryBtn.textContent = `🔁 ${formatMsg(currentMessages, "retryFailedBtn", { count: failedIndices.length })}`;
      } else {
        retryBtn.style.display = "none";
      }
    }

    function setStatus(text, isError = false) {
      const statusEl = $("cis-status-msg");
      if (!text) {
        statusEl.className = "cis-status";
        statusEl.textContent = "";
        return;
      }
      statusEl.textContent = text;
      statusEl.className = "cis-status visible" + (isError ? " error" : "");
    }

    function flashSuccessButton(label) {
      const saveBtn = $("cis-save-btn");
      saveBtn.className = "cis-main-btn success";
      saveBtn.innerHTML = `<span>✅ ${escapeHtml(label)}</span>`;
    }

    function showPreviewDialog(payload, derived) {
      const dlg = $("cis-preview-dialog");
      const body = $("cis-dlg-body");
      const videoCount = (payload.media || []).filter((m) => m.isVideo).length;
      const imageCount = (payload.media || []).length - videoCount;
      const triggers = (payload.triggerWords || []).join(", ") || "None";

      body.innerHTML = `
        <table class="cis-kv-table">
          <tr><th>Target Folder</th><td><strong>${escapeHtml(derived?.folderPath || payload.title)}</strong> (${escapeHtml(payload.versionName)})</td></tr>
          <tr><th>Filename</th><td><span class="cis-pill">${escapeHtml(payload.fileName)}</span> (${escapeHtml(payload.fileFormat)} • ${escapeHtml(payload.fileSizeFormatted || "N/A")})</td></tr>
          <tr><th>LoRA Tag</th><td><span class="cis-pill">${escapeHtml(derived?.loraTag || "")}</span></td></tr>
          <tr><th>Trigger Words</th><td><span class="cis-pill">${escapeHtml(triggers)}</span></td></tr>
          <tr><th>Type &amp; Base</th><td>${escapeHtml(payload.modelType)} — <strong>${escapeHtml(payload.baseModel)}</strong></td></tr>
          <tr><th>Tips / Training</th><td>${escapeHtml(payload.usageTips || "N/A")} | ${escapeHtml(payload.training || "N/A")}</td></tr>
          <tr><th>Hash / AIR</th><td>AutoV2: <code>${escapeHtml(payload.hashes?.AutoV2 || "N/A")}</code> | AIR: <code>${escapeHtml(payload.air || "N/A")}</code></td></tr>
          <tr><th>Media</th><td><strong>${imageCount}</strong> images + <strong>${videoCount}</strong> videos</td></tr>
          <tr><th>Description</th><td style="max-height:140px;overflow-y:auto;white-space:pre-wrap;color:#adb5bd;">${escapeHtml((payload.descriptionText || "").slice(0, 1000))}</td></tr>
        </table>`;
      if (!dlg.open) dlg.showModal();
    }

    if (settings) syncSettings(settings, messages);

    return {
      host,
      syncSettings,
      updateDuplicateBanner,
      setSavingState,
      updateProgress,
      setFailedIndices,
      setStatus,
      flashSuccessButton,
      showPreviewDialog
    };
  }

  ROOT.widget = { createWidgetHost, formatMsg };
})();
