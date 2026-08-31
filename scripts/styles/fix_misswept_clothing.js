// 🧹 Backfill'in yanlış süpürdüğü kayıtları geri ayıklar (24 Ağu 2026).
//
// backfill_untagged_clothing_editorial.js, etiketsiz 6152 kaydı toptan
// "giyim + editoryal" yaptı. İçlerinde giyim OLMAYAN kayıtlar da vardı:
// admin panelinde giyim seçiliyken takı makro/yakın çekim kareleri göründü.
//
// Teşhis: `category_slug` ayrı bir taksonomi ve TAKI kayıtlarının baskın
// slug'ı "accessories" (takı etiketli 1000 kaydın 872'si). Adları da
// "Macro / Close-up / golden glow" diyor. Yani bunlar takı, kıyafet değil.
//
// ⚠️ PRODÜKSİYON YAZIMI. Önce --dry. Etkilenen satırların ESKİ DEĞERLERİ
// yedeklenir, --rollback <dosya> ile birebir geri yüklenir.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// ⚠️ 1000 id'lik IN listesi PostgREST'te 400 veriyor.
const UPDATE_CHUNK = 150;

// Yalnız BU backfill'in dokunduğu kayıtlar ayıklanır — eklentiyle bilinçli
// etiketlenmiş (ör. clothing+tarz4) kayıtlara ASLA dokunulmaz.
const BACKFILL_BACKUP = process.argv[process.argv.indexOf("--from") + 1] || null;

const RULES = [
  {
    name: "takı (accessories slug + makro/yakın çekim adlar)",
    match: (r) =>
      r.category_slug === "accessories" ||
      /macro|close-?up/i.test(r.name || ""),
    set: { product_category: "jewelry", style_approach: 3 },
  },
  {
    name: "ayakkabı (shoes slug)",
    match: (r) => r.category_slug === "shoes",
    set: { product_category: "shoes", style_approach: null },
  },
  {
    name: "sınıflandırılamaz (home/bakery slug) → etiketsize geri",
    match: (r) => ["home", "bakery"].includes(r.category_slug),
    set: { product_category: null, style_approach: null },
  },
];

async function fetchBackfilled(ids) {
  const rows = [];
  for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
    const chunk = ids.slice(i, i + UPDATE_CHUNK);
    const { data, error } = await sb
      .from("style_profiles")
      .select("id, category_slug, name, product_category, style_approach")
      .in("id", chunk);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
  }
  return rows;
}

async function main() {
  if (!BACKFILL_BACKUP) {
    throw new Error(
      "--from <backfill yedek dosyası> gerekli (hangi kayıtların süpürüldüğünü oradan okuyoruz)",
    );
  }
  const mode = process.argv.includes("--apply")
    ? "apply"
    : process.argv.includes("--rollback")
      ? "rollback"
      : "dry";

  if (mode === "rollback") {
    const file = process.argv[process.argv.indexOf("--rollback") + 1];
    const prev = JSON.parse(fs.readFileSync(file, "utf8")).rows;
    console.log(`↩️  ${prev.length} kayıt eski değerlerine döndürülüyor…`);
    for (const r of prev) {
      const { error } = await sb
        .from("style_profiles")
        .update({
          product_category: r.product_category,
          style_approach: r.style_approach,
        })
        .eq("id", r.id);
      if (error) throw new Error(error.message);
    }
    console.log("✅ Geri alındı.");
    return;
  }

  const ids = JSON.parse(fs.readFileSync(BACKFILL_BACKUP, "utf8")).ids;
  console.log(`🔎 Backfill'in dokunduğu kayıt: ${ids.length}`);
  const rows = await fetchBackfilled(ids);

  const buckets = RULES.map((rule) => ({ rule, rows: [] }));
  const seen = new Set();
  for (const row of rows) {
    for (const b of buckets) {
      if (seen.has(row.id)) break;
      if (b.rule.match(row)) {
        b.rows.push(row);
        seen.add(row.id);
      }
    }
  }

  let total = 0;
  for (const b of buckets) {
    console.log(`   ${String(b.rows.length).padStart(4)} → ${b.rule.name}`);
    console.log(`        ${JSON.stringify(b.rule.set)}`);
    total += b.rows.length;
  }
  console.log(`   ${String(rows.length - total).padStart(4)} → dokunulmaz (giyim kalır)`);

  if (mode === "dry") {
    console.log("🧪 KURU ÇALIŞMA — hiçbir şey yazılmadı. --apply ile uygula.");
    return;
  }

  const backup = path.join(
    __dirname,
    `backup-fix-misswept-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  const affected = buckets.flatMap((b) =>
    b.rows.map((r) => ({
      id: r.id,
      product_category: r.product_category,
      style_approach: r.style_approach,
    })),
  );
  fs.writeFileSync(backup, JSON.stringify({ rows: affected }, null, 2));
  console.log(`💾 Yedek (eski değerlerle): ${backup}`);

  for (const b of buckets) {
    const list = b.rows.map((r) => r.id);
    for (let i = 0; i < list.length; i += UPDATE_CHUNK) {
      const chunk = list.slice(i, i + UPDATE_CHUNK);
      const { error } = await sb
        .from("style_profiles")
        .update(b.rule.set)
        .in("id", chunk);
      if (error) throw new Error(error.message);
    }
    console.log(`   ✔ ${b.rows.length} kayıt: ${b.rule.name}`);
  }
  console.log("✅ Bitti.");
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
