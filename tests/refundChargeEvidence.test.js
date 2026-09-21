const test = require("node:test");
const assert = require("node:assert/strict");
const { recordRefundCharge } = require("../src/services/refundChargeEvidence");
function database(
  rows = [
    {
      id: "result",
      result_image_url: "https://real/result.jpg",
      reference_images: ["https://real/product.jpg"],
    },
  ],
) {
  const writes = [];
  return {
    writes,
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: async () => ({ data: rows }),
            }),
          }),
        }),
      }),
      upsert: async (row, options) => {
        writes.push({ row, options });
        return { error: null };
      },
    }),
  };
}
const input = {
  generationId: "generation",
  userId: "user",
  creditOwnerId: "owner",
  amount: 20,
  debit: { success: true, deducted_amount: 20 },
};
test("failed or mismatched debit cannot establish refundable credit", async () => {
  const db = database();
  for (const debit of [
    { success: false, deducted_amount: 20 },
    { success: true, deducted_amount: 200 },
    null,
  ])
    assert.equal(await recordRefundCharge({ ...input, debit }, { db }), false);
  assert.equal(db.writes.length, 0);
});
test("verified debit records immutable amount, payer and original comparison images", async () => {
  const db = database();
  assert.equal(await recordRefundCharge(input, { db }), true);
  assert.equal(db.writes[0].row.credits, 20);
  assert.equal(db.writes[0].row.credit_owner_id, "owner");
  assert.equal(db.writes[0].row.result_image_url, "https://real/result.jpg");
  assert.equal(db.writes[0].options.ignoreDuplicates, true);
});

// Kredi düşüldüğü an üretim henüz bitmemiştir: sonuç görseli olmadan da kanıt
// yazılmalı, yoksa credit_owner_id hiç kaydedilmez ve YZ'nin onayladığı iade
// otomatik ödenemez (17 Eyl 2026 regresyonu).
test("charge is recorded while the generation is still running", async () => {
  const db = database([
    { id: "result", result_image_url: null, reference_images: [] },
  ]);
  assert.equal(await recordRefundCharge(input, { db }), true);
  assert.equal(db.writes[0].row.credit_owner_id, "owner");
  assert.equal(db.writes[0].row.result_image_url, null);
});
test("charge is recorded even before the generation row exists", async () => {
  const db = database([]);
  assert.equal(await recordRefundCharge(input, { db }), true);
  assert.equal(db.writes[0].row.result_id, null);
  assert.equal(db.writes[0].row.credits, 20);
});
test("a charge without a known payer is never recorded", async () => {
  const db = database();
  assert.equal(
    await recordRefundCharge({ ...input, creditOwnerId: null }, { db }),
    false,
  );
  assert.equal(db.writes.length, 0);
});
