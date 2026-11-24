import assert from "node:assert/strict";
import test from "node:test";
import { htmlToCleanText, sanitizeDescriptionHtml } from "../src/shared/htmlSanitizer.js";
import {
  buildLoraTag,
  escapeCsvCell,
  escapeMarkdownCell,
  formatMarkdownCode,
  sanitizeHttpUrl,
  sanitizeSegment,
  serializeJsonForScript
} from "../src/shared/sanitize.js";

test("sanitizeSegment preserves balanced parentheses for brackets and guards Windows reserved names", () => {
  assert.equal(sanitizeSegment("[Flux] My LoRA v1.0"), "(Flux) My LoRA v1.0");
  assert.equal(sanitizeSegment("CON"), "CON_");
  assert.equal(sanitizeSegment("nul"), "nul_");
  assert.equal(sanitizeSegment("COM1"), "COM1_");
  assert.equal(sanitizeSegment("...my-model..."), "my-model");
  assert.equal(sanitizeSegment(""), "Unknown");
});

test("sanitizeHttpUrl allows http/https and blocks javascript/data/vbscript", () => {
  assert.equal(sanitizeHttpUrl("https://civitai.com/models/123"), "https://civitai.com/models/123");
  assert.equal(sanitizeHttpUrl("/models/42", "#", "https://civitai.red"), "https://civitai.red/models/42");
  assert.equal(sanitizeHttpUrl("javascript:alert(1)", "#"), "#");
  assert.equal(sanitizeHttpUrl("data:text/html,<script>alert(1)</script>", "#"), "#");
});

test("serializeJsonForScript escapes closing script tags with spaces and HTML comments", () => {
  const payload = { text: "</script ><!-- inject -->" };
  const serialized = serializeJsonForScript(payload);
  assert.ok(!serialized.includes("</script"));
  assert.ok(!serialized.includes("<!--"));
  assert.deepEqual(JSON.parse(serialized), payload);
});

test("sanitizeDescriptionHtml strips dangerous tags, event handlers, and unsafe URLs", () => {
  const dirty = `
    <base href="https://evil.test/">
    <meta http-equiv="refresh" content="0;url=https://evil.test">
    <svg onload="alert(1)"><script>alert(2)</script></svg>
    <p onclick="evil()">Hello <a href="javascript:alert(1)">bad</a> and <a href="/models/99">good</a></p>
    <img src="data:image/svg+xml,<svg/>" onerror="alert(3)" />
    <img src="https://image.civitai.com/pic.jpg" alt="ok" onerror="alert(4)" />
  `;
  const clean = sanitizeDescriptionHtml(dirty, "https://civitai.com");
  assert.ok(!clean.includes("<base"));
  assert.ok(!clean.includes("<meta"));
  assert.ok(!clean.includes("<svg"));
  assert.ok(!clean.includes("<script"));
  assert.ok(!clean.includes("onclick"));
  assert.ok(!clean.includes("onerror"));
  assert.ok(!clean.includes("javascript:"));
  assert.ok(!clean.includes("data:image/svg"));
  assert.ok(clean.includes('href="https://civitai.com/models/99"'));
  assert.ok(clean.includes('src="https://image.civitai.com/pic.jpg"'));
  assert.ok(clean.includes("Hello"));
});

test("htmlToCleanText formats links and blocks cleanly", () => {
  const text = htmlToCleanText('<p>Line 1<br>Line 2</p><ul><li><a href="https://civitai.com">Civitai</a></li></ul>');
  assert.ok(text.includes("Line 1\nLine 2"));
  assert.ok(text.includes("• Civitai (https://civitai.com/)"));
});

test("markdown, csv, and lora tag helpers escape unsafe constructs", () => {
  assert.equal(escapeMarkdownCell("a | b\nc"), "a \\| b c");
  assert.equal(formatMarkdownCode("hello `world`"), "`` hello `world` ``");
  assert.equal(formatMarkdownCode("`edge`"), "`` `edge` ``");
  assert.equal(escapeCsvCell("=CMD()"), `"'=CMD()"`);
  assert.equal(escapeCsvCell('He said "hi"'), '"He said ""hi"""');
  assert.equal(buildLoraTag("Flux_Style_v2.safetensors", "STRENGTH: 0.75"), "<lora:Flux_Style_v2:0.75>");
});
