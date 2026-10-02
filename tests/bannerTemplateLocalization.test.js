const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { TEMPLATES } = require("../src/data/bannerTemplates");
const { normalizeLanguage, sourceFor, applyTranslations, localizeTemplates } = require("../src/data/bannerTemplates/localize");

test("all authored catalogs match the current static and animated source", () => {
  const dir = path.join(__dirname, "../src/data/bannerTemplates/authored");
  const sources = new Map(TEMPLATES.map(entry => [entry.id, sourceFor(entry)]));
  const files = fs.readdirSync(dir).filter(file => file.endsWith(".json") && !["names.json", "coverage.json"].includes(file));
  for (const file of files) {
    const catalog = JSON.parse(fs.readFileSync(path.join(dir, file)));
    if (["tr.json", "ar.json", "en.json"].includes(file)) assert.equal(Object.keys(catalog).length, 610, file);
    for (const [id, row] of Object.entries(catalog)) {
      const source = sources.get(id);
      assert(source, `${file}: ${id}`);
      assert.equal(row.source_hash, source.sourceHash, `${file}: stale ${id}`);
      for (const text of source.strings) assert(Object.hasOwn(row.translations, text) && (row.translations[text] === null || typeof row.translations[text] === "string" && row.translations[text].trim()), `${file}: ${id}: ${text}`);
    }
  }
});

