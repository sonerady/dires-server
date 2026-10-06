const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { selectToolEditModel, NB2_EDIT_MODEL, NBPRO_EDIT_MODEL } = require("../src/utils/nb2ToolEdit");

test("v1 → nano-banana-2 1K, v2 → nano-banana-pro 2K", () => {
  assert.deepEqual(selectToolEditModel("v1"), { model: NB2_EDIT_MODEL, resolution: "1K" });
  assert.deepEqual(selectToolEditModel("v2"), { model: NBPRO_EDIT_MODEL, resolution: "2K" });
  // Bilinmeyen/boş değer güvenli tarafta kalır (v1).
  assert.deepEqual(selectToolEditModel(null), { model: NB2_EDIT_MODEL, resolution: "1K" });
  assert.deepEqual(selectToolEditModel("V2"), { model: NB2_EDIT_MODEL, resolution: "1K" });
});

test("renk/poz/arka taraf rotaları sabit 2K yerine seçilen çözünürlüğü kullanıyor", () => {
  for (const name of [
    "changePose",
    "changePoseWeb",
    "changeProductColor",
    "changeProductColorWeb",
    "backSideCloset",
    "backSideClosetWeb",
  ]) {
    const src = fs.readFileSync(path.join(__dirname, `../src/routes/${name}.js`), "utf8");
    assert.ok(src.includes("selectToolEditModel"), `${name}: seçici kullanılmalı`);
    assert.ok(
      !/resolution: "2K", \/\/ 2K çözünürlük/.test(src),
      `${name}: sabit 2K satırı kalmamalı`,
    );
  }
});
