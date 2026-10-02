const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizePhotoSwapMode,
  nearestSupportedRatio,
  buildPhotoSwapPrompt,
  hasLocationTarget,
} = require("../src/utils/photoSwapPrompt");

test("mode normalization accepts only model/location", () => {
  assert.equal(normalizePhotoSwapMode("Model"), "model");
  assert.equal(normalizePhotoSwapMode(" location "), "location");
  assert.equal(normalizePhotoSwapMode("pose"), null);
  assert.equal(normalizePhotoSwapMode(undefined), null);
});

test("source framing is kept with the nearest supported ratio", () => {
  assert.equal(nearestSupportedRatio(1536, 2752), "9:16");
  assert.equal(nearestSupportedRatio(1200, 1600), "3:4");
  assert.equal(nearestSupportedRatio(2000, 2000), "1:1");
  assert.equal(nearestSupportedRatio(0, 10), "3:4");
});

test("model swap with a reference locks identity to image 2 and keeps everything else", () => {
  const prompt = buildPhotoSwapPrompt("model", { hasModelReference: true, settings: {}, customDetail: "  soft smile " });
  assert.match(prompt, /MODEL SWAP/);
  assert.match(prompt, /IMAGE 2 is the MODEL REFERENCE/);
  assert.match(prompt, /PRODUCT LOCK/);
  assert.match(prompt, /never copy its clothing/);
  assert.match(prompt, /USER DETAIL .*soft smile$/);
});

test("model swap without a reference describes a new person from gender/age", () => {
  const prompt = buildPhotoSwapPrompt("model", { hasModelReference: false, settings: { gender: "male", age: "young" } });
  assert.match(prompt, /clearly DIFFERENT model — a man, in their early twenties/);
  assert.doesNotMatch(prompt, /IMAGE 2/);
});

test("location swap supports venue image, text and solid colour", () => {
  const venue = buildPhotoSwapPrompt("location", { hasLocationReference: true, settings: { location: "Paris café" } });
  assert.match(venue, /labelled "Location"/);
  assert.match(venue, /Paris café/);
  const text = buildPhotoSwapPrompt("location", { hasLocationReference: false, settings: { location: "Rooftop at dusk", weather: "rainy" } });
  assert.match(text, /NEW LOCATION: Rooftop at dusk/);
  assert.match(text, /ATMOSPHERE: weather: rainy/);
  const colour = buildPhotoSwapPrompt("location", { settings: { backgroundColorHex: "e8d5c4", location: "Beige" } });
  assert.match(colour, /solid colour #E8D5C4/);
  assert.doesNotMatch(colour, /IMAGE 2/);
});

test("model and location swap retain custom details beyond the former character limit", () => {
  const customDetail = "Use gentle natural lighting. ".repeat(160) + "Keep this final preference.";
  for (const mode of ["model", "location"]) {
    assert.ok(buildPhotoSwapPrompt(mode, { customDetail }).endsWith(customDetail), mode);
  }
});

test("location target detection", () => {
  assert.equal(hasLocationTarget({}, null), false);
  assert.equal(hasLocationTarget({ location: "Beach" }, null), true);
  assert.equal(hasLocationTarget({}, "https://x/y.jpg"), true);
  assert.equal(hasLocationTarget({ backgroundColorHex: "#112233" }, null), true);
});
