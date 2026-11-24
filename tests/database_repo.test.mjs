import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteRecord,
  getAllRecords,
  importRecords,
  resolveSafePreviewUrl,
  restoreRecord,
  updateRecordMeta,
  upsertRecord
} from "../src/storage/databaseRepo.js";

function createMemoryStorage(initial = {}) {
  const state = { ...initial };
  return {
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) {
        if (k in state) out[k] = structuredClone(state[k]);
      }
      return out;
    },
    async set(patch) {
      for (const [k, v] of Object.entries(patch)) {
        state[k] = structuredClone(v);
      }
    }
  };
}

test("resolveSafePreviewUrl picks posterUrl instead of .mp4 for video-only models", () => {
  const url = resolveSafePreviewUrl([
    { isVideo: true, displayUrl: "https://image.civitai.com/video.mp4", posterUrl: "https://image.civitai.com/poster.jpeg" }
  ]);
  assert.equal(url, "https://image.civitai.com/poster.jpeg");

  const noPoster = resolveSafePreviewUrl([
    { isVideo: true, displayUrl: "https://image.civitai.com/video.mp4", posterUrl: "" }
  ]);
  assert.equal(noPoster, "");
});

test("concurrent upsertRecord calls do not clobber each other and preserve user notes/favorites", async () => {
  const storage = createMemoryStorage({ cisDatabase: [] });

  await Promise.all([
    upsertRecord({ modelId: "1", versionId: "10", title: "Model One", media: [] }, "civitred/One", storage),
    upsertRecord({ modelId: "2", versionId: "20", title: "Model Two", media: [] }, "civitred/Two", storage),
    upsertRecord({ modelId: "3", versionId: "30", title: "Model Three", media: [] }, "civitred/Three", storage)
  ]);

  let all = await getAllRecords(storage);
  assert.equal(all.length, 3);

  await updateRecordMeta("1_10", { notes: "Best at 0.7", favorite: true }, storage);
  await upsertRecord({ modelId: "1", versionId: "10", title: "Model One Updated", media: [] }, "civitred/One", storage);

  all = await getAllRecords(storage);
  const rec1 = all.find((r) => r.key === "1_10");
  assert.equal(rec1.title, "Model One Updated");
  assert.equal(rec1.notes, "Best at 0.7");
  assert.equal(rec1.favorite, true);
});

test("deleteRecord + restoreRecord supports Undo and importRecords merges cleanly", async () => {
  const storage = createMemoryStorage({ cisDatabase: [] });
  await upsertRecord({ modelId: "10", versionId: "100", title: "Alpha", media: [] }, "civitred/Alpha", storage);
  await upsertRecord({ modelId: "20", versionId: "200", title: "Beta", media: [] }, "civitred/Beta", storage);

  const del = await deleteRecord("10_100", storage);
  assert.equal(del.totalInDb, 1);
  assert.equal(del.deletedRecord.title, "Alpha");

  await restoreRecord(del.deletedRecord, del.deletedIndex, storage);
  let all = await getAllRecords(storage);
  assert.equal(all.length, 2);

  const imp = await importRecords(
    [
      { key: "10_100", title: "Alpha", notes: "Imported note" },
      { key: "30_300", title: "Gamma", modelId: "30", versionId: "300" }
    ],
    "merge",
    storage
  );
  assert.equal(imp.added, 1);
  assert.equal(imp.updated, 1);
  all = await getAllRecords(storage);
  assert.equal(all.length, 3);
});
