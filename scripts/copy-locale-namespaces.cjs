#!/usr/bin/env node
// 🔁 Mobil sözlükteki ad alanlarını web sözlüğüne kopyalar (23 Eyl 2026).
// Web public/locales/<dil>.json mobil client/locales/<dil>.json'un eski bir alt kümesi; yeni
// özellikler web'e gelince çevirileri yeniden yaptırmak yerine mobildeki 70 dil taşınır.
// Var olan web anahtarlarına dokunmaz; yalnız eksik yaprakları metne ekler (dosyanın geri kalanı aynı kalır).
// Kullanım: node scripts/copy-locale-namespaces.cjs kitsHub customKit
const fs = require("fs");
const path = require("path");
const { upsertText, upsertJson } = require("./translate-locale-keys.cjs");

const ROOT = path.resolve(__dirname, "../..");
const CLIENT = path.join(ROOT, "client/locales");
const WEB = path.join(ROOT, "web-dashboard/public/locales");
const namespaces = process.argv.slice(2);
if (!namespaces.length) { console.error("Ad alanı verin: node scripts/copy-locale-namespaces.cjs kitsHub"); process.exit(1); }

// Diziler (ör. örnek cümle listeleri) tek değer olarak taşınır — anahtarlı nesneye dönüşmesin
const leaves = (node, prefix, out = []) => {
  if (typeof node === "string" || Array.isArray(node)) out.push([prefix, node]);
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) leaves(v, `${prefix}.${k}`, out);
  return out;
};
const get = (obj, key) => key.split(".").reduce((acc, part) => (acc && typeof acc === "object" ? acc[part] : undefined), obj);

let added = 0;
for (const file of fs.readdirSync(WEB).filter((f) => f.endsWith(".json"))) {
  const source = path.join(CLIENT, file);
  if (!fs.existsSync(source)) continue;
  const client = JSON.parse(fs.readFileSync(source, "utf8"));
  const target = path.join(WEB, file);
  let text = fs.readFileSync(target, "utf8");
  let changed = 0;
  for (const ns of namespaces) {
    for (const [key, value] of leaves(client[ns], ns)) {
      const current = get(JSON.parse(text), key);
      if (Array.isArray(value) ? Array.isArray(current) && current.length : typeof current === "string" && current.trim()) continue;
      text = Array.isArray(value) ? upsertJson(text, key, value) : upsertText(text, key, value);
      changed++;
    }
  }
  if (changed) { JSON.parse(text); fs.writeFileSync(target, text); added += changed; }
}
console.log(`✅ ${namespaces.join(", ")} → web: ${added} metin eklendi`);
