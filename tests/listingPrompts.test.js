const test = require("node:test");
const assert = require("node:assert/strict");
const {
  IMAGE_TYPES,
  normalizeImageTypes,
  normalizeMarketplace,
  normalizeStyle,
  buildBriefPrompt,
  parseBrief,
  fallbackBrief,
  buildListingPrompt,
} = require("../src/utils/listingPrompts");

test("normalizers: unknown values fall back, duplicates dropped", () => {
  assert.deepEqual(normalizeImageTypes(["hero", "HERO", "nope", "features"]), ["hero", "features"]);
  assert.equal(normalizeMarketplace("Etsy"), "etsy");
  assert.equal(normalizeMarketplace("ebay"), "ebay");
  assert.equal(normalizeMarketplace("bol.com"), "amazon");
  assert.equal(normalizeStyle("LUXURY"), "luxury");
  assert.equal(normalizeStyle(""), "auto");
});

test("brief prompt asks for the target language and echoes seller notes", () => {
  const p = buildBriefPrompt({ details: "Cotton towel set, 540 GSM", marketplace: "amazon", language: "tr" });
  assert.match(p, /Turkish/);
  assert.match(p, /Cotton towel set, 540 GSM/);
  assert.match(p, /"features"/);
});

test("parseBrief tolerates junk around JSON and clamps lists", () => {
  const raw = 'Sure! ```json {"productName":"Towel","headline":"Softness You Feel","features":[' +
    Array.from({ length: 8 }).map((_, i) => `{"title":"F${i}","subtitle":"s","icon":"star","source":"visible"}`).join(",") +
    '],"colorHint":"#EC4899","usageSteps":["a","b","c","d","e","f"]} ```';
  const b = parseBrief(raw, "Towel");
  assert.equal(b.productName, "Towel");
  assert.equal(b.features.length, 5);
  assert.equal(b.usageSteps.length, 4);
  assert.equal(b.colorHint, "#EC4899");
  const bad = parseBrief('{"colorHint":"pink"}', "Towel");
  assert.equal(bad.colorHint, "");
});

test("fallbackBrief does not turn untranslated or meta notes into image copy", () => {
  const b = fallbackBrief("Bamboo cutting board, 40x30 cm, knife friendly, dishwasher safe");
  assert.equal(b.productName, "");
  assert.deepEqual(b.features, []);
});

