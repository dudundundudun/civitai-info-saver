import assert from "node:assert/strict";
import test from "node:test";
import { buildGeneratedFiles } from "../src/exporters/index.js";
import { buildCsvExport, buildStandaloneCatalogHtml } from "../src/storage/databaseRepo.js";

const samplePayload = {
  modelId: "101",
  versionId: "202",
  title: "Cyber | Portrait",
  versionName: "v1.5",
  fileName: "cyber_portrait_v15.safetensors",
  fileFormat: "fp16 SafeTensor",
  fileSizeFormatted: "144.20 MB",
  files: [
    { name: "cyber_portrait_v15.safetensors", format: "fp16 SafeTensor", sizeFormatted: "144.20 MB", primary: true },
    { name: "cyber_portrait_fp8.safetensors", format: "fp8 SafeTensor", sizeFormatted: "72.10 MB", primary: false }
  ],
  triggerWords: ["cybport", "neon | glow"],
  modelType: "LORA",
  baseModel: "Flux.1 D",
  training: "Steps: 2400",
  usageTips: "STRENGTH: 0.85",
  hashes: { AutoV2: "ABCD1234EF", SHA256: "001122334455" },
  air: "civitai:101@202",
  publishedAt: "2025-10-01",
  creator: "artist",
  tags: ["cyberpunk", "portrait"],
  pageUrl: "https://civitai.com/models/101?modelVersionId=202",
  rawDescriptionHtml: '<p>Test description</p><script>alert("xss")</script>',
  descriptionText: "Test description",
  stats: { downloadCount: 500, thumbsUpCount: 120, tippedAmountCount: 0 },
  media: [
    {
      index: 1,
      isVideo: false,
      localFileName: "01_Cyber - Portrait.jpeg",
      extension: "jpeg",
      displayUrl: "https://image.civitai.com/img1.jpeg",
      downloadUrl: "https://image.civitai.com/img1.jpeg",
      meta: { prompt: "a | `neon` portrait", negativePrompt: "blurry", steps: 20 }
    },
    {
      index: 2,
      isVideo: true,
      localFileName: "02_Cyber - Portrait.mp4",
      extension: "mp4",
      displayUrl: "https://image.civitai.com/vid2.mp4",
      downloadUrl: "https://image.civitai.com/vid2.mp4",
      posterUrl: "https://image.civitai.com/vid2.jpeg",
      meta: {}
    }
  ]
};

test("buildGeneratedFiles emits Obsidian YAML, safe MD table, multi-file offline HTML without inline handlers", () => {
  const files = buildGeneratedFiles(samplePayload, "Cyber - Portrait", { obsidianFrontmatter: true });

  // Obsidian YAML frontmatter & safe Markdown escaping
  assert.ok(files.md.startsWith("---\n"));
  assert.ok(files.md.includes('lora_tag: "<lora:cyber_portrait_v15:0.85>"'));
  assert.ok(files.md.includes("![[01_Cyber - Portrait.jpeg]]"));
  assert.ok(files.md.includes("Cyber \\| Portrait"));
  assert.ok(files.md.includes("``a | `neon` portrait``"));

  // Offline HTML security & accessibility assertions
  assert.ok(!files.html.includes("<script>alert"));
  assert.ok(!/on(?:click|error|input)=/i.test(files.html));
  assert.ok(files.html.includes('<dialog id="civ-lightbox"'));
  assert.ok(files.html.includes("cyber_portrait_fp8.safetensors"));
  assert.ok(files.html.includes("&lt;lora:cyber_portrait_v15:0.85&gt;"));
  assert.ok(!files.html.includes("⚡ 500")); // No fake Buzz equal to download count
});

test("buildCsvExport includes UTF-8 BOM and formula neutralization", () => {
  const csv = buildCsvExport([{ ...samplePayload, notes: "=1+1" }]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes(`"'=1+1"`));
  assert.ok(csv.includes("<lora:cyber_portrait_v15:0.85>"));
});

test("buildStandaloneCatalogHtml uses safe JSON serialization and zero inline handlers", () => {
  const html = buildStandaloneCatalogHtml([
    { ...samplePayload, key: "101_202", notes: "</script><img src=x onerror=alert(1)>" }
  ]);
  const outsideScript = html.replace(/<script>[\s\S]*?<\/script>/g, "");
  assert.ok(!/on(?:click|error|input)=/i.test(outsideScript));
  assert.ok(!html.includes("</script><img"));
  assert.ok(html.includes("\\u003c/script\\u003e\\u003cimg"));
});
