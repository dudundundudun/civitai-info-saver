import { escapeHtml, sanitizeHttpUrl } from "./sanitize.js";

const ALLOWED_TAGS = new Set([
  "p", "br", "div", "span", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "strong", "b", "em", "i", "u", "s", "del",
  "code", "pre", "blockquote", "hr", "a", "img", "table", "thead",
  "tbody", "tr", "th", "td", "figure", "figcaption", "details",
  "summary", "sup", "sub"
]);

const VOID_TAGS = new Set([
  "br", "hr", "img", "base", "meta", "link", "input", "embed", "param", "source", "track", "wbr", "area", "col"
]);

const RAW_TEXT_DROP_TAGS = new Set(["script", "style", "noscript", "template"]);

const DROP_CONTENT_TAGS = new Set([
  "script", "style", "iframe", "object", "embed", "base", "meta",
  "link", "form", "input", "button", "textarea", "select", "svg",
  "math", "template", "noscript"
]);

const BLOCK_NEWLINE_TAGS = new Set([
  "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "tr"
]);

function decodeBasicEntities(str) {
  return String(str || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    });
}

function parseAttributes(rawAttrStr) {
  const attrs = {};
  const attrRe = /([a-zA-Z_][\w:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = attrRe.exec(rawAttrStr)) !== null) {
    const name = match[1].toLowerCase();
    const val = decodeBasicEntities(match[2] ?? match[3] ?? match[4] ?? "");
    attrs[name] = val;
  }
  return attrs;
}

function renderAllowedAttrs(tagName, rawAttrs, baseOrigin) {
  const parts = [];
  if (tagName === "a") {
    const href = sanitizeHttpUrl(rawAttrs.href || "", "", baseOrigin);
    if (href) {
      parts.push(`href="${escapeHtml(href)}"`);
      parts.push('target="_blank"');
      parts.push('rel="noopener noreferrer"');
    }
    if (rawAttrs.title) parts.push(`title="${escapeHtml(rawAttrs.title)}"`);
  } else if (tagName === "img") {
    const src = sanitizeHttpUrl(rawAttrs["data-src"] || rawAttrs.src || "", "", baseOrigin);
    if (!src) return null; // Drop image without safe src
    parts.push(`src="${escapeHtml(src)}"`);
    if (rawAttrs.alt) parts.push(`alt="${escapeHtml(rawAttrs.alt)}"`);
    if (rawAttrs.title) parts.push(`title="${escapeHtml(rawAttrs.title)}"`);
    parts.push('loading="lazy"');
  } else if (tagName === "td" || tagName === "th") {
    if (rawAttrs.colspan && /^\d+$/.test(rawAttrs.colspan)) {
      parts.push(`colspan="${rawAttrs.colspan}"`);
    }
    if (rawAttrs.rowspan && /^\d+$/.test(rawAttrs.rowspan)) {
      parts.push(`rowspan="${rawAttrs.rowspan}"`);
    }
    if (rawAttrs.title) parts.push(`title="${escapeHtml(rawAttrs.title)}"`);
  } else if (rawAttrs.title) {
    parts.push(`title="${escapeHtml(rawAttrs.title)}"`);
  }
  return parts.length > 0 ? " " + parts.join(" ") : "";
}

function sanitizeViaDomParser(html, baseOrigin) {
  const doc = new DOMParser().parseFromString(String(html), "text/html");

  function serializeChildren(parentNode) {
    let out = "";
    for (const child of parentNode.childNodes) {
      if (child.nodeType === 3) {
        out += escapeHtml(child.nodeValue || "");
      } else if (child.nodeType === 1) {
        const tag = child.tagName.toLowerCase();
        if (DROP_CONTENT_TAGS.has(tag)) continue;
        if (!ALLOWED_TAGS.has(tag)) {
          out += serializeChildren(child);
          continue;
        }
        const attrMap = {};
        for (const attr of child.attributes) {
          attrMap[attr.name.toLowerCase()] = attr.value;
        }
        const attrStr = renderAllowedAttrs(tag, attrMap, baseOrigin);
        if (attrStr === null) continue;
        if (VOID_TAGS.has(tag)) {
          out += `<${tag}${attrStr} />`;
        } else {
          out += `<${tag}${attrStr}>${serializeChildren(child)}</${tag}>`;
        }
      }
    }
    return out;
  }

  return serializeChildren(doc.body);
}

