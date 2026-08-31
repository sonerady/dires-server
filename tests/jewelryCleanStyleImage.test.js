const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  JEWELRY_CLEAN_MODEL,
  JEWELRY_CLEAN_PROMPT,
  runJewelryCleanEdit,
} = require("../src/utils/jewelryCleanStyleImage");

test("sends live jewelry cleanup to fal nano-banana-lite with the shared prompt", async () => {
  let call = null;
  const fakeFal = {
    subscribe: async (model, options) => {
      call = { model, options };
      return {
        data: { images: [{ url: "https://example.com/clean.png" }] },
        requestId: "test-request",
      };
    },
  };

  const output = await runJewelryCleanEdit(
    "https://example.com/original.jpg",
    fakeFal,
  );

  assert.equal(output, "https://example.com/clean.png");
  assert.equal(call.model, "google/nano-banana-lite/edit");
  assert.equal(call.model, JEWELRY_CLEAN_MODEL);
  assert.deepEqual(call.options.input.image_urls, [
    "https://example.com/original.jpg",
  ]);
  assert.equal(call.options.input.aspect_ratio, "auto");
  assert.equal(call.options.input.num_images, 1);
  assert.equal(call.options.input.output_format, "png");
  assert.equal(call.options.input.safety_tolerance, "6");
  assert.equal(call.options.input.limit_generations, true);
  assert.equal(call.options.logs, true);
  assert.equal(call.options.input.prompt, JEWELRY_CLEAN_PROMPT);
  assert.match(call.options.input.prompt, /Remove all jewelry/i);
  assert.match(call.options.input.prompt, /full-bleed/i);
  assert.match(call.options.input.prompt, /without border strips/i);
});

test("retries a rejected fal edit with the concise fallback prompt", async () => {
  const calls = [];
  const fakeFal = {
    subscribe: async (model, options) => {
      calls.push({ model, options });
      if (calls.length === 1) {
        const error = new Error("Unprocessable Entity");
        error.status = 422;
        throw error;
      }
      return { data: { images: [{ url: "https://example.com/retry.png" }] } };
    },
  };

  const output = await runJewelryCleanEdit(
    "https://example.com/original.jpg",
    fakeFal,
  );

  assert.equal(output, "https://example.com/retry.png");
  assert.equal(calls.length, 2);
  assert.match(calls[1].options.input.prompt, /Keep everything else unchanged/i);
});

test("browser extension sends auto-style hierarchy in the initial create request", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../auto-style-clipper/background.js"),
    "utf8",
  );

  assert.match(source, /function buildAutoMeta\(settings\)/);
  assert.match(source, /\.\.\.buildAutoMeta\(settings\)/);
  assert.match(source, /createAutoStyle\(apiBase, imagePayload, settings\)/);
  assert.doesNotMatch(source, /await applyDefaultMeta\(/);
});

test("style profile route cleans extension jewelry before inserting the row", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/routes/styleProfileRouterFactory.js"),
    "utf8",
  );
  const cleanIndex = source.indexOf("jewelryCleanImageUrls = await Promise.all(");
  const insertIndex = source.indexOf(".insert({", cleanIndex);

  assert.ok(cleanIndex >= 0);
  assert.ok(insertIndex > cleanIndex);
  assert.match(source, /normalizedCategory === "jewelry"/);
  assert.match(source, /jewelry_clean_image_urls: jewelryCleanImageUrls/);
  assert.match(source, /product_subtype: normalizedSubtype/);
  assert.match(source, /style_approach: normalizedApproach/);
});
