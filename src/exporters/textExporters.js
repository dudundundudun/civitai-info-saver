import {
  buildLoraTag,
  buildSafeMediaFilename,
  escapeMarkdownCell,
  extractRecommendedWeight,
  formatMarkdownCode,
  sanitizeHttpUrl,
  sanitizeSegment
} from "../shared/sanitize.js";

function yamlQuote(val) {
  return JSON.stringify(String(val ?? ""));
}

export function buildTxtContent(payload, loraStem) {
  const cleanLoraStem = sanitizeSegment(loraStem || payload.title || "LoRA_Model", 75);
  const triggerList = Array.isArray(payload.triggerWords) ? payload.triggerWords : [];
  const triggerStr = triggerList.length > 0 ? triggerList.join(", ") : "None (No trigger words required)";
  const loraTag = buildLoraTag(payload.fileName, payload.usageTips);

  const extraRowsText = Object.entries(payload.detailsTableExtras || {})
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  const lines = [
    "================================================================================",
    `MODEL TITLE:   ${payload.title}`,
    `VERSION:       ${payload.versionName}`,
    `FILENAME:      ${payload.fileName}`,
    `LORA TAG:      ${loraTag}`,
    payload.rawStorageFileName && payload.rawStorageFileName !== payload.fileName
      ? `STORAGE NAME:  ${payload.rawStorageFileName}`
      : null,
    `TRIGGER WORDS: ${triggerStr}`,
    "================================================================================",
    "",
    "[MODEL DETAILS]",
    `Page URL:      ${payload.pageUrl}`,
    `Model Type:    ${payload.modelType}`,
    `Base Model:    ${payload.baseModel}`,
    `File Format:   ${payload.fileFormat || "SafeTensor"} (${payload.fileSizeFormatted || "Unknown size"})`,
    `Training:      ${payload.training || "N/A"}`,
    `Usage Tips:    ${payload.usageTips || "N/A"}`,
    `Hash (AutoV2): ${payload.hashes?.AutoV2 || payload.hashes?.SHA256 || "N/A"}`,
    `SHA256:        ${payload.hashes?.SHA256 || "N/A"}`,
    `AIR ID:        ${payload.air || "N/A"}`,
    `Published:     ${payload.publishedAt || "N/A"}`,
    `Creator:       ${payload.creator || "N/A"}`,
    `Reviews/Stats: ${payload.reviews || ""} | ${payload.statsSummary || ""}`,
    `Tags:          ${(payload.tags || []).join(", ") || "N/A"}`,
    "",
    "[RAW DETAILS TABLE]",
    extraRowsText || "N/A",
    "",
    "================================================================================",
    "[DESCRIPTION]",
    "================================================================================",
    payload.descriptionText || "No description provided.",
    payload.versionDescriptionText
      ? `\n--- ABOUT THIS VERSION (${payload.versionName}) ---\n${payload.versionDescriptionText}`
      : "",
    "",
    "================================================================================",
    `[EXAMPLE MEDIA (${(payload.media || []).length} total)]`,
    "================================================================================",
    ...(payload.media || []).map((m, i) => {
      const localFile = m.localFileName || buildSafeMediaFilename(i, cleanLoraStem, m.extension);
      const p = m.meta?.prompt ? ` | Prompt: ${m.meta.prompt}` : "";
      return `#${String(i + 1).padStart(2, "0")} [${m.isVideo ? "VIDEO" : "IMAGE"}] ${localFile} -> ${m.downloadUrl}${p}`;
    })
  ];

  return lines.filter((line) => line !== null).join("\n");
}

