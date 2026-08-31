const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeCreationMode } = require("../src/utils/creationMode");

test("normalizeCreationMode accepts the two persisted modes", () => {
  assert.equal(normalizeCreationMode("crystal"), "crystal");
  assert.equal(normalizeCreationMode(" Canvas "), "canvas");
});

test("normalizeCreationMode rejects legacy and untrusted values", () => {
  assert.equal(normalizeCreationMode("legacy"), null);
  assert.equal(normalizeCreationMode("other"), null);
  assert.equal(normalizeCreationMode(undefined), null);
});
