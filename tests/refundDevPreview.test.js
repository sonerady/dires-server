const test = require("node:test");
const assert = require("node:assert/strict");
const { enabled, createPreview } = require("../src/services/refundDevPreview");
test("preview needs explicit local development opt-in and cannot run in production/cloud", () => {
  assert.equal(enabled({}), false);
  assert.equal(enabled({ NODE_ENV: "development" }), false);
  assert.equal(
    enabled({ NODE_ENV: "production", CREDIT_REFUND_DEV_PREVIEW: "1" }),
    false,
  );
  assert.equal(
    enabled({
      NODE_ENV: "development",
      CREDIT_REFUND_DEV_PREVIEW: "1",
      RAILWAY_ENVIRONMENT_NAME: "production",
    }),
    false,
  );
  assert.equal(
    enabled({ NODE_ENV: "development", CREDIT_REFUND_DEV_PREVIEW: "1" }),
    true,
  );
});
test("every preview reruns vision and resets eligibility without persisted credits or claims", async () => {
  let calls = 0;
  const preview = createPreview({
    loadGeneration: async (user, id) =>
      user === "owner" && id === "gen"
        ? {
            created_at: "2020-01-01",
            credits_deducted: 20,
            reference_images: ["https://example.com/product.jpg"],
            result_image_url: "https://example.com/result.jpg",
          }
        : null,
    imageData: async (url) => url,
    vision: async () => {
      calls++;
      return {
        raw: JSON.stringify({
          product_match: 95,
          render_quality: 95,
          confidence: 0.99,
          severe_failure: false,
          failure_type: "none",
          evidence:
            "Product silhouette and all defining features match the original image.",
          reason_addressed: false,
          verdict: "no_refund",
          defects: [],
          summary: "No severe defect.",
        }),
      };
    },
  });
  const first = await preview.analyze("owner", "gen", "en");
  const second = await preview.analyze("owner", "gen", "en");
  assert.notEqual(first.id, second.id);
  assert.equal(calls, 2);
  assert.equal(first.devPreview, true);
  assert.equal(first.status, "rejected");
  assert.deepEqual((await preview.status("owner", "gen")).existing, null);
  assert.throws(
    () =>
      preview.appeal("other", first.id, "This is a long enough written appeal"),
    /appeal_unavailable/,
  );
  assert.throws(
    () => preview.appeal("owner", first.id, "short"),
    /invalid_appeal/,
  );
  assert.equal(
    preview.appeal("owner", first.id, "This is a long enough written appeal")
      .status,
    "appeal_pending",
  );
  assert.throws(
    () =>
      preview.appeal("owner", first.id, "This is a long enough written appeal"),
    /appeal_unavailable/,
  );
  assert.equal((await preview.status("owner", "gen")).eligible, true);
  await assert.rejects(
    preview.analyze("other", "gen", "en"),
    /no_product_photo/,
  );
});