function sanitizeViaTokenizer(html, baseOrigin) {
  const input = String(html);
  const tagStack = [];
  const dropStack = [];
  let out = "";
  let pos = 0;

  while (pos < input.length) {
    const lt = input.indexOf("<", pos);
    if (lt === -1) {
      if (dropStack.length === 0) out += escapeHtml(decodeBasicEntities(input.slice(pos)));
      break;
    }
    if (lt > pos && dropStack.length === 0) {
      out += escapeHtml(decodeBasicEntities(input.slice(pos, lt)));
    }

    if (input.startsWith("<!--", lt)) {
      const endComment = input.indexOf("-->", lt + 4);
      pos = endComment === -1 ? input.length : endComment + 3;
      continue;
    }

    // Scan tag end respecting quoted attributes
    let i = lt + 1;
    let quote = null;
    while (i < input.length) {
      const ch = input[i];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        break;
      }
      i++;
    }
    if (i >= input.length) {
      if (dropStack.length === 0) out += escapeHtml(input.slice(lt));
      break;
    }

    const rawTag = input.slice(lt + 1, i).trim();
    pos = i + 1;
    if (!rawTag || rawTag.startsWith("!") || rawTag.startsWith("?")) continue;

    const isClosing = rawTag.startsWith("/");
    const body = isClosing ? rawTag.slice(1).trim() : rawTag;
    const nameMatch = body.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
    if (!nameMatch) continue;
    const tag = nameMatch[1].toLowerCase();
    const selfClosing = !isClosing && (rawTag.endsWith("/") || VOID_TAGS.has(tag));

    if (isClosing) {
      if (dropStack.length > 0) {
        if (dropStack[dropStack.length - 1] === tag) dropStack.pop();
        continue;
      }
      if (ALLOWED_TAGS.has(tag) && !VOID_TAGS.has(tag)) {
        const idx = tagStack.lastIndexOf(tag);
        if (idx !== -1) {
          while (tagStack.length > idx) {
            out += `</${tagStack.pop()}>`;
          }
        }
      }
      continue;
    }

    if (DROP_CONTENT_TAGS.has(tag)) {
      if (RAW_TEXT_DROP_TAGS.has(tag) && !selfClosing) {
        const closeRe = new RegExp(`</${tag}\\s*>`, "i");
        const rest = input.slice(pos);
        const m = closeRe.exec(rest);
        pos = m ? pos + m.index + m[0].length : input.length;
      } else if (!selfClosing && !VOID_TAGS.has(tag)) {
        dropStack.push(tag);
      }
      continue;
    }
    if (dropStack.length > 0) continue;
    if (!ALLOWED_TAGS.has(tag)) continue;

    const attrStrRaw = body.slice(nameMatch[1].length).replace(/\/$/, "");
    const attrMap = parseAttributes(attrStrRaw);
    const renderedAttrs = renderAllowedAttrs(tag, attrMap, baseOrigin);
    if (renderedAttrs === null) continue;

    if (VOID_TAGS.has(tag)) {
      out += `<${tag}${renderedAttrs} />`;
    } else if (selfClosing) {
      out += `<${tag}${renderedAttrs}></${tag}>`;
    } else {
      tagStack.push(tag);
      out += `<${tag}${renderedAttrs}>`;
    }
  }

  while (tagStack.length > 0) {
    out += `</${tagStack.pop()}>`;
  }
  return out;
}

/**
 * Sanitizes untrusted HTML descriptions against XSS using a strict tag/attribute allowlist.
 * Safe in both browser DOM (without firing eager network loads) and Node/Service Worker.
 */
export function sanitizeDescriptionHtml(html, baseOrigin = "https://civitai.com") {
  if (!html) return "";
  if (typeof DOMParser !== "undefined") {
    return sanitizeViaDomParser(html, baseOrigin);
  }
  return sanitizeViaTokenizer(html, baseOrigin);
}

/**
 * Converts HTML into clean readable plain text without executing scripts or fetching resources.
 */
export function htmlToCleanText(html, baseOrigin = "https://civitai.com") {
  if (!html) return "";
  const safeHtml = sanitizeDescriptionHtml(html, baseOrigin);
  let out = "";
  let pos = 0;
  const linkStack = [];

  while (pos < safeHtml.length) {
    const lt = safeHtml.indexOf("<", pos);
    if (lt === -1) {
      const chunk = decodeBasicEntities(safeHtml.slice(pos));
      if (linkStack.length > 0) linkStack[linkStack.length - 1].text += chunk;
      else out += chunk;
      break;
    }
    if (lt > pos) {
      const chunk = decodeBasicEntities(safeHtml.slice(pos, lt));
      if (linkStack.length > 0) linkStack[linkStack.length - 1].text += chunk;
      else out += chunk;
    }
    const gt = safeHtml.indexOf(">", lt);
    if (gt === -1) break;
    const rawTag = safeHtml.slice(lt + 1, gt).trim();
    pos = gt + 1;

    const isClosing = rawTag.startsWith("/");
    const nameMatch = (isClosing ? rawTag.slice(1) : rawTag).match(/^([a-z0-9]+)/i);
    if (!nameMatch) continue;
    const tag = nameMatch[1].toLowerCase();

    if (!isClosing) {
      if (tag === "br") {
        out += "\n";
      } else if (tag === "li") {
        out += "\n• ";
      } else if (BLOCK_NEWLINE_TAGS.has(tag)) {
        out += "\n";
      } else if (tag === "a") {
        const attrs = parseAttributes(rawTag.slice(nameMatch[1].length));
        linkStack.push({ href: attrs.href || "", text: "" });
      }
    } else {
      if (tag === "a" && linkStack.length > 0) {
        const link = linkStack.pop();
        const txt = link.text.trim();
        if (link.href && txt && txt !== link.href) {
          out += `${txt} (${link.href})`;
        } else {
          out += link.text;
        }
      } else if (BLOCK_NEWLINE_TAGS.has(tag) || tag === "ul" || tag === "ol") {
        out += "\n";
      }
    }
  }

  return out
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