test("letter artwork, weekdays and countdown units use semantic localized text", async () => {
  const cheerio = require("cheerio");
  const ids = ["cut-zine", "letter-grid", "weight-ramp", "save-the-date", "announcement-bar", "swap-flyer", "iso-plinth"];
  const page = await localizeTemplates(TEMPLATES.filter(entry => ids.includes(entry.id)), "tr");
  const dom = Object.fromEntries(page.map(template => [template.id, cheerio.load(template.html)]));
  assert.equal(dom["cut-zine"](".cut .word").length, 2, "preserve the original heading rows");
  assert.equal(dom["cut-zine"](".cut").text().replace(/\s/g, ""), "YeniÜrün");
  assert.equal(dom["letter-grid"](".c.n .L,.c.e .L,.c.w .L").text(), "YENİ");
  assert.equal(dom["weight-ramp"](".ramp").text().replace(/\s/g, ""), "İncedenkalına.");
  assert.deepEqual(dom["save-the-date"](".dow").toArray().map(node => dom["save-the-date"](node).text()), ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"]);
  assert.match(dom["announcement-bar"](".clock").text(), /gün.*sa\..*dk\./);
  assert.equal(dom["swap-flyer"](".sheet > .word").text(), "Takas");
  assert.match(dom["iso-plinth"]("h1").text(), /Onubir kaideye koy\./);
});

test("RTL SVG labels retain SVG text elements so they remain visible", () => {
  const raw = '<html><head></head><body><svg><text>New season</text></svg></body></html>';
  const translated = applyTranslations(raw, { "New season": "الموسم الجديد" }, "ar");
  assert.match(translated, /<text><tspan[^>]*>الموسم الجديد<\/tspan><\/text>/);
  assert(!translated.includes("<bdi"));
});

test("split amounts follow local percent and currency placement", () => {
  const raw = '<html><head></head><body><div class="price"><span class="cur">€</span>89</div><span class="num">50<sup>%</sup></span></body></html>';
  const copy = { "€": "€", "89": "89", "50": "50", "%": "%" };
  const tr = applyTranslations(raw, copy, "tr");
  assert.match(tr, /<sup>%<\/sup>50/);
  const fr = applyTranslations(raw, copy, "fr");
  assert.match(fr, /89\s*<span class="cur">€<\/span>/);
  const ar = applyTranslations(raw, copy, "ar");
  assert(ar.includes("٨٩"));
  assert(ar.includes("ج.م."));
});

test("sample prices use tugriks for Mongolian and euros for Bulgarian", async () => {
  const cheerio = require("cheerio");
  const entry = TEMPLATES.find(template => template.id === "price-only");
  const [mn] = await localizeTemplates([entry], "mn");
  const [bg] = await localizeTemplates([entry], "bg");
  assert.match(cheerio.load(mn.html)("body").text(), /₮/);
  assert(!cheerio.load(mn.html)("body").text().includes("USD"));
  assert.match(cheerio.load(bg.html)("body").text(), /€/);
});

test("English authored copy localizes French labels, dates and embedded sample prices", async () => {
  const cheerio = require("cheerio");
  const ids = ["defile-invitation", "heritage-crest", "black-tie", "cruise-log"];
  const templates = await localizeTemplates(TEMPLATES.filter(entry => ids.includes(entry.id)), "en");
  const text = Object.fromEntries(templates.map(template => [template.id, cheerio.load(template.html)("body").text()]));
  assert(text["defile-invitation"].includes("Runway"));
  assert(text["defile-invitation"].includes("Saturday, October 3"));
  assert(!text["heritage-crest"].includes("Savoir"));
  assert(text["black-tie"].includes("from $290"));
  assert(text["cruise-log"].includes("Arrives Nov 12"));
});

test("reviewed English artwork resolves calendar tokens, foreign labels and embedded prices", async () => {
  const cheerio = require("cheerio");
  const ids = ["save-the-date", "announcement-bar", "floor-directory", "love-letter", "noir-tier-card"];
  const templates = await localizeTemplates(TEMPLATES.filter(entry => ids.includes(entry.id)), "en");
  for (const template of templates) {
    for (const html of [template.html, template.animHtml].filter(Boolean)) {
      const body = cheerio.load(html)("body").text();
      assert(!/\[(?:unit|percent|weekday|month):/.test(body), template.id);
      assert(!/[\uac00-\ud7af]/u.test(body), template.id);
      if (template.id === "love-letter") assert(body.includes("AIR MAIL") && body.includes("Love"));
      if (template.id === "noir-tier-card") assert(body.includes("Unlocked at $1,500 a year."));
    }
  }
});

test("Arabic terminal prompts and media playback symbols retain their non-currency meaning", async () => {
  const cheerio = require("cheerio");
  const entries = TEMPLATES.filter(entry => ["cyber-monday", "vhs-rewind"].includes(entry.id));
  const page = await localizeTemplates(entries, "ar");
  for (const template of page) {
    for (const html of [template.html, template.animHtml].filter(Boolean)) {
      const text = cheerio.load(html)("body").text();
      if (template.id === "cyber-monday") {
        assert(text.includes("$"));
        assert(!text.includes("ج.م."));
      } else {
        assert(text.includes("▶ تشغيل"));
      }
    }
    if (template.id === "vhs-rewind") assert.match(template.animHtml, /content:\s*"◀◀ إرجاع"/);
  }
});

test("every app language is supported, including Traditional Chinese", async () => {
  const localeDir = path.join(__dirname, "../../client/locales");
  const languages = fs.readdirSync(localeDir).filter(name => name.endsWith(".json") && name !== "web.json").map(name => name.slice(0, -5));
  const entry = TEMPLATES.find(template => template.id === "price-ladder");
  assert.equal(languages.length, 71);
  for (const language of languages) {
    const normalized = normalizeLanguage(language);
    assert(normalized !== "en" || language === "en", language);
    const [template] = await localizeTemplates([entry], language, { translator: async items => items.map(item => item.text) });
    if (language !== "en") assert(template.html.includes(`lang="${normalized}"`), language);
  }
});

test("the server can localize copy in every static and animated template without changing image slots", () => {
  assert.equal(TEMPLATES.length, 610);
  for (const entry of TEMPLATES) {
    const source = sourceFor(entry);
    assert(source.strings.length > 0, entry.id);
    const identity = Object.fromEntries(source.strings.map(text => [text, text]));
    for (const raw of [source.still, source.motion]) {
      if (!raw) continue;
      const html = applyTranslations(raw, identity, "tr");
      assert(html.includes("{{PRODUCT_IMAGE}}"), entry.id);
      assert.match(html, /<html[^>]*lang="tr"[^>]*dir="ltr"/i, entry.id);
    }
  }
});

test("accessibility text in banner attributes is translated", () => {
  const entry = TEMPLATES.find(template => template.id === "fogged-window");
  const source = sourceFor(entry);
  const translations = Object.fromEntries(source.strings.map(text => [text, text]));
  translations["Rainy day sale, 40% off"] = "تخفيضات يوم ممطر، خصم ٤٠٪";
  const html = applyTranslations(source.still, translations, "ar");
  assert(html.includes('aria-label="تخفيضات يوم ممطر، خصم ٤٠٪"'));
});

test("RTL copy, sample currency and the static/motion versions share one translated dictionary", async () => {
  const entry = TEMPLATES.find(t => t.id === "price-only");
  const batches = [];
  const translator = async (items, lang) => {
    batches.push({ lang, items });
    return items.map(({ text }) => text === "€" ? "د.إ" : text === "89" ? "٩٩" : `عربي ${text}`);
  };
  const [result] = await localizeTemplates([entry], "ar-EG", { translator });
  assert.equal(result.id, entry.id);
  assert.match(result.html, /lang="ar" dir="rtl"/);
  assert.match(result.html, /<bdi dir="rtl"/);
  assert.match(result.html, /ج\.م\./);
  assert.match(result.html, /٨٩/);
  assert(result.animHtml.includes("<bdi dir=\"rtl\""));
  assert(batches.flatMap(batch => batch.items).some(item => item.text === "€"));
  assert.equal(normalizeLanguage("zh-TW"), "zh-Hant");
  assert.equal(normalizeLanguage("pt-BR"), "pt");
});

test("a gallery page translates several templates in one request", async () => {
  const entries = TEMPLATES.filter(t => ["flash", "price-only"].includes(t.id));
  let requests = 0;
  const translated = await localizeTemplates(entries, "fa", { translator: async items => { requests++; return items.map(item => `فارسی ${item.text}`); } });
  assert.equal(requests, 1);
  assert.equal(translated.length, 2);
  assert(translated.every(item => item.html.includes('dir="rtl"')));
});

test("a failed translation leaves the other localized banners visible", async () => {
  const entries = TEMPLATES.filter(template => ["flash", "price-only"].includes(template.id));
  const translated = await localizeTemplates(entries, "am", {
    partial: true,
    translator: async items => {
      if (items.some(item => item.template === "Price Only")) throw new Error("mock translation rejected copy");
      return items.map(item => `አማርኛ ${item.text}`);
    },
  });
  assert.deepEqual(translated.map(template => template.id), ["flash"]);
  assert(translated[0].html.includes("አማርኛ"));
});

test("unreviewed copy stays visible without calling any external translator", async () => {
  // Keep exercising a genuinely missing catalog entry as authored coverage grows.
  const entries = TEMPLATES.slice(12, 24).map(entry => ({ ...entry, id: `unreviewed-fixture-${entry.id}` }));
  const originalFetch = global.fetch;
  global.fetch = () => { throw new Error("external call forbidden"); };
  try {
    const page = await localizeTemplates(entries, "ca");
    assert.equal(page.length, 12);
    assert.deepEqual(page.map(template => template.id), entries.map(template => template.id));
    assert.equal(page[0].html, sourceFor(entries[0]).still);
  } finally { global.fetch = originalFetch; }
});

test("the initial gallery templates have authored copy in every supported app language", async () => {
  const localeDir = path.join(__dirname, "../../client/locales");
  const languages = fs.readdirSync(localeDir).filter(name => name.endsWith(".json") && name !== "web.json").map(name => name.slice(0, -5));
  const entries = [...TEMPLATES.slice(0, 14), ...TEMPLATES.filter(entry => ["price-only", "quiet", "plinth-column", "correspondence-card", "festive-lights", "vertical-cover", "flacon-window", "pressed-compact", "missing-piece", "bandana-paisley", "gaffer-tape", "cut-collage", "stable-plaque", "ex-libris", "show-schedule", "broadsheet", "the-five", "folio-spread", "cut-zine", "editors-letter", "street-diary", "swiss", "raffle-drop", "sticker-bomb", "ship-label", "skate-zine", "tech-spec", "collab-x", "graffiti-throw", "restock-board", "varsity-letter"].includes(entry.id))];
  const originalFetch = global.fetch;
  global.fetch = () => { throw new Error("external call forbidden"); };
  try {
    for (const language of languages) {
      const page = await localizeTemplates(entries, language);
      assert.equal(page.length, 45, language);
      assert(page.every(template => template.html.includes("{{PRODUCT_IMAGE}}")), language);
      for (const template of page) {
        for (const html of [template.html, template.animHtml].filter(Boolean)) {
          assert(html.includes(`lang="${language}"`), `${language}/${template.id}: missing authored copy`);
        }
      }
    }
  } finally { global.fetch = originalFetch; }
});

test("reviewed Turkish copy and sample prices are served from local files", async () => {
  const entries = TEMPLATES.filter(template => ["bevel-cart", "giveaway-entry"].includes(template.id));
  const originalFetch = global.fetch;
  global.fetch = () => { throw new Error("external call forbidden"); };
  try {
    const page = await localizeTemplates(entries, "tr");
    assert(page[0].html.includes("Sepete ekle") || page[1].html.includes("Sepete ekle"));
    assert(page.some(template => template.html.includes("₺129,00")));
    assert(page.some(template => template.html.includes("bu gönderiyi kaydet")));
  } finally { global.fetch = originalFetch; }
});

test("reviewed RTL copy uses native script, direction and local currency without network calls", async () => {
  const entry = TEMPLATES.find(template => template.id === "price-only");
  const originalFetch = global.fetch;
  global.fetch = () => { throw new Error("external call forbidden"); };
  try {
    for (const language of ["ar", "fa", "he", "ur"]) {
      const [template] = await localizeTemplates([entry], language);
      assert(template.html.includes(`lang="${language}" dir="rtl"`), language);
      assert(template.html.includes('<bdi dir="rtl"'), language);
      assert(!template.html.includes("The essential"), language);
      assert(!template.html.includes("€"), language);
    }
  } finally { global.fetch = originalFetch; }
});

test("gallery still localizes when the persistent cache table has not been deployed", async () => {
  const entry = TEMPLATES.find(t => t.id === "style-steps");
  const db = { from: () => ({
    select: () => ({ eq: () => ({ in: async () => ({ data: null, error: { message: "table missing" } }) }) }),
    upsert: async () => ({ error: { message: "table missing" } }),
  }) };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const [item] = await localizeTemplates([entry], "sw", { db, translator: async items => items.map(({ text }) => `Kiswahili ${text}`) });
    assert(item.html.includes("Kiswahili"));
    assert(item.animHtml.includes("Kiswahili"));
  } finally { console.warn = warn; }
});
