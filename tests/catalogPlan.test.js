// Ürün kataloğu PDF — plan çekirdeği + planlayıcı. Çalıştır: node --test tests/catalogPlan.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../src/utils/catalogPlanCore");
const { planCatalog, buildPlanPrompt, allowedImageHost } = require("../src/utils/catalogPdfPlanner");

const IMG = "https://abc.supabase.co/storage/v1/object/public/images/catalogPdf/x.jpg";
const products = [
  { id: "p1", name: "Keten gömlek elbise", sku: "AM-1", price: 1899.9, oldPrice: 2499.9, description: "Rahat kesim, beli kuşaklı.", colors: ["Ekru"], sizes: ["S", "M"], imageUrl: IMG },
  { id: "p2", name: "", price: 3249, hasImage: true, imageUrl: IMG },
  { id: "p3", name: "Hasır çanta", price: 650, badge: "new" },
  { id: "p4", name: "Kanvas sırt çantası", price: 1099 },
];
const labels = { featured: "Öne çıkanlar", collection: "Koleksiyon", onSale: "İndirimde", newIn: "Yeni gelenler", thanks: "Teşekkürler", cta: "Sipariş için yazın", dateLine: "Katalog · Eylül 2026", catalog: "Ürün kataloğu" };
const baseBody = (extra = {}) => ({ language: "tr", brief: { mode: "ai" }, store: { name: "Atelier Mavi", currency: "TRY" }, products, labels, ...extra });

test("sanitizePlanInput: caps, unique ids, https-only images, AI mode ignores brief fields", () => {
  const input = core.sanitizePlanInput(baseBody({
    brief: { mode: "ai", coverTitle: "yok sayılmalı", tone: "bold" },
    products: [...products, { id: "p1", name: "dup" }, { id: "p5", imageUrl: "http://insecure/x.jpg", price: -5 }, { name: "no id" }],
  }));
  assert.equal(input.products.length, 5);
  assert.equal(input.products.find((p) => p.id === "p5").imageUrl, null);
  assert.equal(input.products.find((p) => p.id === "p5").price, null);
  assert.equal(input.brief.coverTitle, "");
  assert.equal(input.brief.tone, "auto");
  assert.equal(input.language, "tr");
  assert.equal(core.sanitizePlanInput({ language: "<script>" }).language, "en");
  const many = core.sanitizePlanInput({ products: Array.from({ length: 400 }, (_, i) => ({ id: `x${i}` })) });
  assert.equal(many.products.length, core.LIMITS.products);
});

test("scrubCopy removes invented claims, brands, contact info and specs — keeps facts and cross-language synonyms", () => {
  assert.equal(core.scrubCopy("Premium linen shirt. Relaxed fit! Free shipping on all orders.", "Keten gömlek", 200), "Premium linen shirt. Relaxed fit!");
  assert.equal(core.scrubCopy("Rahat kesim. %100 pamuk. Detaylar için www.site.com", "Keten gömlek", 200), "Rahat kesim.");
  assert.equal(core.scrubCopy("Nike ruhunda 😍. Hafif taban, 3,5 cm topuk.", "Spor ayakkabı 3,5 cm", 200), "Hafif taban, 3,5 cm topuk.");
  assert.equal(core.scrubCopy("Sipariş için +90 532 123 45 67. Hızlı teslimat.", "", 200), "Hızlı teslimat.");
  assert.equal(core.scrubCopy("Deri çanta", "Canvas bag", 90, { single: true }), "");
  assert.equal(core.scrubCopy("El yapımı seramik kupa", "Handmade ceramic mug", 90, { single: true }), "El yapımı seramik kupa");
  assert.equal(core.scrubCopy("Best seller of the season", "", 90, { single: true }), "");
  assert.ok(core.scrubCopy("a ".repeat(200), "", 50).length <= 51);
});

