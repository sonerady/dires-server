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
// 24 Eyl 2026 (kullanıcı isteği): onay ya da ret alan fotoğraf bir daha analiz edilmez —
// önizleme kararı bellekte tutar (kayıt/kredi yine yok), status onu `existing` döndürür.
test("preview decides a photo once, remembers it without persisted credits or claims", async () => {
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
    // ⚖️ 25 Eyl 2026: önizleme de Opus hakemini kullanır — sahte hakem yanıtı
    judge: async () => {
      calls++;
      return {
        model: "test",
        raw: JSON.stringify({
          product_type: "dress",
          attributes: [
            { name: "category", original: "dress", result: "dress", status: "same", intended: false },
            { name: "length", original: "knee", result: "knee", status: "same", intended: false },
          ],
          anatomy: [],
          render: { severity: "none", issue: "" },
          decision: "no_refund",
          decisive_finding: "Product silhouette and all defining features match the original image.",
          summary: "No severe defect.",
        }),
      };
    },
  });
  const first = await preview.analyze("owner", "gen", "en");
  const second = await preview.analyze("owner", "gen", "en");
  assert.equal(first.id, second.id);
  assert.equal(calls, 1);
  assert.equal(first.devPreview, true);
  assert.equal(first.status, "rejected");
  const status = await preview.status("owner", "gen");
  assert.equal(status.eligible, false);
  assert.equal(status.existing.status, "rejected");
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
  const afterAppeal = await preview.status("owner", "gen");
  assert.equal(afterAppeal.eligible, false);
  assert.equal(afterAppeal.existing.status, "appeal_pending");
  await assert.rejects(
    preview.analyze("other", "gen", "en"),
    /no_product_photo/,
  );
});
