================================================================================
CIVITAI MODEL INFO & MEDIA SAVER v1.6 - CHROME EXTENSION (MANIFEST V3)
================================================================================

HOW TO INSTALL IN CHROME / BRAVE / EDGE (TAKES 15 SECONDS):
1. Unzip `civitai-info-saver-v1.6.zip` into a folder on your computer.
2. Open Chrome and go to:  chrome://extensions/
3. Turn ON the "Developer mode" toggle in the top-right corner.
4. Click "Load unpacked" (top-left button) and select the unzipped folder.
5. Visit any Civitai model page (e.g. https://civitai.com/models/...) — you will
   see the "Civitai Info & Media Saver" panel directly below the Download button
   and above the Details section!

WHAT'S NEW IN v1.6:
- Automatic Folder & DB Duplicate Detection: Checks your Documents/civitred
  folder (and local database / Downloads) as soon as you open a model page and
  displays a clear banner if the LoRA is already downloaded.
- Smart Skip Existing Media: Avoids re-downloading images/videos that already
  exist in the target folder (configurable via checkbox).
- Parallel Media Downloads (4x concurrency) for much faster saving.
- Optional `<filename>.preview.<ext>` copy for A1111 / Forge / ComfyUI.
- Security & stability fixes: HTML/onclick escaping, live settings sync with
  popup, debounced DOM observer, and database record deletion.
