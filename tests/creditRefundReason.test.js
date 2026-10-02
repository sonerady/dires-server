const test = require("node:test");
const assert = require("node:assert/strict");
const { refundIneligibleReason } = require("../src/routes/creditRefundRoutes");

const DAY = 86400000;
const now = Date.parse("2026-09-24T12:00:00Z");
const base = {
  config: { refund_enabled: true },
  account: { is_in_trial: false },
  proof: { generation_id: "g" },
  gen: { created_at: new Date(now - 3600000).toISOString(), result_image_url: "https://x/r.jpg", credits_deducted: 10, reference_images: ["https://x/p.jpg"] },
  maxAgeMs: DAY,
  now,
};
const reason = (overrides = {}) => refundIneligibleReason({ ...base, ...overrides });

test("a fresh, charged main creation is eligible", () => assert.equal(reason(), "ok"));
test("older than 24h always explains the closed window — even without a proof row (pre-deploy creations)", () => {
  const old = { ...base.gen, created_at: new Date(now - DAY - 1000).toISOString() };
  assert.equal(reason({ gen: old }), "too_old");
  assert.equal(reason({ gen: old, proof: null }), "too_old");
});
test("within 24h, a missing proof row still means not a main creation", () =>
  assert.equal(reason({ proof: null }), "not_main_generation"));
test("disabled and trial keep priority over age", () => {
  const old = { ...base.gen, created_at: new Date(now - 5 * DAY).toISOString() };
  assert.equal(reason({ gen: old, config: { refund_enabled: false } }), "disabled");
  assert.equal(reason({ gen: old, account: { is_in_trial: true } }), "trial");
});
test("no daily limit reason exists any more", () => {
  for (const r of [reason(), reason({ proof: null })]) assert.notEqual(r, "daily_limit");
});

// 25 Eyl 2026: chat-edit ile düzenlenmiş üretim iade almaz; başarısız (kredisi iade edilmiş) üretim ikinci kez almaz
const { wasEditedInChat, imageFileKey } = require("../src/routes/creditRefundRoutes");
test("a creation edited in the chat editor is not refundable (after the main-creation check)", () => {
  assert.equal(reason({ edited: true }), "edited");
  assert.equal(reason({ edited: true, proof: null }), "not_main_generation");
});
test("a failed (already refunded) creation cannot be refunded again", () =>
  assert.equal(reason({ gen: { ...base.gen, status: "failed" } }), "no_charge"));
test("edit detection matches the same file across CDN wrappers, query strings and hosts", () => {
  const file = "https://api.diress.ai/storage/v1/object/public/user_image_results/u1/1790269985339_result_86564657.jpg";
  assert.equal(imageFileKey(`https://diress.ai/cdn-cgi/image/width=800,quality=80/${file}?v=2`), "1790269985339_result_86564657.jpg");
  const gen = { result_image_url: file, pre_upscale_image_url: null };
  assert.equal(wasEditedInChat(gen, null, [{ original_image_url: `${file}?t=1` }]), true);
  assert.equal(wasEditedInChat(gen, null, [{ original_image_url: "https://api.diress.ai/storage/v1/object/public/user_image_results/u1/other_result_1.jpg" }]), false);
  // the pre-upscale original or the proof image also count
  assert.equal(wasEditedInChat({ result_image_url: "https://x/up_8mp_123456789.jpg", pre_upscale_image_url: file }, null, [{ original_image_url: file }]), true);
  assert.equal(wasEditedInChat({ result_image_url: null }, { result_image_url: file }, [{ original_image_url: file }]), true);
  assert.equal(wasEditedInChat(gen, null, []), false);
});
