const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../src/routes/referenceBrowserRoutesV7.js"),
  "utf8",
);

test("normal-mode camera guidance offers conditional studio and editorial styles", () => {
  assert.ok(
    source.includes(
      "Choose a camera, lens character, viewpoint, depth of field, lighting approach, and color treatment",
    ),
  );

  for (const conditionalStyle of [
    "clean high-key commercial grade",
    "balanced three-point softbox lighting",
    "medium-format film character with subtle fine grain",
    "Use these only when they genuinely suit the garment, location, and intended mood; never apply them as a default recipe.",
  ]) {
    assert.ok(source.includes(conditionalStyle), `include ${conditionalStyle}`);
  }

  assert.ok(!source.includes("white-background"));
});