export function buildMarkdownContent(payload, loraStem, settings = {}) {
  const cleanLoraStem = sanitizeSegment(loraStem || payload.title || "LoRA_Model", 75);
  const triggerList = Array.isArray(payload.triggerWords) ? payload.triggerWords : [];
  const triggerStr = triggerList.length > 0 ? triggerList.join(", ") : "None (No trigger words required)";
  const loraTag = buildLoraTag(payload.fileName, payload.usageTips);
  const weight = extractRecommendedWeight(payload.usageTips);
  const safePageUrl = sanitizeHttpUrl(payload.pageUrl, "");

  const frontmatter = [];
  if (settings.obsidianFrontmatter !== false) {
    frontmatter.push("---");
    frontmatter.push(`title: ${yamlQuote(payload.title)}`);
    frontmatter.push(`version: ${yamlQuote(payload.versionName)}`);
    frontmatter.push(`base_model: ${yamlQuote(payload.baseModel)}`);
    frontmatter.push(`type: ${yamlQuote(payload.modelType)}`);
    frontmatter.push(`file_name: ${yamlQuote(payload.fileName)}`);
    frontmatter.push(`lora_tag: ${yamlQuote(loraTag)}`);
    frontmatter.push(`strength: ${weight}`);
    frontmatter.push(`autov2: ${yamlQuote(payload.hashes?.AutoV2 || "")}`);
    frontmatter.push(`air: ${yamlQuote(payload.air || "")}`);
    frontmatter.push(`creator: ${yamlQuote(payload.creator || "")}`);
    frontmatter.push(`civitai_url: ${yamlQuote(safePageUrl)}`);
    frontmatter.push(`saved_at: ${yamlQuote(new Date().toISOString())}`);
    if (triggerList.length > 0) {
      frontmatter.push("triggers:");
      for (const tw of triggerList) frontmatter.push(`  - ${yamlQuote(tw)}`);
    } else {
      frontmatter.push("triggers: []");
    }
    if (Array.isArray(payload.tags) && payload.tags.length > 0) {
      frontmatter.push("tags:");
      for (const tag of payload.tags.slice(0, 20)) frontmatter.push(`  - ${yamlQuote(tag)}`);
    } else {
      frontmatter.push("tags: []");
    }
    frontmatter.push("---");
    frontmatter.push("");
  }

  const firstPreview = (payload.media || []).find((m) => !m.isVideo);
  const firstLocalName = firstPreview
    ? firstPreview.localFileName || buildSafeMediaFilename(0, cleanLoraStem, firstPreview.extension)
    : "";

  const mediaPromptsMd = (payload.media || [])
    .map((m, idx) => {
      const label = m.isVideo ? `Video #${idx + 1}` : `Image #${idx + 1}`;
      const localFile = m.localFileName || buildSafeMediaFilename(idx, cleanLoraStem, m.extension);
      const meta = m.meta || {};
      const promptLine = meta.prompt ? `\n  - **Prompt:** ${formatMarkdownCode(meta.prompt)}` : "";
      const negLine = meta.negativePrompt ? `\n  - **Negative Prompt:** ${formatMarkdownCode(meta.negativePrompt)}` : "";
      const paramsLine =
        meta.steps || meta.sampler || meta.cfgScale || meta.seed
          ? `\n  - **Params:** Steps: ${escapeMarkdownCell(meta.steps || "-")} | Sampler: ${escapeMarkdownCell(meta.sampler || "-")} | CFG: ${escapeMarkdownCell(meta.cfgScale || "-")} | Seed: ${escapeMarkdownCell(meta.seed || "-")}`
          : "";
      const cdnLink = sanitizeHttpUrl(m.downloadUrl, "#");
      return `- **${label}** ([Local File](${encodeURI(localFile)}) | [Civitai CDN](${cdnLink}))${promptLine}${negLine}${paramsLine}`;
    })
    .join("\n");

  const lines = [
    ...frontmatter,
    `# ${escapeMarkdownCell(payload.title)}`,
    "",
    `> **Version:** ${formatMarkdownCode(payload.versionName)} | **Base Model:** ${formatMarkdownCode(payload.baseModel)} | **Type:** ${formatMarkdownCode(payload.modelType)}`,
    ...(firstLocalName ? ["", `![[${firstLocalName}]]`] : []),
    "",
    "## Quick Copy Reference",
    "",
    "| Field | Value |",
    "| :--- | :--- |",
    `| **Model Title** | ${escapeMarkdownCell(payload.title)} |`,
    `| **Active Version** | ${escapeMarkdownCell(payload.versionName)} |`,
    `| **Full Filename** | ${formatMarkdownCode(payload.fileName)} |`,
    `| **LoRA Tag** | ${formatMarkdownCode(loraTag)} |`,
    `| **Trigger Words** | ${formatMarkdownCode(triggerStr)} |`,
    `| **Base Model** | ${escapeMarkdownCell(payload.baseModel)} |`,
    `| **Model Type** | ${escapeMarkdownCell(payload.modelType)} |`,
    `| **Training** | ${escapeMarkdownCell(payload.training || "N/A")} |`,
    `| **Usage Tips** | ${escapeMarkdownCell(payload.usageTips || "N/A")} |`,
    `| **Hash (AutoV2)** | ${formatMarkdownCode(payload.hashes?.AutoV2 || "N/A")} |`,
    `| **Hash (SHA256)** | ${formatMarkdownCode(payload.hashes?.SHA256 || "N/A")} |`,
    `| **AIR** | ${formatMarkdownCode(payload.air || "N/A")} |`,
    `| **File Info** | ${escapeMarkdownCell(payload.fileFormat || "SafeTensor")} (${escapeMarkdownCell(payload.fileSizeFormatted || "N/A")}) |`,
    `| **Published** | ${escapeMarkdownCell(payload.publishedAt || "N/A")} |`,
    `| **Creator** | ${escapeMarkdownCell(payload.creator || "N/A")} |`,
    `| **Reviews & Stats** | ${escapeMarkdownCell(payload.reviews || "N/A")} — ${escapeMarkdownCell(payload.statsSummary || "")} |`,
    `| **Tags** | ${escapeMarkdownCell((payload.tags || []).join(", ") || "N/A")} |`,
    `| **Civitai Page URL** | ${safePageUrl ? `[${escapeMarkdownCell(safePageUrl)}](${safePageUrl})` : "N/A"} |`,
    "",
    "## Description",
    "",
    payload.descriptionText || "_No description provided._",
    payload.versionDescriptionText
      ? `\n### About Version: ${escapeMarkdownCell(payload.versionName)}\n\n${payload.versionDescriptionText}`
      : "",
    "",
    `## Example Images & Videos (${(payload.media || []).length})`,
    "",
    mediaPromptsMd || "_No media items found._",
    ""
  ];

  return lines.join("\n");
}

export function buildCivitaiInfoJson(payload) {
  const obj = payload.rawVersionApiData || {
    id: payload.versionId,
    modelId: payload.modelId,
    name: payload.versionName,
    trainedWords: payload.triggerWords,
    baseModel: payload.baseModel,
    description: payload.versionDescriptionHtml || payload.descriptionHtml,
    model: {
      name: payload.title,
      type: payload.modelType,
      tags: payload.tags
    },
    files:
      Array.isArray(payload.files) && payload.files.length > 0
        ? payload.files
        : [
            {
              name: payload.fileName,
              primary: true,
              hashes: payload.hashes
            }
          ],
    images: (payload.media || []).map((m) => ({
      url: m.downloadUrl,
      type: m.type,
      meta: m.meta
    }))
  };
  return JSON.stringify(obj, null, 2);
}

export function buildJsonContent(payload) {
  const copy = { ...payload };
  delete copy.generatedFiles;
  return JSON.stringify(copy, null, 2);
}