test("every image type renders a listing prompt with fidelity + language rules", () => {
  const brief = parseBrief(JSON.stringify({
    productName: "Cotton Paradise Towel Set",
    headline: "Softness You Feel Instantly",
    features: [{ title: "Woven Texture", subtitle: "Visible weave", icon: "feather", source: "visible" }],
    specs: { material: "100% cotton", dimensions: "70x140 cm" },
    boxContents: ["4 bath towels"],
    comparison: { othersLabel: "Diğerleri", oursLabel: "Ürünümüz", ours: ["Thick & absorbent"], others: ["Thin & rough"] },
    usageSteps: ["Wash before first use"],
    colorHint: "#EC4899",
  }), "");
  for (const type of IMAGE_TYPES) {
    const p = buildListingPrompt({ type, marketplace: "amazon", style: "clean", brief, language: "tr", ratio: "1:1" });
    assert.match(p, /PRODUCT FIDELITY/, type);
    assert.match(p, /in Turkish/, type);
    assert.match(p, /Square 1:1/, type);
    if (type !== "hero") assert.match(p, /#EC4899/, type);
    assert.doesNotMatch(p, /fashion|model creation|garment/i, type);
  }
  assert.match(buildListingPrompt({ type: "comparison", marketplace: "etsy", style: "auto", brief, language: "en", ratio: "4:5" }), /BUYER GUIDE/);
  assert.match(buildListingPrompt({ type: "dimensions", marketplace: "shopify", style: "tech", brief, language: "en", ratio: "16:9" }), /70x140 cm/);
  assert.match(buildListingPrompt({ type: "package", marketplace: "generic", style: "minimal", brief, language: "en", ratio: "original" }), /4 bath towels/);
});


test("Amazon main photo overrides decorative styling and never includes supplied headlines", () => {
  const p = buildListingPrompt({ type: "hero", marketplace: "amazon", style: "luxury", brief: { headline: "BUY NOW", colorHint: "#FF0000" }, language: "en" });
  assert.match(p, /255,255,255/);
  assert.doesNotMatch(p, /BUY NOW|STYLE: luxury|Accent color/);
});
test("missing evidence produces no invented comparison, measurements or usage slogans", () => {
  const brief = fallbackBrief("Örnek datalar sen gir");
  for (const type of IMAGE_TYPES) {
    const p = buildListingPrompt({type, brief, marketplace: "etsy", language: "tr"});
    assert.doesNotMatch(p, /Örnek datalar|Unbox|Enjoy|generic quality contrasts|empty labels, no fake/);
  }
  assert.match(buildListingPrompt({type:"comparison", brief}), /comparison evidence is absent/);
});
test("brief uses image evidence and respects style without inventing specifications", () => {
  const p = buildBriefPrompt({details:"example", marketplace:"amazon", language:"tr", style:"minimal"});
  assert.match(p, /attached product photograph/);
  assert.match(p, /Selected design style: minimal/);
  assert.match(p, /Never invent competitor weaknesses/);
});
test("malformed structured fields cannot become object text or crash prompt construction", () => {
  const brief = parseBrief(JSON.stringify({ productName:{bad:1}, features:[null, {title:5}, {title:"Valid", subtitle:{}}], specs:{weight:4}, comparison:{others:[{}]}, artDirection:{palette:{}} }), "notes");
  for (const type of IMAGE_TYPES) assert.doesNotMatch(buildListingPrompt({type, brief}), /\[object Object\]/);
});

test("feature claims require a supplied note quote or explicit visual evidence source", () => {
  const b = parseBrief(JSON.stringify({features:[
    {title:"Waterproof",source:"notes",evidence:"waterproof"},
    {title:"Comfortable"},
    {title:"Blue finish",source:"visible",evidence:"blue visible exterior"},
    {title:"Cotton",source:"notes",evidence:"100% cotton"}
  ]}), "100% cotton");
  assert.deepEqual(b.features.map(x=>x.title), ["Blue finish", "Cotton"]);
});

test("frame planning preserves distinct scene direction and localized headline", () => {
  const brief = parseBrief(JSON.stringify({frames:{lifestyle:{concept:"Daily commute", composition:"Side view with a campus background", headline:"Güne Hazır"},detail:{concept:"Visible stitching",composition:"Close oblique light",headline:"İnce Detaylar"}}}), "");
  const p = buildListingPrompt({type:"lifestyle",brief,marketplace:"shopify",language:"tr"});
  assert.match(p,/Daily commute/);assert.match(p,/campus background/);assert.match(p,/Güne Hazır/);
  assert.doesNotMatch(p,/Close oblique light/);
});

test("comparison needs matching evidenced rows and Amazon limits it to confirmed own-brand products", () => {
 const details = "Both bags are Acme. A holds 20 L. B holds 15 L. A has 4 pockets. B has 2 pockets.";
 const data={comparison:{mode:"same_brand",brandEvidence:"Both bags are Acme",leftLabel:"Acme A",rightLabel:"Acme B",rows:[
 {criterion:"Capacity",ours:"20 L",other:"15 L",oursEvidence:"A holds 20 L",otherEvidence:"B holds 15 L"},
 {criterion:"Pockets",ours:"4",other:"2",oursEvidence:"A has 4 pockets",otherEvidence:"B has 2 pockets"}
 ]}};
 const brief=parseBrief(JSON.stringify(data),details);
 assert.match(buildListingPrompt({type:"comparison",marketplace:"amazon",brief}), /Capacity \| 20 L \| 15 L/);
 assert.match(buildListingPrompt({type:"comparison",marketplace:"amazon",brief}), /EVIDENCED PRODUCT COMPARISON/);
 data.comparison.mode="competitor";
 const competitor=parseBrief(JSON.stringify(data),details);
 assert.match(buildListingPrompt({type:"comparison",marketplace:"amazon",brief:competitor}), /BUYER GUIDE/);
 assert.match(buildListingPrompt({type:"comparison",marketplace:"shopify",brief:competitor}), /EVIDENCED PRODUCT COMPARISON/);
});
test("unsupported alternative facts cannot turn into comparison values", () => {
 const brief=parseBrief(JSON.stringify({comparison:{mode:"same_brand",brandEvidence:"made up",rows:[{criterion:"Durability",ours:"Strong",oursEvidence:"visible edge",other:"Breaks",otherEvidence:"made up"}]}}),"plain notes");
 assert.equal(brief.comparison.mode,"buyer_guide");
 assert.equal(brief.comparison.rows[0].other,"");
 assert.doesNotMatch(buildListingPrompt({type:"comparison",brief}), /Breaks/);
});

test("shared art direction cannot leak the same location or lighting into every frame", () => {
 const brief={artDirection:{palette:"orange and ivory",typography:"modern sans",setting:"BEACH_TOWEL_SHARED",lighting:"PALM_SHADOW_SHARED"},frames:{detail:{setting:"macro studio",camera:"oblique close-up",props:"none"}}};
 for(const type of ["detail","dimensions","features","lifestyle"]){
 const p=buildListingPrompt({type,brief});
 assert.doesNotMatch(p,/BEACH_TOWEL_SHARED|PALM_SHADOW_SHARED/);
 assert.match(p,/orange and ivory/);
 assert.match(p,/MANDATORY VISUAL ROLE/);
 }
 assert.match(buildListingPrompt({type:"detail",brief}),/extreme photographic macro/);
 assert.match(buildListingPrompt({type:"dimensions",brief}),/Precision technical product plate/);
 assert.match(buildListingPrompt({type:"features",brief}),/Designed graphic product explainer/);
 assert.match(buildListingPrompt({type:"lifestyle",brief}),/immersive real-use environment/);
});
test("planner explicitly separates scenes while keeping brand identity",()=>{
 const p=buildBriefPrompt({details:"sunscreen",marketplace:"amazon",language:"tr"});
 assert.match(p,/Each pair should differ on at least three axes/);
 assert.match(p,/must not repeat sand, towel, palm trees and ocean/);
});

test("comparison uses a visual split poster with our product on the right, not a table",()=>{
 const p=buildListingPrompt({type:"comparison",brief:{},marketplace:"amazon"});
 assert.match(p,/SPLIT-SCREEN COMPARISON POSTER/);
 assert.match(p,/product belongs on the RIGHT/);
 assert.match(p,/No website category pills, heart\/menu icons/);
 assert.match(p,/No VS badge/);
 assert.doesNotMatch(p,/COMPARISON DECISION CHART|Editorial decision table/);
});

test("global marketplaces normalize and seller notes land in the prompt", () => {
  const { MARKETPLACES } = require("../src/utils/listingPrompts");
  for (const m of ["temu", "tiktok", "taobao", "wildberries", "wayfair", "hepsiburada"]) assert.ok(MARKETPLACES.includes(m), m);
  assert.equal(normalizeMarketplace("TikTok"), "tiktok");
  const brief = fallbackBrief("Sun cream SPF 50");
  const p = buildListingPrompt({ type: "hero", marketplace: "temu", style: "auto", brief, language: "en", ratio: "1:1", notes: { _all: "keep it pink", hero: "show the cap open" } });
  assert.match(p, /MARKETPLACE: Temu/);
  assert.match(p, /SELLER INSTRUCTIONS/);
  assert.match(p, /For every frame: keep it pink/);
  assert.match(p, /For this frame: show the cap open/);
  const q = buildListingPrompt({ type: "features", marketplace: "temu", style: "auto", brief, language: "en", ratio: "1:1", notes: { hero: "show the cap open" } });
  assert.doesNotMatch(q, /show the cap open/);
});

test("style examples block appears only when examples are attached", () => {
  const brief = fallbackBrief("Sun cream SPF 50");
  const withEx = buildListingPrompt({ type: "hero", marketplace: "amazon", style: "auto", brief, language: "en", ratio: "1:1", exampleCount: 4 });
  assert.match(withEx, /last 4 images each carry a black band/);
  assert.match(withEx, /STYLE EXAMPLE · DESIGN LOGIC ONLY/);
  const without = buildListingPrompt({ type: "hero", marketplace: "amazon", style: "auto", brief, language: "en", ratio: "1:1" });
  assert.doesNotMatch(without, /STYLE EXAMPLE/);
});

test("brief prompt: content photos and files are described as seller evidence", () => {
  const p = buildBriefPrompt({
    details: "sunscreen", marketplace: "amazon", language: "tr",
    contentImageCount: 2,
    contentDocs: [{ name: "spec.pdf", text: "SPF 50+  \n\n  water resistant 80 min" }, { name: "", text: "   " }],
  });
  assert.match(p, /Images 2 to 3 are additional CONTENT photos/);
  assert.match(p, /--- FILE: spec\.pdf ---/);
  assert.match(p, /water resistant 80 min/);
  assert.doesNotMatch(p, /--- FILE: document ---/);
  const none = buildBriefPrompt({ details: "x", marketplace: "amazon", language: "en" });
  assert.doesNotMatch(none, /CONTENT FILES|ATTACHED IMAGES/);
});

test("content files: per-file and total char budgets", () => {
  const big = "a".repeat(20000);
  const p = buildBriefPrompt({ details: "x", marketplace: "amazon", language: "en", contentDocs: [{ name: "a.pdf", text: big }, { name: "b.pdf", text: big }, { name: "c.pdf", text: big }] });
  const total = (p.match(/a{1000}/g) || []).length * 1000;
  assert.ok(total <= 24000, `total ${total}`);
  assert.match(p, /--- FILE: b\.pdf ---/);
  assert.doesNotMatch(p, /--- FILE: c\.pdf ---/);
});

/* ── 17 Eyl 2026: aynı türden birden fazla kare + estetik yönerge ───────── */

test("single frame: no variant block (davranış değişmedi)", () => {
  const p = buildListingPrompt({ type: "features", marketplace: "amazon", style: "auto", brief: fallbackBrief(""), language: "en", ratio: "1:1" });
  assert.doesNotMatch(p, /SET VARIANT/);
});

test("variants: her kopya farklı görsel görev alır ve kopya sayısını bilir", () => {
  const args = { type: "features", marketplace: "etsy", style: "auto", brief: fallbackBrief(""), language: "en", ratio: "4:5", variantTotal: 3 };
  const a = buildListingPrompt({ ...args, variantIndex: 0 });
  const b = buildListingPrompt({ ...args, variantIndex: 1 });
  const c = buildListingPrompt({ ...args, variantIndex: 2 });
  for (const p of [a, b, c]) assert.match(p, /SET VARIANT — image \d of 3/);
  const role = (p) => p.split("SET VARIANT")[1].split("\n")[0];
  assert.notEqual(role(a), role(b));
  assert.notEqual(role(b), role(c));
  assert.match(b, /single-feature spotlight/);
});

test("variants: liste tükenince başa döner ve ek fark ister", () => {
  const p = buildListingPrompt({ type: "hero", marketplace: "amazon", style: "auto", brief: fallbackBrief(""), language: "en", ratio: "1:1", variantIndex: 5, variantTotal: 6 });
  assert.match(p, /Every earlier treatment for this image type is already taken/);
});

test("variants: doğrulanmış olgular kopyalar arasında döndürülür", () => {
  const brief = { ...fallbackBrief(""), features: [{ title: "Bir", subtitle: "", icon: "" }, { title: "Iki", subtitle: "", icon: "" }, { title: "Uc", subtitle: "", icon: "" }] };
  const first = buildListingPrompt({ type: "features", marketplace: "etsy", style: "auto", brief, language: "en", ratio: "1:1", variantIndex: 0, variantTotal: 2 });
  const second = buildListingPrompt({ type: "features", marketplace: "etsy", style: "auto", brief, language: "en", ratio: "1:1", variantIndex: 1, variantTotal: 2 });
  assert.ok(first.indexOf('"Bir"') < first.indexOf('"Iki"'));
  assert.ok(second.indexOf('"Iki"') < second.indexOf('"Bir"'));
});

test("estetik: tipografi sistemi ve zemin/renk yönergesi her prompt'ta", () => {
  const p = buildListingPrompt({ type: "lifestyle", marketplace: "shopify", style: "luxury", brief: fallbackBrief(""), language: "tr", ratio: "9:16" });
  assert.match(p, /TYPOGRAPHIC SYSTEM/);
  assert.match(p, /SURFACE, BACKGROUND & COLOR/);
  assert.match(p, /Turkish diacritics must be complete/);
});

test("brief: art direction tipografi/zemin/atmosfer alanlarını ister ve saklar", () => {
  assert.match(buildBriefPrompt({ details: "x", marketplace: "etsy", language: "tr" }), /"typeface"[\s\S]*"background"[\s\S]*"mood"/);
  const brief = parseBrief(JSON.stringify({ artDirection: { typeface: "high-contrast display serif", background: "warm oak", mood: "calm, warm, crafted" } }), "x");
  assert.equal(brief.artDirection.typeface, "high-contrast display serif");
  const p = buildListingPrompt({ type: "hero", marketplace: "etsy", style: "auto", brief, language: "en", ratio: "1:1" });
  assert.match(p, /typeface: high-contrast display serif/);
  assert.match(p, /background: warm oak/);
});
