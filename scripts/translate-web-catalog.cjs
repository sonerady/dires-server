#!/usr/bin/env node
// 🌍 web-dashboard arayüz kataloğunu (public/locales/web) 68 dile tamamlar (23 Eyl 2026).
//
// Web'in u("Türkçe kaynak") metinleri anahtarsızdır: web/en.json { "Türkçe": "English" } kataloğu,
// web/<dil>.json aynı Türkçe anahtarla çeviriyi tutar (additions/en.json İngilizce yedek).
// Localization testi katalogdaki her anahtarın her dilde (yer tutucularıyla) bulunmasını ister.
//
// Kullanım:
//   node scripts/translate-web-catalog.cjs --add yeni.json   ({"Türkçe": "English", ...} → en + additions'a ekler, sonra çevirir)
//   node scripts/translate-web-catalog.cjs                    (katalogda olup dilde eksik olan her metni çevirir)
//   node scripts/translate-web-catalog.cjs --check            (yalnız eksikleri say)
const fs = require("fs");
const path = require("path");
const { translate, NAMES } = require("./translate-locale-keys.cjs");

const WEB = path.resolve(__dirname, "../../web-dashboard/public/locales/web");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
// Biçim korunur: dil dosyaları 2 boşluklu ve sonda satır sonu YOK; additions/en.json sonda satır sonu VAR
const writeLocale = (file, obj) => fs.writeFileSync(file, JSON.stringify(obj, null, 2));
const slots = (text) => [...String(text).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(",");

async function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes("--check");
  const addFile = argv.includes("--add") ? argv[argv.indexOf("--add") + 1] : null;
  const workers = argv.includes("--workers") ? Math.max(1, Number(argv[argv.indexOf("--workers") + 1]) || 8) : 8;

  const enFile = path.join(WEB, "en.json"), addFileEn = path.join(WEB, "additions/en.json");
  if (addFile) {
    const fresh = readJson(path.resolve(addFile));
    const en = readJson(enFile), additions = readJson(addFileEn);
    for (const [tr, english] of Object.entries(fresh)) {
      if (typeof english !== "string" || !english.trim()) throw new Error(`İngilizce karşılık yok: ${tr}`);
      en[tr] = english; additions[tr] = english;
    }
    writeLocale(enFile, en);
    fs.writeFileSync(addFileEn, JSON.stringify(additions, null, 2) + "\n");
    console.log(`+ ${Object.keys(fresh).length} metin web/en.json ve additions/en.json'a eklendi`);
  }

  const catalog = readJson(enFile);
  const languages = fs.readdirSync(WEB).filter((f) => f.endsWith(".json") && f !== "en.json").map((f) => f.replace(/\.json$/, ""));
  const unknown = languages.filter((l) => !NAMES[l]);
  if (unknown.length) throw new Error(`Dil adı tanımsız: ${unknown.join(", ")}`);

  let total = 0; const failed = []; const queue = [...languages];
  const worker = async () => {
    while (queue.length) {
      const language = queue.shift();
      const file = path.join(WEB, `${language}.json`);
      const dict = readJson(file);
      const todo = Object.keys(catalog).filter((tr) => typeof dict[tr] !== "string" || !dict[tr].trim());
      if (!todo.length) continue;
      total += todo.length;
      if (check) { console.log(`${language}: ${todo.length} eksik`); continue; }
      try {
        const items = todo.map((tr) => ({ key: tr.slice(0, 60), tr, en: catalog[tr] }));
        const texts = [];
        for (let i = 0; i < items.length; i += 40) texts.push(...(await translate(language, items.slice(i, i + 40))));
        const fresh = readJson(file); // yazmadan hemen önce taze oku
        todo.forEach((tr, i) => { if (slots(texts[i]) !== slots(catalog[tr])) throw new Error(`${language}: yer tutucu bozuldu (${tr})`); fresh[tr] = texts[i]; });
        writeLocale(file, fresh);
        console.log(`✓ ${language}: ${todo.length}`);
      } catch (error) {
        failed.push(language); console.log(`✗ ${language}: ${error.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));
  console.log(`${check ? "Eksik" : "Çevrildi"}: ${total} metin · ${languages.length} dil`);
  if (failed.length) { console.log(`⚠️ Yarım kalan diller (yeniden çalıştır): ${failed.join(", ")}`); process.exitCode = 1; }
}

main().catch((error) => { console.error("❌", error.message); process.exit(1); });
