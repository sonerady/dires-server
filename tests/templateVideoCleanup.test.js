const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cleanupTemplateVideos } = require("../src/services/templateVideoCleanup");

const now = Date.parse("2026-09-29T12:00:00Z");
const ago = (h) => new Date(now - h * 3600000).toISOString();
function db(rows) {
  const removed = [];
  return { removed, storage: { from: () => ({
    list: async (_prefix, { limit, offset }) => ({ data: rows.slice(offset, offset + limit), error: null }),
    remove: async (paths) => { removed.push(...paths); return { error: null }; },
  }) } };
}

test("removes only template videos older than 24 hours (last write wins)", async () => {
  const d = db([
    { id: "1", name: "old.mp4", created_at: ago(30), updated_at: ago(30) },
    { id: "2", name: "fresh.mp4", created_at: ago(2), updated_at: ago(2) },
    { id: "3", name: "rewritten.mp4", created_at: ago(40), updated_at: ago(3) },
    { id: null, name: "folder" },
    { id: "4", name: "edge.mp4", created_at: ago(24), updated_at: ago(24) },
  ]);
  const r = await cleanupTemplateVideos(d, { now, logger: { log() {}, error() {} } });
  assert.deepEqual(d.removed.sort(), ["bannerStudio/templateVideos/edge.mp4", "bannerStudio/templateVideos/old.mp4"]);
  assert.equal(r.removed, 2);
});

test("pages through more than one listing page", async () => {
  const rows = Array.from({ length: 1500 }, (_, i) => ({ id: String(i), name: `v${i}.mp4`, created_at: ago(48), updated_at: ago(48) }));
  const d = db(rows);
  const r = await cleanupTemplateVideos(d, { now, logger: { log() {}, error() {} } });
  assert.equal(r.removed, 1500);
});
