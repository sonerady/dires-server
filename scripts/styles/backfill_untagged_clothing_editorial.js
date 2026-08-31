// 🏷️ Etiketsiz stil havuzunu "giyim + editoryal" olarak işaretler.
//
// Bağlam (24 Ağu 2026, kullanıcı bilgisi): style_profiles'ta product_category
// ve style_approach alanları 13 Ağu'da eklendi. O tarihten ÖNCE girilen
// kayıtların ikisi de NULL kaldı ve bugüne kadar yalnız "genel havuz" olarak
// kullanıldı. Kullanıcı bunların tamamının giyim + editoryal olduğunu
// bildirdi; bu script o backlog'u etiketler.
//
// ⚠️ PRODÜKSİYON YAZIMI. Çalıştırmadan önce --dry ile sayıyı doğrula.
// Etkilenen id'ler her koşulda bir yedek dosyasına yazılır; geri almak için
// aynı script --rollback <dosya> ile çalıştırılır.
//
// Kullanım:
//   node scripts/styles/backfill_untagged_clothing_editorial.js --dry
//   node scripts/styles/backfill_untagged_clothing_editorial.js --apply
//   node scripts/styles/backfill_untagged_clothing_editorial.js --rollback backup-<zaman>.json
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const TARGET = { product_category: "clothing", style_approach: 1 };
const PAGE = 1000;
// ⚠️ UPDATE parçası ÇOK daha küçük olmalı: 1000 id'lik `IN` listesi PostgREST'te
// URL uzunluk sınırını aşıp 400 "Bad Request" veriyor (canlıda görüldü).
const UPDATE_CHUNK = 150;

// ⚠️ Süzgeç DAR tutuldu: yalnız İKİ alan da boş olan havuz kayıtları.
// Kategorisi dolu ama tarzı boş olan 7 ayakkabı kaydı bilerek dışarıda.
const scope = (q) =>
  q
    .in("user_id", ["auto", "global"])
    .is("product_category", null)
    .is("style_approach", null);

async function collectIds() {
  const ids = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await scope(
      sb.from("style_profiles").select("id"),
    ).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    ids.push(...data.map((r) => r.id));
    if (data.length < PAGE) break;
  }
  return ids;
}

async function main() {
  const mode = process.argv.includes("--apply")
    ? "apply"
    : process.argv.includes("--rollback")
      ? "rollback"
      : "dry";

  if (mode === "rollback") {
    const file = process.argv[process.argv.indexOf("--rollback") + 1];
    if (!file) throw new Error("--rollback <yedek dosyası> gerekli");
    const ids = JSON.parse(fs.readFileSync(file, "utf8")).ids;
    console.log(`↩️  ${ids.length} kayıt NULL'a döndürülüyor…`);
    for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
      const chunk = ids.slice(i, i + UPDATE_CHUNK);
      const { error } = await sb
        .from("style_profiles")
        .update({ product_category: null, style_approach: null })
        .in("id", chunk);
      if (error) throw new Error(error.message);
      if (i % (UPDATE_CHUNK * 10) === 0)
        console.log(`   ${Math.min(i + UPDATE_CHUNK, ids.length)}/${ids.length}`);
    }
    console.log("✅ Geri alındı.");
    return;
  }

  const ids = await collectIds();
  console.log(`🔎 Etiketsiz havuz kaydı: ${ids.length}`);
  console.log(`   Yazılacak: ${JSON.stringify(TARGET)}`);

  if (mode === "dry") {
    console.log("🧪 KURU ÇALIŞMA — hiçbir şey yazılmadı. --apply ile uygula.");
    return;
  }

  const backup = path.join(
    __dirname,
    `backup-untagged-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  fs.writeFileSync(backup, JSON.stringify({ target: TARGET, ids }, null, 2));
  console.log(`💾 Yedek: ${backup}`);

  for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
    const chunk = ids.slice(i, i + UPDATE_CHUNK);
    const { error } = await sb
      .from("style_profiles")
      .update(TARGET)
      .in("id", chunk);
    if (error) throw new Error(`${error.message} (parça ${i})`);
    if (i % (UPDATE_CHUNK * 10) === 0)
      console.log(`   ${Math.min(i + UPDATE_CHUNK, ids.length)}/${ids.length}`);
  }
  console.log("✅ Bitti.");
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
