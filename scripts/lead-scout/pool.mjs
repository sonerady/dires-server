#!/usr/bin/env node
// 🏊 Arama havuzu — canlı aramanın sorgulayacağı Shopify alan adları.
//
// Bu liste için katalog İNDİRİLMEZ. Shopify'ın /search/suggest.json uç noktası
// her mağazada açık olduğundan, aramak için alan adı yeterli.
//
// Tespit: Shopify mağazaları 23.227.38.x bloğuna çözülüyor — tek DNS sorgusu.
// Cloudflare arkasındaki Shopify mağazaları bu testi geçemez; onlar için
// --probe ile /products.json'a bakılır (yavaş ama kesin).
//
//   node pool.mjs candidates.txt            DNS ile ayıkla
//   node pool.mjs candidates.txt --probe    DNS'te bulunamayanları HTTP ile dene
//   node pool.mjs --from-rows               panele kayıtlı Shopify'ları ekle

import fs from "node:fs";
import dns from "node:dns/promises";

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith("--"));
const PROBE = argv.includes("--probe");
const VERIFY = argv.includes("--verify");
const POOL = "pool.txt";
const SHOPIFY_NET = "23.227.38.";

const norm = (d) => String(d || "").trim().toLowerCase()
  .replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");

async function isShopifyDns(domain) {
  for (const host of [domain, `www.${domain}`]) {
    try {
      const a = await dns.resolve4(host);
      if (a.some((ip) => ip.startsWith(SHOPIFY_NET))) return true;
    } catch { /* sıradaki */ }
  }
  return false;
}

async function isShopifyHttp(domain) {
  for (const origin of [`https://www.${domain}`, `https://${domain}`]) {
    try {
      const res = await fetch(`${origin}/products.json?limit=1`, {
        headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const j = await res.json();
      if (Array.isArray(j?.products)) return true;
    } catch { /* sıradaki */ }
  }
  return false;
}

const existing = new Set(fs.existsSync(POOL)
  ? fs.readFileSync(POOL, "utf8").split("\n").map(norm).filter(Boolean) : []);

let candidates = [];
if (argv.includes("--from-rows") && fs.existsSync("out/rows.jsonl")) {
  for (const l of fs.readFileSync("out/rows.jsonl", "utf8").split("\n")) {
    if (!l.trim()) continue;
    try { const r = JSON.parse(l); if (r.platform === "shopify") candidates.push(r.domain); } catch {}
  }
}
if (file) candidates.push(...fs.readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")));

candidates = [...new Set(candidates.map(norm).filter((d) => d.includes(".")))];
const todo = candidates.filter((d) => !existing.has(d));
console.log(`${candidates.length} aday · ${todo.length} yeni · havuzda ${existing.size}\n`);

const found = [];
const missed = [];
const CONC = 40;
for (let i = 0; i < todo.length; i += CONC) {
  const chunk = todo.slice(i, i + CONC);
  const res = await Promise.all(chunk.map(isShopifyDns));
  chunk.forEach((d, k) => (res[k] ? found : missed).push(d));
  process.stdout.write(`\r  DNS: ${Math.min(i + CONC, todo.length)}/${todo.length} · bulunan ${found.length}`);
}
console.log("");

if (PROBE && missed.length) {
  console.log(`  ${missed.length} alan adı HTTP ile deneniyor…`);
  for (let i = 0; i < missed.length; i += 8) {
    const chunk = missed.slice(i, i + 8);
    const res = await Promise.all(chunk.map(isShopifyHttp));
    chunk.forEach((d, k) => { if (res[k]) found.push(d); });
    process.stdout.write(`\r  HTTP: ${Math.min(i + 8, missed.length)}/${missed.length} · toplam ${found.length}`);
  }
  console.log("");
}

let all = [...new Set([...existing, ...found])].sort();

// 🧪 Doğrulama: DNS "Shopify" dese de her mağaza /search/suggest.json'u
// dışarı açmıyor (Hydrogen tema, bot koruması, kapalı arama). Cevap vermeyen
// alan adı canlı aramada sadece zaman yakıyor — havuzdan çıkarıyoruz.
if (VERIFY) {
  console.log(`\n  ${all.length} alan adı arama uç noktası için doğrulanıyor…`);
  const ok = [];
  for (let i = 0; i < all.length; i += 12) {
    const chunk = all.slice(i, i + 12);
    const res = await Promise.all(chunk.map(async (d) => {
      try {
        const r = await fetch(`https://www.${d}/search/suggest.json?q=dress&resources[type]=product&resources[limit]=1`,
          { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(9000) });
        if (!r.ok) return false;
        const j = await r.json();
        return Array.isArray(j?.resources?.results?.products);
      } catch { return false; }
    }));
    chunk.forEach((d, k) => { if (res[k]) ok.push(d); });
    process.stdout.write(`\r  doğrulama: ${Math.min(i + 12, all.length)}/${all.length} · çalışan ${ok.length}`);
  }
  console.log(`\n  ${all.length - ok.length} alan adı arama yapmıyor, havuzdan çıkarıldı`);
  all = ok;
}
fs.writeFileSync(POOL, all.join("\n") + "\n");
console.log(`\n+${found.length} yeni · havuz toplam ${all.length}\n  ${POOL}`);
