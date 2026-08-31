// 🚻 Mevcut Editoryal (tarz 1) GİYİM stillerini "woman" olarak etiketler.
//
// Bağlam (24 Ağu 2026, kullanıcı kararı): 6088 giyim + Editoryal kaydın
// tamamının cinsiyeti boştu (eski backlog; eklenti o dönem cinsiyet
// göndermiyordu). Bu yüzden uygulamada "Editoryal + kadın/erkek" istendiğinde
// havuzda eşleşme çıkmıyor, cinsiyetsiz kademeye düşülüyordu.
//
// ⚠️ ÇOCUK GİYİMİ HARİÇ (kullanıcı şartı). İki koruma birden:
//   1) category_slug = 'kidswear'
//   2) estimated_age < 15  → slug'ı "apparel" olsa bile çocuk karesi
//      yakalansın. (Yaş eşiği autoGlobalStyle'daki kuralla aynı.)
//
// ⚠️ PRODÜKSİYON YAZIMI. Önce --dry. Etkilenen id'ler yedeklenir,
// --rollback <dosya> ile gender tekrar NULL yapılır.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const PAGE = 1000;
// ⚠️ 1000 id'lik IN listesi PostgREST'te 400 veriyor (24 Ağu'da yaşandı).
const UPDATE_CHUNK = 150;
const KID_AGE_LIMIT = 15;

const scope = (q) =>
  q
    .in("user_id", ["auto", "global"])
    .eq("product_category", "clothing")
    .eq("style_approach", 1)
    .is("gender", null);

async function collect() {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await scope(
      sb.from("style_profiles").select("id, category_slug, estimated_age"),
    ).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

const isKid = (r) =>
  r.category_slug === "kidswear" ||
  (Number.isFinite(Number(r.estimated_age)) &&
    Number(r.estimated_age) < KID_AGE_LIMIT);

async function main() {
  const mode = process.argv.includes("--apply")
    ? "apply"
    : process.argv.includes("--rollback")
      ? "rollback"
      : "dry";

  if (mode === "rollback") {
    const file = process.argv[process.argv.indexOf("--rollback") + 1];
    const ids = JSON.parse(fs.readFileSync(file, "utf8")).ids;
    console.log(`↩️  ${ids.length} kaydın gender'ı NULL'a döndürülüyor…`);
    for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
      const { error } = await sb
        .from("style_profiles")
        .update({ gender: null })
        .in("id", ids.slice(i, i + UPDATE_CHUNK));
      if (error) throw new Error(error.message);
    }
    console.log("✅ Geri alındı.");
    return;
  }

  const rows = await collect();
  const kids = rows.filter(isKid);
  const targets = rows.filter((r) => !isKid(r));

  console.log(`🔎 Giyim + Editoryal, cinsiyeti boş: ${rows.length}`);
  console.log(`   ${kids.length} çocuk kaydı ATLANIYOR (kidswear / yaş<${KID_AGE_LIMIT})`);
  console.log(`   ${targets.length} kayıt "woman" olarak etiketlenecek`);

  if (mode === "dry") {
    console.log("🧪 KURU ÇALIŞMA — hiçbir şey yazılmadı. --apply ile uygula.");
    return;
  }

  const ids = targets.map((r) => r.id);
  const backup = path.join(
    __dirname,
    `backup-editorial-woman-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  fs.writeFileSync(backup, JSON.stringify({ ids }, null, 2));
  console.log(`💾 Yedek: ${backup}`);

  for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
    const { error } = await sb
      .from("style_profiles")
      .update({ gender: "woman" })
      .in("id", ids.slice(i, i + UPDATE_CHUNK));
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