test("validatePlan is strict: unknown ids, duplicates, bad enums, AI 'bestseller' and unearned badges are dropped", () => {
  const input = core.sanitizePlanInput(baseBody());
  const v = core.validatePlan({
    theme: "neon", accent: "red", fontPair: "comic", pageSize: "A3", orientation: "portrait", toc: "yes",
    cover: { title: "Sonbahar 2026", imageProductId: "p3" },
    sections: [{ title: "A", layout: "grid4", productIds: ["p1", "zz", "p1"] }, { title: "B", layout: "mosaic", productIds: ["p1", "p2"] }],
    products: { p1: { badge: "sale" }, p2: { name: "Trençkot", badge: "bestseller" }, p3: { badge: "sale" }, p4: { badge: "new" }, zz: { name: "x" } },
  }, input);
  assert.equal(v.theme, undefined);
  assert.equal(v.accent, undefined);
  assert.equal(v.fontPair, undefined);
  assert.equal(v.pageSize, undefined);
  assert.equal(v.toc, undefined);
  assert.equal(v.cover.imageProductId, null, "p3 has no photo");
  assert.deepEqual(v.sections.map((s) => s.productIds), [["p1"], ["p2"]]);
  assert.equal(v.sections[1].layout, null);
  assert.equal(v.products.p1.badge, "sale", "discounted → sale allowed");
  assert.equal(v.products.p2.badge, undefined, "bestseller never from AI");
  assert.equal(v.products.p3, undefined, "not discounted → no sale badge");
  assert.equal(v.products.p4, undefined, "new only for new-arrivals purpose");
  assert.equal(v.products.zz, undefined);
  assert.equal(core.validatePlan("garbage", input), null);
  assert.equal(core.validatePlan([1, 2], input), null);
});

test("finalizePlan: every product exactly once, missing ones appended, seller copy wins, accent follows the AI theme", () => {
  const input = core.sanitizePlanInput(baseBody());
  const plan = core.finalizePlan({ theme: "luxury", sections: [{ title: "Seçki", layout: "grid2", productIds: ["p2", "p1"] }], products: { p1: { name: "Başka ad", description: "Yeni açıklama", highlights: ["Beli kuşaklı"] }, p2: { name: "Trençkot", description: "Kruvaze kapanışlı klasik trençkot." } } }, input, { source: "ai" });
  assert.equal(plan.source, "ai");
  assert.equal(plan.theme, "luxury");
  assert.equal(plan.accent, core.THEME_ACCENTS.luxury);
  const ids = plan.sections.flatMap((s) => s.productIds);
  assert.deepEqual(ids.slice().sort(), ["p1", "p2", "p3", "p4"]);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(plan.products.p1.name, undefined, "seller name kept");
  assert.equal(plan.products.p1.description, undefined, "seller description kept");
  assert.deepEqual(plan.products.p1.highlights, ["Beli kuşaklı"]);
  assert.equal(plan.products.p2.name, "Trençkot");
  assert.equal(plan.version, core.PLAN_VERSION);
  const junk = core.finalizePlan({ nothing: true }, input);
  assert.equal(junk.source, "fallback");
});

test("explicit brief values and locked settings always beat the model", () => {
  const input = core.sanitizePlanInput(baseBody({
    brief: { mode: "manual", coverTitle: "Toptan 2026", layout: "list", prices: "hide", sectionsMode: "custom", sectionTitles: ["Giyim", "Çanta"], highlightMode: "custom", highlightIds: ["p3"] },
    locked: { theme: "pastel", accent: "#123456", showSku: false, backHeadline: "Bize yazın" },
  }));
  const plan = core.finalizePlan({
    theme: "bold", accent: "#FF0000", showPrices: true, showSku: true,
    cover: { title: "Modelin başlığı" },
    sections: [{ title: "Çanta", layout: "grid4", productIds: ["p3", "p4"] }, { title: "Giyim", layout: "grid2", productIds: ["p1", "p2"] }],
    backPage: { headline: "Model başlığı" },
  }, input, { source: "ai" });
  assert.equal(plan.cover.title, "Toptan 2026");
  assert.equal(plan.showPrices, false);
  assert.equal(plan.theme, "pastel");
  assert.equal(plan.accent, "#123456");
  assert.equal(plan.showSku, false);
  assert.equal(plan.backPage.headline, "Bize yazın");
  assert.equal(plan.sections[0].title, "Öne çıkanlar", "highlighted product opens the catalog");
  assert.deepEqual(plan.sections[0].productIds, ["p3"]);
  assert.deepEqual(plan.sections.slice(1).map((s) => s.title), ["Giyim", "Çanta"], "custom section titles in the seller's order");
  assert.ok(plan.sections.every((s) => s.layout === "list"), "fixed layout applies to every section");
});

