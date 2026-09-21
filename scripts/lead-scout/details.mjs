#!/usr/bin/env node
// 📦 Detay çekici — panelde mağazaya tıklayınca açılacak ürün listesini üretir.
//
//   node details.mjs                 rows.jsonl'daki tüm Shopify mağazaları
//   node details.mjs freshscarfs.com tek mağaza
//
// Çıktı: out/stores/<domain>.json  (kategori kırılımı + ürün kayıtları)

import fs from "node:fs";
import path from "node:path";
import { fetchCatalog, slimProducts, categoryBreakdown, normalizeDomain, sleep } from "./lib/shopify.mjs";

const only = process.argv.slice(2).filter((a) => !a.startsWith("--")).map(normalizeDomain);

const rows = fs.existsSync("out/rows.jsonl")
  ? fs.readFileSync("out/rows.jsonl", "utf8").split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  : [];

const targets = only.length
  ? only
  : rows.filter((r) => r.products > 0 && r.reason !== "not_shopify").map((r) => r.domain);

fs.mkdirSync("out/stores", { recursive: true });
console.log(`${targets.length} mağaza için detay çekiliyor\n`);

for (const [i, domain] of targets.entries()) {
  const out = path.join("out/stores", `${domain}.json`);
  if (fs.existsSync(out) && !process.argv.includes("--force")) {
    console.log(`[${i + 1}/${targets.length}] ${domain} — zaten var, atlandı`);
    continue;
  }
  process.stdout.write(`[${i + 1}/${targets.length}] ${domain} … `);

  const products = await fetchCatalog(domain);
  if (!products) { console.log("katalog alınamadı"); continue; }

  const origin = `https://www.${domain}`;
  const slim = slimProducts(origin, products);
  const cats = categoryBreakdown(slim);

  const payload = {
    domain,
    fetchedAt: new Date().toISOString(),
    productCount: slim.length,
    imageCount: slim.reduce((a, p) => a + p.nImages, 0),
    withoutDescription: slim.filter((p) => !p.hasDesc).length,
    categories: cats,
    products: slim,
  };
  fs.writeFileSync(out, JSON.stringify(payload));
  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log(`${slim.length} ürün · ${cats.root.length} kök kategori · ${kb} KB`);
  await sleep(500);
}
console.log("\nout/stores/ hazır");
