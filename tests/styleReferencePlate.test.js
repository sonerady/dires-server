const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const {
  STYLE_REFERENCE_PLATE_VARIANT,
  isCurrentStyleReferencePlateUrl,
  stampStyleReferencePlate,
} = require("../src/utils/styleReferenceImage");

test("style reference plate stays compact and preserves the photograph width", async () => {
  const input = await sharp({
    create: {
      width: 320,
      height: 480,
      channels: 3,
      background: "#d8d8d8",
    },
  })
    .jpeg()
    .toBuffer();

  const output = await stampStyleReferencePlate(input);
  const metadata = await sharp(output).metadata();

  assert.equal(metadata.width, 320);
  assert.equal(metadata.height, 520);
});

test("plate cache revision rejects old oversized cached grids", () => {
  assert.equal(STYLE_REFERENCE_PLATE_VARIANT, "compact-v2");
  assert.equal(
    isCurrentStyleReferencePlateUrl(
      `https://example.com/style_profile_grid_id_${STYLE_REFERENCE_PLATE_VARIANT}_abc.jpg`,
    ),
    true,
  );
  assert.equal(
    isCurrentStyleReferencePlateUrl(
      "https://example.com/style_profile_grid_id_oldstamp_abc.jpg",
    ),
    false,
  );
});

test("active V7 routes fit the label inside the compact plate and version caches", () => {
  for (const file of [
    "referenceBrowserRoutesV7.js",
    "referenceJewelryBrowserRoutesV7.js",
  ]) {
    const source = fs.readFileSync(
      path.join(__dirname, "../src/routes", file),
      "utf8",
    );

    assert.match(source, /SH \* 0\.045/);
    assert.match(source, /textLength="\$\{plateTextWidth\}"/);
    assert.match(source, /dominant-baseline="middle"/);
    assert.match(source, /STYLE_REFERENCE_PLATE_VARIANT/);
    assert.match(source, /isCurrentStyleReferencePlateUrl/);
  }
});
