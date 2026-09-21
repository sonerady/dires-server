#!/usr/bin/env node
// 🎯 Diress Lead Scout — platformdan bağımsız.
//
//   node run.mjs --in seeds-sal.txt
//   node run.mjs --no-jev            Jev'siz (anahtarsız)
//   node run.mjs --offset 20 --limit 20
//   node run.mjs --min-fit 2 --median 4
//
// Çıktı: out/rows.jsonl (satır satır, devam edilebilir) + leads.csv/json

import fs from "node:fs";
import { normalizeDomain, sleep } from "./lib/shopify.mjs";
import { loadStore, profileStore, pickCovers } from "./lib/catalog.mjs";
import { opportunity } from "./lib/shopify.mjs";
import { findRoleEmails } from "./lib/contact.mjs";
import { judge, openingLine, provider } from "./lib/jev.mjs";

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
const has = (n) => argv.includes(n);

const inFile = flag("--in", "seeds.txt");
const offset = Number(flag("--offset", "0")) || 0;
const limit = Number(flag("--limit", "0")) || 0;
const useJev = !has("--no-jev") && Boolean(provider());
const minFit = flag("--min-fit") === null ? 2 : Number(flag("--min-fit"));
const CATEGORY_MEDIAN = flag("--median") === null ? 4 : Number(flag("--median"));
// Aynı panelde birden çok sektör tutulabilsin diye her satıra segment etiketi.
// Referans segmenti: iyi çekim yapan markalar "lead değil" diye elenmesin —
// onları kıyas havuzu olarak tutuyoruz.
const KEEP_ALL = has("--keep-all");
const SEGMENT = flag("--segment", inFile.replace(/^seeds-?/, "").replace(/\.txt$/, "") || "genel");

if (!has("--no-jev") && !provider()) console.warn("⚠️  Jev anahtarı yok — sadece katalog profili.\n");

const domains = [...new Set(
  fs.readFileSync(inFile, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    .map(normalizeDomain).filter((d) => d.includes(".")),
)];

fs.mkdirSync("out", { recursive: true });
fs.mkdirSync("out/stores", { recursive: true });
const JSONL = "out/rows.jsonl";

const done = new Set();
if (fs.existsSync(JSONL)) {
  for (const l of fs.readFileSync(JSONL, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try { done.add(JSON.parse(l).domain); } catch {}
  }
}

const slice = limit ? domains.slice(offset, offset + limit) : domains.slice(offset);
const todo = slice.filter((d) => !done.has(d));
console.log(`${domains.length} aday · bu turda ${todo.length} · Jev: ${useJev ? provider() : "kapalı"} · medyan ${CATEGORY_MEDIAN}\n`);

const write = (o) => fs.appendFileSync(JSONL, JSON.stringify(o) + "\n");

for (const [i, domain] of todo.entries()) {
  process.stdout.write(`[${i + 1}/${todo.length}] ${domain} … `);

  let store;
  try { store = await loadStore(domain); } catch { store = null; }
  if (!store) { console.log("katalog okunamadı"); write({ domain, keep: false, reason: "no_catalog", segment: SEGMENT }); continue; }

  const prof = profileStore(domain, store);
  const opp = opportunity(prof, CATEGORY_MEDIAN);

  if (prof.apparelRatio < 0.05) {
    console.log(`[${prof.platform}] giyim değil (${prof.apparelRatio})`);
    write({ domain, keep: false, reason: "not_apparel", segment: SEGMENT, platform: prof.platform, products: prof.products });
    continue;
  }

  const contact = await findRoleEmails(domain);
  const covers = pickCovers(store, 8);

  // Ürün detayları panelde gösterilecek — mağaza başına ayrı dosya.
  fs.writeFileSync(`out/stores/${domain}.json`, JSON.stringify({
    domain, platform: store.platform, sampled: store.sampled,
    fetchedAt: new Date().toISOString(),
    productCount: store.products.length,
    imageCount: store.products.reduce((a, p) => a + p.nImages, 0),
    withoutDescription: store.products.filter((p) => !p.hasDesc).length,
    categories: { root: countBy(store.products) },
    products: store.products,
  }));

  let verdict = null;
  if (useJev) {
    try { verdict = await judge(prof, opp, contact); } catch (err) { verdict = { error: err.message }; }
  }

  // ⚠️ Ölçüm güvenilirliği: ürün başına yarım görselin altı, mağazanın
  // gerçekten görselsiz olduğunu değil, bizim görselleri eşleştiremediğimizi
  // gösterir (bilinmeyen tema, farklı dosya adlandırması). Lead sayılmaz.
  const suspect = prof.imagesPerProduct < 0.5 || (prof.sampled && prof.imageSpread === 0);

  const fit = verdict?.leadFit ?? null;
  const keep = suspect ? false : (KEEP_ALL ? true : (fit === null ? prof.pctOneImage >= 30 : fit >= minFit));

  console.log(
    `[${prof.platform}${prof.sampled ? " örneklem" : ""}] ${prof.products} ürün · ${prof.imagesPerProduct} foto/ürün · %${prof.pctOneImage} tek` +
    (fit !== null ? ` · fit ${fit.toFixed(2)}` : "") + ` · ${contact.emails[0] || "mail yok"} · ${keep ? "✅" : "—"}`,
  );

  write({ ...prof, ...opp, segment: SEGMENT, emails: contact.emails, phones: contact.phones, covers, verdict,
          openingLine: openingLine(prof, opp), suspect, keep,
          reason: keep ? "lead" : suspect ? "measure_suspect" : "low_fit" });
  await sleep(400);
}

function countBy(ps) {
  const m = new Map();
  for (const p of ps) {
    const t = (p.type || "").split(">")[0].trim() || "(kategorisiz)";
    m.set(t, (m.get(t) || 0) + 1);
  }
  return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

// ---- rapor ----
const all = fs.readFileSync(JSONL, "utf8").split("\n").filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const leads = all.filter((r) => r.keep);
const rejected = all.filter((r) => !r.keep);
leads.sort((a, b) => (b.verdict?.leadFit ?? 0) - (a.verdict?.leadFit ?? 0) || (b.missingPhotos ?? 0) - (a.missingPhotos ?? 0));

fs.writeFileSync("out/leads.json", JSON.stringify(leads, null, 2));
const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
fs.writeFileSync("out/leads.csv", [
  "domain,platform,urun,foto_per_urun,yuzde_tek_fotolu,eksik_foto,lead_fit,email,telefon,ilk_cumle",
  ...leads.map((r) => [r.domain, r.platform, r.products, r.imagesPerProduct, r.pctOneImage, r.missingPhotos,
    r.verdict?.leadFit?.toFixed?.(2) ?? "", r.emails?.[0] ?? "", r.phones?.[0] ?? "", q(r.openingLine)].join(",")),
].join("\n"));
fs.writeFileSync("out/rejected.csv", ["domain,platform,reason,urun,foto_per_urun",
  ...rejected.map((r) => `${r.domain},${r.platform ?? ""},${r.reason},${r.products ?? ""},${r.imagesPerProduct ?? ""}`)].join("\n"));

console.log(`\n${leads.length} aday · ${rejected.length} elendi\n  out/leads.csv\n  out/rows.jsonl`);
