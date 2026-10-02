// 🧩 Video storyboard önizlemesi (24 Eyl 2026): model seçimi + e-ticaret ızgara istemi
const test = require("node:test");
const assert = require("node:assert/strict");
const { previewModelOrder, buildCommerceGridPrompt } = require("../src/utils/videoGridPreview");

test("Ürün satış videosu NB2 (yedek GPT 2.5); diğer kartlar YALNIZ GPT Image 2.5 — NB2'ye düşmez (26 Eyl 2026)", () => {
  const nb2 = previewModelOrder("nano-banana-2");
  const gpt = previewModelOrder("gpt-image-2.5");
  assert.equal(nb2.length, 2); assert.match(nb2[0], /nano-banana-2/); assert.match(nb2[1], /gpt-image-2\.5/);
  assert.equal(gpt.length, 1); assert.match(gpt[0], /gpt-image-2\.5/);
  assert.deepEqual(previewModelOrder(undefined), gpt, "bilinmeyen tercih → yalnız GPT Image 2.5");
});

test("ızgara istemi orana göre düzen seçer, yönü ve ürün kilidini taşır, notları kırpar", () => {
  const portrait = buildCommerceGridPrompt({ direction: "Open on a splash hook", aspectRatio: "9:16", productCount: 3, duration: 15 });
  assert.match(portrait, /9:16 storyboard/); assert.match(portrait, /15-second/); assert.match(portrait, /Open on a splash hook/);
  assert.match(portrait, /3 input photos/); assert.match(portrait, /PRODUCT LOCK/);
  assert.doesNotMatch(portrait, /SELLER NOTES/);
  const wide = buildCommerceGridPrompt({ aspectRatio: "16:9", notes: "x".repeat(900) });
  assert.match(wide, /16:9 storyboard/);
  assert.equal((wide.match(/SELLER NOTES \(context only, never render as text\): (x+)/) || [])[1].length, 600);
  assert.match(buildCommerceGridPrompt({ aspectRatio: "7:3" }), /9:16 storyboard/, "desteklenmeyen oran → 9:16");
});
