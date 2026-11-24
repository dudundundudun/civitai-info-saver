import { buildOfflineHtml } from "./offlineHtml.js";
import {
  buildCivitaiInfoJson,
  buildJsonContent,
  buildMarkdownContent,
  buildTxtContent
} from "./textExporters.js";

export function buildGeneratedFiles(payload, loraStem, settings = {}) {
  return {
    txt: buildTxtContent(payload, loraStem),
    md: buildMarkdownContent(payload, loraStem, settings),
    json: buildJsonContent(payload),
    civitaiInfo: buildCivitaiInfoJson(payload),
    html: buildOfflineHtml(payload, loraStem)
  };
}
