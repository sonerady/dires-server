const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// PRODUCT_CHANGE regresyon testi.
//
// 11 Ağu 2026: sandbox'ta aylık (2400) paketten haftalık (600) pakete geçen
// kullanıcıya 3000 kredi yüklendi. Sebep: RevenueCat PRODUCT_CHANGE event'i
// kullanıcının ÇIKTIĞI ürünü taşıyor, kod ise onu gerçek satın alma sayıp
// eski paketin kredisini ekliyordu. Ardından yeni ürünün RENEWAL'ı 600 daha
// ekleyince toplam 3000 oldu.
//
// Bu test webhook'un HTTP akışını ayağa kaldırmadan iki değişmezi koruyor:
//   1) PRODUCT_CHANGE kredi veren event listesinde OLMAMALI
//   2) PRODUCT_CHANGE için kredisiz erken dönüş bulunmalı
//
// Kaynak metnini okuyoruz çünkü route dosyaları Supabase/Express bağımlılıkları
// yüzünden birim testte izole çağrılamıyor; bu iki değişmez ise metinden
// güvenilir biçimde doğrulanabiliyor.

const FILES = [
  "src/routes/revenuecatWebhookv2.js",
  "src/routes/revenuecatWebhookv3.js",
  "src/routes/revenuecatWebhookv4.js",
];

const readSource = (rel) =>
  fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

const creditEventsBlock = (src) => {
  const start = src.indexOf("const creditEvents = [");
  assert.notEqual(start, -1, "creditEvents listesi bulunamadı");
  return src.slice(start, src.indexOf("]", start));
};

for (const rel of FILES) {
  test(`${rel}: PRODUCT_CHANGE kredi veren event listesinde değil`, () => {
    const block = creditEventsBlock(readSource(rel));
    assert.ok(
      !block.includes("PRODUCT_CHANGE"),
      "PRODUCT_CHANGE creditEvents içinde — eski paketin kredisi tekrar eklenir",
    );
    // Liste boşalmasın; gerçek satın alma event'leri yerinde kalmalı
    assert.ok(block.includes("INITIAL_PURCHASE"));
    assert.ok(block.includes("RENEWAL"));
  });

  test(`${rel}: PRODUCT_CHANGE kredisiz erken dönüşle işleniyor`, () => {
    const src = readSource(rel);
    const at = src.indexOf('if (type === "PRODUCT_CHANGE")');
    assert.notEqual(at, -1, "PRODUCT_CHANGE erken dönüş bloğu yok");

    // Bloğun hemen ardında kredisiz kaydı ve erken dönüşü bekliyoruz
    const block = src.slice(at, at + 2600);
    assert.ok(
      block.includes("credits_added: 0"),
      "geçiş işareti 0 kredi ile kaydedilmeli",
    );
    assert.ok(
      block.includes("switch_marker: true"),
      "geçiş işareti switch_marker ile işaretlenmeli (v4 lookback uyumu)",
    );
    assert.ok(
      block.includes("return res.status(200)"),
      "PRODUCT_CHANGE kredi hattına düşmeden dönmeli",
    );
  });
}

test("v2 ve v3 aynı davranışta (platform ayrımı sapmasın)", () => {
  const v2 = readSource(FILES[0]);
  const v3 = readSource(FILES[1]);
  for (const marker of [
    "credits_added: 0",
    "switch_marker: true",
    'if (type === "PRODUCT_CHANGE")',
  ]) {
    assert.ok(v2.includes(marker), `v2'de eksik: ${marker}`);
    assert.ok(v3.includes(marker), `v3'te eksik: ${marker}`);
  }
});