test("fallback plan is deterministic and purpose-aware", () => {
  const input = core.sanitizePlanInput(baseBody());
  assert.deepEqual(core.buildFallbackPlan(input), core.buildFallbackPlan(input));
  const sale = core.buildFallbackPlan(core.sanitizePlanInput(baseBody({ brief: { mode: "manual", purpose: "sale" } })));
  assert.equal(sale.sections[0].title, "İndirimde");
  assert.deepEqual(sale.sections[0].productIds, ["p1"]);
  assert.equal(sale.products.p1.badge, "sale");
  const wholesale = core.buildFallbackPlan(core.sanitizePlanInput(baseBody({ brief: { mode: "manual", purpose: "wholesale" } })));
  assert.ok(wholesale.sections.every((s) => s.layout === "list"));
  assert.equal(wholesale.showSku, true);
  const lookbook = core.buildFallbackPlan(core.sanitizePlanInput(baseBody({ brief: { mode: "manual", purpose: "lookbook" } })));
  assert.equal(lookbook.showPrices, false);
  assert.equal(lookbook.theme, "luxury");
  const many = core.buildFallbackPlan(core.sanitizePlanInput({ products: Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, name: `Ürün ${i}`, price: 10 })) }));
  assert.equal(many.toc, true);
  assert.equal(many.cover.title, "Product catalog", "English default label when the client sent none");
});

test("planCatalog: model JSON is finalized; failures and junk fall back without throwing", async () => {
  const input = core.sanitizePlanInput(baseBody());
  let seen;
  const ok = await planCatalog(input, { ask: async (opts) => { seen = opts; return "```json\n" + JSON.stringify({ theme: "editorial", sections: [{ title: "", layout: "grid4", productIds: ["p1", "p2", "p3", "p4"] }], products: { p2: { name: "Oversize trençkot" } }, cover: { title: "Sonbahar 2026", imageProductId: "p1" } }) + "\n```"; } });
  assert.equal(ok.source, "ai");
  assert.equal(ok.plan.theme, "editorial");
  assert.equal(ok.plan.products.p2.name, "Oversize trençkot");
  assert.equal(seen.tag, "CATALOG_PDF_PLAN");
  assert.equal(seen.imageUrls.length, 2);
  assert.match(seen.prompt, /Write every visible word in Turkish \(tr\)/);
  const down = await planCatalog(input, { ask: async () => { throw new Error("fal timeout"); } });
  assert.equal(down.source, "fallback");
  assert.equal(down.reason, "model_unavailable");
  const junk = await planCatalog(input, { ask: async () => "I cannot do that" });
  assert.equal(junk.source, "fallback");
  assert.equal(junk.reason, "invalid_model_output");
});

test("only our own storage images reach the model", () => {
  assert.equal(allowedImageHost("https://abc.supabase.co/storage/v1/object/public/images/a.jpg"), true);
  assert.equal(allowedImageHost("https://evil.example.com/a.jpg"), false);
  assert.equal(allowedImageHost("not a url"), false);
  const input = core.sanitizePlanInput(baseBody({ products: [{ id: "a", imageUrl: "https://evil.example.com/a.jpg" }, { id: "b", imageUrl: IMG }] }));
  assert.deepEqual(buildPlanPrompt(input).imageUrls, [IMG]);
});

test("twin files stay byte-identical (client ↔ server plan core)", (t) => {
  const client = path.resolve(__dirname, "../../client/components/catalogPdf/catalogPlanCore.js");
  if (!fs.existsSync(client)) return t.skip("client checkout not next to server");
  assert.equal(fs.readFileSync(client, "utf8"), fs.readFileSync(path.resolve(__dirname, "../src/utils/catalogPlanCore.js"), "utf8"));
});
