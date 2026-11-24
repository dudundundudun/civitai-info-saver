(() => {
  const ROOT = (globalThis.__CIS__ = globalThis.__CIS__ || {});
  const { scraper, widget } = ROOT;

  let currentSettings = null;
  let currentMessages = {};
  let forceFloatingMode = false;
  let widgetApi = null;
  let activeJobId = null;
  let lastUrl = location.href;
  let lastCheckedUrl = "";
  let checkSeq = 0;
  let injectTimer = null;
  let domObserver = null;

  function msg(key, params = {}) {
    return widget.formatMsg(currentMessages, key, params);
  }

  async function refreshExistingStatus() {
    if (!widgetApi || !location.pathname.startsWith("/models/")) return;
    const seq = ++checkSeq;
    const meta = await scraper.getQuickModelMetaForCheck();
    if (!meta || seq !== checkSeq) return;

    try {
      const res = await chrome.runtime.sendMessage({
        type: "CIS_CHECK_EXISTING",
        query: meta
      });
      if (seq !== checkSeq || !res?.ok) return;
      if (res.settings) currentSettings = res.settings;
      widgetApi.syncSettings(currentSettings, currentMessages);
      widgetApi.updateDuplicateBanner(res, currentSettings);
    } catch (e) {
      // Extension context may be reloading
    }
  }

  async function executeSave(onlyMediaIndices = null, customJobId = null) {
    if (!location.pathname.startsWith("/models/")) {
      return { ok: false, error: "Not on a Civitai model page" };
    }
    if (!widgetApi) mountOrUpdateWidget();

    const jobId = customJobId || crypto.randomUUID();
    activeJobId = jobId;
    widgetApi.setSavingState(true, msg("savingExtract"));
    widgetApi.setStatus(msg("savingExtract"));

    try {
      const payload = await scraper.extractModelPayload();
      const res = await chrome.runtime.sendMessage({
        type: "CIS_START_SAVE",
        jobId,
        payload,
        onlyMediaIndices
      });

      if (res?.code === "PICKER_OPENED") {
        widgetApi.setSavingState(false);
        widgetApi.setStatus(msg("pickTitle"));
        return res;
      }

      handleSaveCompletion(res);
      return res;
    } catch (err) {
      widgetApi.setSavingState(false);
      widgetApi.setStatus(msg("savingError", { error: err?.message || String(err) }), true);
      activeJobId = null;
      return { ok: false, error: err?.message || String(err) };
    }
  }

  function handleSaveCompletion(res) {
    if (!widgetApi) return;
    widgetApi.setSavingState(false);
    activeJobId = null;

    if (res?.cancelled) {
      widgetApi.setStatus(msg("savingCancelled", { done: res.result?.mediaSaved || 0, total: "?" }));
      refreshExistingStatus();
      return;
    }

    if (!res?.ok) {
      widgetApi.setStatus(msg("savingError", { error: res?.error || "Failed" }), true);
      refreshExistingStatus();
      return;
    }

    const r = res.result || {};
    const skipped = r.skippedMedia ? ` (+${r.skippedMedia} skipped)` : "";
    widgetApi.setFailedIndices(r.failedIndices || []);

    if (Array.isArray(r.errors) && r.errors.length > 0) {
      widgetApi.setStatus(
        `${msg("savingPartial", {
          errCount: r.errors.length,
          files: r.filesSaved,
          media: r.mediaSaved,
          skipped
        })} ${r.errors.slice(0, 3).join("; ")}`,
        true
      );
    } else {
      widgetApi.flashSuccessButton(r.subfolder || "Saved");
      widgetApi.setStatus(
        msg("savingDone", {
          files: r.filesSaved,
          media: r.mediaSaved,
          skipped,
          path: r.subfolder,
          total: r.totalInDb || 1
        })
      );
    }

    setTimeout(() => refreshExistingStatus(), 2500);
  }

  async function executeAllVersionsSave() {
    if (!location.pathname.startsWith("/models/") || !widgetApi) return;
    widgetApi.setSavingState(true, msg("savingExtract"));

    try {
      const modelId = scraper.getModelIdFromUrl();
      const nextExtracted = scraper.extractFromNextData(modelId);
      const apiData = (await scraper.fetchModelDataFromApi(modelId)) || nextExtracted?.modelData;
      const versions = apiData?.modelVersions || [];
      if (versions.length === 0) {
        widgetApi.setSavingState(false);
        widgetApi.setStatus("No model versions found.", true);
        return;
      }

      let done = 0;
      const totalErrors = [];
      for (const ver of versions) {
        const jobId = crypto.randomUUID();
        activeJobId = jobId;
        widgetApi.setStatus(msg("allVersionsProgress", { done: done + 1, total: versions.length, name: ver.name }));
        const payload = await scraper.extractModelPayload(ver);
        const res = await chrome.runtime.sendMessage({
          type: "CIS_START_SAVE",
          jobId,
          payload,
          settingsOverride: { folderPreset: "lora_title_version" }
        });

        if (res?.code === "PICKER_OPENED") {
          widgetApi.setSavingState(false);
          widgetApi.setStatus(msg("pickTitle"));
          activeJobId = null;
          return;
        }
        if (res?.cancelled) {
          widgetApi.setSavingState(false);
          widgetApi.setStatus(msg("savingCancelled", { done, total: versions.length }));
          activeJobId = null;
          return;
        }
        if (!res?.ok) {
          totalErrors.push(`${ver.name}: ${res?.error || "Error"}`);
        } else if (res.result?.errors?.length) {
          totalErrors.push(`${ver.name}: ${res.result.errors.length} media error(s)`);
        }
        done++;
      }

      widgetApi.setSavingState(false);
      activeJobId = null;
      if (totalErrors.length > 0) {
        widgetApi.setStatus(`Completed ${done}/${versions.length} with errors: ${totalErrors.slice(0, 3).join("; ")}`, true);
      } else {
        widgetApi.setStatus(`✅ ${msg("allVersionsDone", { total: done })}`);
      }
      refreshExistingStatus();
    } catch (err) {
      widgetApi.setSavingState(false);
      activeJobId = null;
      widgetApi.setStatus(msg("savingError", { error: err?.message || String(err) }), true);
    }
  }

  function createHostApi(isFloating) {
    return widget.createWidgetHost({
      isFloating,
      settings: currentSettings,
      messages: currentMessages,
      onTogglePin: () => {
        forceFloatingMode = !forceFloatingMode;
        const existing = document.getElementById("cis-shadow-host");
        if (existing) existing.remove();
        widgetApi = null;
        mountOrUpdateWidget();
      },
      onSettingChange: async (patch) => {
        const res = await chrome.runtime.sendMessage({ type: "CIS_UPDATE_SETTINGS", patch });
        if (res?.ok) {
          currentSettings = res.settings;
          currentMessages = res.messages || currentMessages;
          widgetApi?.syncSettings(currentSettings, currentMessages);
          refreshExistingStatus();
        }
      },
      onSaveClick: () => executeSave(null),
      onRetryFailedClick: (indices) => executeSave(indices),
      onCancelClick: async () => {
        if (activeJobId) {
          await chrome.runtime.sendMessage({ type: "CIS_CANCEL_SAVE", jobId: activeJobId });
        }
      },
      onPreviewClick: async () => {
        widgetApi.setStatus(msg("loadingPreview"));
        const payload = await scraper.extractModelPayload();
        const derived = await chrome.runtime.sendMessage({ type: "CIS_PREPARE_PREVIEW", payload });
        widgetApi.setStatus("");
        widgetApi.showPreviewDialog(payload, derived);
      },
      onAllVersionsClick: executeAllVersionsSave,
      onOpenDbClick: () => chrome.runtime.sendMessage({ type: "CIS_OPEN_DATABASE" }),
      onPickFolderClick: () => chrome.runtime.sendMessage({ type: "CIS_REQUEST_FOLDER_PICK", autoResume: false })
    });
  }

  function mountOrUpdateWidget() {
    if (!location.pathname.startsWith("/models/")) {
      const existing = document.getElementById("cis-shadow-host");
      if (existing) existing.remove();
      widgetApi = null;
      stopModelObserver();
      return;
    }

    const existing = document.getElementById("cis-shadow-host");
    if (existing) {
      if (existing.classList.contains("cis-floating") && !forceFloatingMode) {
        const detailsBlock = scraper.findDetailsBlockContainer();
        const dlCard = scraper.findDownloadCardContainer();
        if (detailsBlock || dlCard) {
          existing.remove();
          widgetApi = null;
        } else {
          return;
        }
      } else {
        return;
      }
    }

    if (!forceFloatingMode) {
      const detailsBlock = scraper.findDetailsBlockContainer();
      if (
        detailsBlock &&
        detailsBlock.parentElement &&
        !["BUTTON", "A", "H1", "H2", "H3", "TR", "TBODY"].includes(detailsBlock.tagName)
      ) {
        widgetApi = createHostApi(false);
        detailsBlock.parentElement.insertBefore(widgetApi.host, detailsBlock);
        lastCheckedUrl = location.href;
        refreshExistingStatus();
        return;
      }

      const dlCard = scraper.findDownloadCardContainer();
      if (dlCard && dlCard.parentElement && !["BUTTON", "A", "H1", "H2", "H3"].includes(dlCard.tagName)) {
        widgetApi = createHostApi(false);
        dlCard.insertAdjacentElement("afterend", widgetApi.host);
        lastCheckedUrl = location.href;
        refreshExistingStatus();
        return;
      }
    }

    if (document.body) {
      widgetApi = createHostApi(true);
      document.body.appendChild(widgetApi.host);
      lastCheckedUrl = location.href;
      refreshExistingStatus();
    }
  }

  function stopModelObserver() {
    if (domObserver) {
      domObserver.disconnect();
      domObserver = null;
    }
  }

  function ensureModelObserver() {
    if (!location.pathname.startsWith("/models/") || domObserver) return;
    const rootTarget = document.querySelector("main") || document.body || document.documentElement;
    domObserver = new MutationObserver(() => {
      if (!document.getElementById("cis-shadow-host") || location.href !== lastUrl) {
        scheduleInject();
      }
    });
    domObserver.observe(rootTarget, { childList: true, subtree: true });
  }

  function scheduleInject() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastCheckedUrl = "";
    }
    clearTimeout(injectTimer);
    injectTimer = setTimeout(() => {
      mountOrUpdateWidget();
      if (location.pathname.startsWith("/models/")) {
        ensureModelObserver();
        if (location.href !== lastCheckedUrl && document.getElementById("cis-shadow-host")) {
          lastCheckedUrl = location.href;
          refreshExistingStatus();
        }
      }
    }, 250);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.target === "offscreen" || message.target === "ui") return;

    if (message.type === "CIS_TRIGGER_SAVE_FROM_POPUP") {
      executeSave(null, message.jobId || null).then(sendResponse);
      return true;
    }

    if (message.type === "CIS_GET_ACTIVE_MODEL") {
      if (!location.pathname.startsWith("/models/")) {
        sendResponse({ ok: false, error: "Not on a model page" });
        return false;
      }
      scraper
        .getQuickModelMetaForCheck()
        .then((meta) => sendResponse({ ok: Boolean(meta), meta }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    if (message.type === "CIS_SAVE_PROGRESS" && message.jobId === activeJobId) {
      widgetApi?.updateProgress(message.progress);
      return false;
    }

    if (message.type === "CIS_SAVE_DONE" && message.jobId === activeJobId) {
      handleSaveCompletion(message);
      return false;
    }

    if (message.type === "CIS_FS_HANDLE_UPDATED") {
      refreshExistingStatus();
      return false;
    }
  });

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === "local" && changes.cisSettings?.newValue) {
      const res = await chrome.runtime.sendMessage({ type: "CIS_GET_BOOTSTRAP_STATE" }).catch(() => null);
      if (res?.ok) {
        currentSettings = res.settings;
        currentMessages = res.messages;
        widgetApi?.syncSettings(currentSettings, currentMessages);
        refreshExistingStatus();
      }
    }
  });

  if (globalThis.navigation?.addEventListener) {
    globalThis.navigation.addEventListener("navigatesuccess", scheduleInject);
  }
  window.addEventListener("popstate", scheduleInject);

  (async () => {
    try {
      const boot = await chrome.runtime.sendMessage({ type: "CIS_GET_BOOTSTRAP_STATE" });
      if (boot?.ok) {
        currentSettings = boot.settings;
        currentMessages = boot.messages || {};
      }
    } catch (e) {}
    mountOrUpdateWidget();
    if (location.pathname.startsWith("/models/")) {
      ensureModelObserver();
    }
  })();
})();
