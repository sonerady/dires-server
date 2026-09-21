#!/usr/bin/env node
/**
 * 🛍️ Shopify mağaza ürün + görsel toplayıcı
 *
 * Shopify her mağazada /products.json açık uçlu bir besleme yayınlar. HTML
 * kazımaya, Puppeteer'a, LLM'e GEREK YOK — tek endpoint tüm ürünleri,
 * varyantları ve TÜM görsel URL'lerini sıralı şekilde veriyor.
 *
 * Kullanım:
 *   node scripts/shopify-product-scrape.js https://www.freshscarfs.com
 *   node scripts/shopify-product-scrape.js https://www.freshscarfs.com --download
 *   node scripts/shopify-product-scrape.js https://www.freshscarfs.com --download --limit 50
 *
 * Çıktı (out/<mağaza>/ altına):
 *   products.json  — ürün başına: url, başlık, tip, etiketler, fiyat, görsel listesi
 *   images.csv     — düz liste: ürün url'i, sıra, görsel url'i  (Excel'e açılır)
 *   images/<handle>/01.jpg ...   (yalnız --download verilirse)
 *
 * Not: Görseller ilgili markanın telifli çekimleri. Dahili referans/stil
 * girdisi olarak kullanmak ayrı, olduğu gibi yeniden yayınlamak ayrı şeydir.
 */

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const storeArg = args.find((a) => !a.startsWith("--"));
if (!storeArg) {
  console.error("Kullanım: node scripts/shopify-product-scrape.js <mağaza-url> [--download] [--limit N]");
  process.exit(1);
}
const DOWNLOAD = args.includes("--download");
const LIMIT = Number((args.find((a) => a.startsWith("--limit")) || "").split(/[= ]/)[1] || args[args.indexOf("--limit") + 1] || 0);

const origin = new URL(storeArg.startsWith("http") ? storeArg : `https://${storeArg}`).origin;
const host = new URL(origin).host.replace(/^www\./, "");
const outDir = path.join(process.cwd(), "out", host);
fs.mkdirSync(outDir, { recursive: true });

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
      if (res.status === 429) { await sleep(3000 * (i + 1)); continue; }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      if (i === tries - 1) throw err;
      await sleep(1200 * (i + 1));
    }
  }
}

// Shopify CDN: sorgu parametresini atınca ORİJİNAL çözünürlük gelir.
const originalSrc = (src) => String(src || "").split("?")[0];

console.log(`→ ${origin} taranıyor…`);
const products = [];
for (let page = 1; page <= 200; page++) {
  const json = await getJson(`${origin}/products.json?limit=250&page=${page}`);
  const batch = json?.products || [];
  if (!batch.length) break;
  products.push(...batch);
  process.stdout.write(`\r  sayfa ${page} — toplam ${products.length} ürün`);
  if (LIMIT && products.length >= LIMIT) break;
  await sleep(350);
}
console.log("");

const trimmed = LIMIT ? products.slice(0, LIMIT) : products;

const rows = trimmed.map((p) => {
  const images = (p.images || []).map((im) => originalSrc(im.src));
  const prices = (p.variants || []).map((v) => Number(v.price)).filter(Boolean);
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    url: `${origin}/products/${p.handle}`,
    product_type: p.product_type || null,
    vendor: p.vendor || null,
    tags: p.tags || [],
    published_at: p.published_at,
    price_min: prices.length ? Math.min(...prices) : null,
    price_max: prices.length ? Math.max(...prices) : null,
    variant_count: (p.variants || []).length,
    image_count: images.length,
    images,
  };
});

fs.writeFileSync(path.join(outDir, "products.json"), JSON.stringify(rows, null, 2));

const csv = ["product_url,title,image_index,image_url"];
for (const r of rows) {
  r.images.forEach((src, i) => {
    csv.push([r.url, `"${String(r.title).replace(/"/g, '""')}"`, i + 1, src].join(","));
  });
}
fs.writeFileSync(path.join(outDir, "images.csv"), csv.join("\n"));

const totalImages = rows.reduce((a, r) => a + r.image_count, 0);
console.log(`\n${rows.length} ürün, ${totalImages} görsel`);
console.log(`  ${path.join(outDir, "products.json")}`);
console.log(`  ${path.join(outDir, "images.csv")}`);

if (DOWNLOAD) {
  const imgRoot = path.join(outDir, "images");
  let done = 0, failed = 0;
  for (const r of rows) {
    const dir = path.join(imgRoot, r.handle);
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < r.images.length; i++) {
      const src = r.images[i];
      const ext = (src.match(/\.(jpe?g|png|webp|avif)$/i) || [, "jpg"])[1];
      const file = path.join(dir, `${String(i + 1).padStart(2, "0")}.${ext}`);
      if (fs.existsSync(file)) { done++; continue; }
      try {
        const res = await fetch(src, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(45000) });
        if (!res.ok) throw new Error(String(res.status));
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
        done++;
      } catch {
        failed++;
      }
      process.stdout.write(`\r  indirilen ${done}/${totalImages}${failed ? ` (hata ${failed})` : ""}`);
      await sleep(120);
    }
  }
  console.log(`\n  ${imgRoot}`);
}
