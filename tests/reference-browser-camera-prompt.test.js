const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../src/routes/referenceBrowserRoutesV7.js"),
  "utf8",
);

test("normal-mode camera guidance is adaptive rather than a fixed recipe", () => {
  assert.ok(
    source.includes(
      "Choose a camera, lens character, viewpoint, depth of field, lighting approach, and color treatment",
    ),
  );

  for (const fixedRecipe of [
    "three-point softbox",
    "85mm f/2.8",
    "clean high-key commercial grade",
    "medium-format film with fine grain",
  ]) {
    assert.ok(!source.includes(fixedRecipe), `remove ${fixedRecipe}`);
  }
});
