#!/usr/bin/env node
// 🏷️ Anasayfa listing kartı başlığının yanında dönen pazaryeri logoları
// (16 Eyl 2026). Kaynak: Wikimedia Commons SVG (arka plansız, vektör) →
// sharp ile PNG'ye çevrilir, şeffaf kenar boşlukları kırpılır (trim), iki
// varyant yazılır: `-light.png` (orijinal renkler, açık tema) ve `-dark.png`
// (beyaz siluet, koyu tema). Çıktı: client/assets/marketplace_logos/
// Çalıştır (server klasöründe): node scripts/fetch-marketplace-logos.cjs
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const sharp = require("sharp");

const UA = "DiressAssetFetcher/1.0 (https://diress.ai; info@monailisa.com)";
const OUT = path.resolve(__dirname, "../../client/assets/marketplace_logos");
// Her marka için Commons dosya adayları (ilk bulunan kullanılır)
const BRANDS = {
  amazon: ["Amazon_logo.svg", "Amazon_2024.svg"],
  etsy: ["Etsy_logo.svg", "Etsy_logo_2017.svg"],
  shopify: ["Shopify_logo_2018.svg", "Shopify_logo.svg"],
  ebay: ["EBay_logo.svg", "Ebay_logo.svg"],
  tiktok: ["TikTok_logo.svg", "Tiktok_logo.svg"],
  temu: ["Temu_logo.svg", "Temu_Logo.svg"],
  shein: ["Shein_logo.svg", "SHEIN_logo.svg", "Shein_Logo.svg"],
  walmart: ["Walmart_logo.svg", "Walmart_logo_(2025).svg"],
  aliexpress: ["Aliexpress_logo.svg", "AliExpress_logo.svg"],
  shopee: ["Shopee_logo.svg", "Shopee.svg"],
  trendyol: ["Trendyol_logo.svg", "Trendyol_online_logo.svg"],
  mercadolibre: ["Mercado_Libre_logo.svg", "MercadoLibre.svg", "Logo_MercadoLibre.svg"],
  lazada: ["Lazada_(2019).svg", "Lazada_logo.svg", "Lazada.svg"],
  taobao: ["Taobao_logo.svg", "Taobao_Logo.svg"],
  jd: ["JD.com_logo.svg", "JD.com_Logo.svg", "Jingdong_logo.svg"],
  alibaba: ["Alibaba_Group_logo.svg", "Alibaba.com_logo.svg", "Alibaba_logo.svg"],
  flipkart: ["Flipkart_logo.svg", "Flipkart_Logo.svg"],
  coupang: ["Coupang_logo.svg", "Coupang_Logo.svg"],
  rakuten: ["Rakuten_Global_Brand_Logo.svg", "Rakuten_logo.svg"],
  ozon: ["Ozon_logo.svg", "Ozon_Logo.svg", "OZON_logo.svg"],
  wildberries: ["Wildberries_logo.svg", "Wildberries_Logo.svg"],
  noon: ["Noon_logo.svg", "Noon.com_logo.svg"],
  hepsiburada: ["Hepsiburada_logo.svg", "Hepsiburada_Logo.svg"],
  zalando: ["Zalando_logo.svg", "Zalando_Logo.svg"],
  wayfair: ["Wayfair_logo.svg", "Wayfair_Logo.svg"],
  pinduoduo: ["Pinduoduo_logo.svg", "Pinduoduo.svg"],
  douyin: ["Douyin_logo.svg", "Douyin.svg"],
};

async function resolveCommonsUrl(title) {
  const api = "https://commons.wikimedia.org/w/api.php";
  const r = await axios.get(api, {
    params: { action: "query", titles: `File:${title}`, prop: "imageinfo", iiprop: "url|mime", format: "json" },
    headers: { "User-Agent": UA }, timeout: 20000,
  });
  const pages = r.data?.query?.pages || {};
  for (const p of Object.values(pages)) {
    const info = p?.imageinfo?.[0];
    if (info?.url) return { url: info.url, mime: info.mime };
  }
  return null;
}
async function searchCommons(brand) {
  const api = "https://commons.wikimedia.org/w/api.php";
  const r = await axios.get(api, {
    params: { action: "query", list: "search", srsearch: `${brand} logo svg`, srnamespace: 6, srlimit: 5, format: "json" },
    headers: { "User-Agent": UA }, timeout: 20000,
  });
  const hits = r.data?.query?.search || [];
  const svg = hits.find((h) => /\.svg$/i.test(h.title));
  return svg ? svg.title.replace(/^File:/, "") : null;
}

// Tüm logolar aynı 4:1 tuvale (960×240) ortalanır: kırpılmış logo tuvale
// sığdırılır (genişlik ≤ 960, yükseklik ≤ 240) → uygulamada hepsi aynı kutuda,
// aynı görsel ağırlıkta görünür (biri dev, biri minik olmaz).
const CANVAS_W = 960, CANVAS_H = 240;
async function render(brand, svgBuffer) {
  const trimmed = await sharp(svgBuffer, { density: 400 }).resize({ height: 480, fit: "inside" }).png().trim().toBuffer();
  const fitted = await sharp(trimmed).resize({ width: CANVAS_W, height: CANVAS_H, fit: "inside", withoutEnlargement: false }).png().toBuffer();
  const fm = await sharp(fitted).metadata();
  const light = await sharp({ create: { width: CANVAS_W, height: CANVAS_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: fitted, left: Math.round((CANVAS_W - fm.width) / 2), top: Math.round((CANVAS_H - fm.height) / 2) }])
    .png().toBuffer();
  const meta = await sharp(light).metadata();
  // Koyu tema: alfa kanalı beyaz silüete
  const alpha = await sharp(light).ensureAlpha().extractChannel("alpha").toBuffer();
  const dark = await sharp({ create: { width: meta.width, height: meta.height, channels: 3, background: "#FFFFFF" } })
    .joinChannel(alpha)
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(OUT, `${brand}-light.png`), light);
  fs.writeFileSync(path.join(OUT, `${brand}-dark.png`), dark);
  return meta;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = {};
  for (const [brand, candidates] of Object.entries(BRANDS)) {
    let found = null;
    for (const title of candidates) {
      try { found = await resolveCommonsUrl(title); } catch (e) {}
      if (found) { manifest[brand] = title; break; }
    }
    if (!found) {
      const t = await searchCommons(brand).catch(() => null);
      if (t) { try { found = await resolveCommonsUrl(t); manifest[brand] = t; } catch (e) {} }
    }
    if (!found) { console.log(`✗ ${brand}: Commons'ta bulunamadı`); continue; }
    try {
      const file = await axios.get(found.url, { responseType: "arraybuffer", headers: { "User-Agent": UA }, timeout: 30000 });
      const meta = await render(brand, Buffer.from(file.data));
      console.log(`✓ ${brand} ← ${manifest[brand]} (${meta.width}x${meta.height})`);
    } catch (e) {
      console.log(`✗ ${brand}: ${e?.message}`);
    }
  }
  fs.writeFileSync(path.join(OUT, "sources.json"), JSON.stringify(manifest, null, 2));
  console.log("\nBitti →", OUT);
})().catch((e) => { console.error("✗", e?.message || e); process.exit(1); });
