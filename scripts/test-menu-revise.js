// 🧪 Menü stüdyosu — REVİZE kipi testi (geçici, silinebilir)
// Doğruladığı iki şey:
//  1) Birikmiş istekler korunuyor mu (önceki düzenleme yeni düzenlemede kaybolmuyor)
//  2) Tasarım tutarlı kalıyor mu (yazı tipi, renk, @page, düzen aynı mı)
require("dotenv").config();
const { supabaseAdmin: db } = require("../src/supabaseClient");
const { designMenu } = require("../src/utils/menuStudioAstra");

const PROJECT_ID = process.argv[2];

// Tasarımın parmak izi: bunlar değişmemeli
function fingerprint(html) {
  const fonts = [...html.matchAll(/fonts\.googleapis\.com\/css2\?([^"']+)/g)].map((m) => m[1]).sort();
  const families = [...new Set([...html.matchAll(/font-family:\s*([^;]+)/g)].map((m) => m[1].trim()))].sort();
  const colors = [...new Set([...html.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase()))].sort();
  const page = (html.match(/@page\s*\{[^}]*\}/) || [""])[0].replace(/\s+/g, " ");
  const images = [...new Set([...html.matchAll(/https?:\/\/[^"')\s]+\.(?:png|jpe?g|webp)/gi)].map((m) => m[0]))].sort();
  const breaks = (html.match(/page-break-after\s*:\s*always/g) || []).length;
  return { fonts, families, colors, page, images, breaks };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  const { data: project } = await db.from("admin_menu_projects").select("*").eq("id", PROJECT_ID).maybeSingle();
  if (!project?.html) throw new Error("Bu projede tasarım yok");
  const { data: items } = await db
    .from("admin_menu_items")
    .select("*")
    .eq("project_id", PROJECT_ID)
    .eq("archived", false)
    .order("position");
  const { data: assets } = await db.from("admin_menu_assets").select("*").eq("project_id", PROJECT_ID);

  const base = project.html;
  const f0 = fingerprint(base);
  console.log(`\n📄 temel belge: ${base.length} karakter, ${f0.images.length} görsel, ${f0.colors.length} renk, ${f0.breaks} sayfa sonu`);

  // 1. tur — ilk düzenleme
  const req1 = "Her yemeğin altına içindekileri küçük punto ile yaz.";
  console.log(`\n▶️  1. düzenleme: ${req1}`);
  const html1 = await designMenu({ project, items, assets, feedback: req1, standing: [], baseHtml: base });
  require("fs").writeFileSync("/tmp/menu-revise-1.html", html1);
  const f1 = fingerprint(html1);

  // 2. tur — ikinci düzenleme, 1. istek HÂLÂ geçerli olmalı
  const req2 = "Restoran adının altına küçük harflerle EST. 2019 ekle.";
  console.log(`▶️  2. düzenleme: ${req2}`);
  const html2 = await designMenu({ project, items, assets, feedback: req2, standing: [req1], baseHtml: html1 });
  const f2 = fingerprint(html2);

  console.log("\n─── TASARIM TUTARLILIĞI (temel → 1 → 2) ───");
  for (const k of ["fonts", "families", "page", "images", "breaks"]) {
    console.log(`${same(f0[k], f1[k]) && same(f1[k], f2[k]) ? "✅" : "❌"} ${k}`);
  }
  const lost = f0.colors.filter((c) => !f2.colors.includes(c));
  const added = f2.colors.filter((c) => !f0.colors.includes(c));
  console.log(`${lost.length === 0 ? "✅" : "❌"} renkler — kaybolan: ${lost.join(",") || "yok"} | eklenen: ${added.join(",") || "yok"}`);

  console.log("\n─── İSTEK BİRİKİMİ ───");
  console.log(`${/EST\.?\s*2019/i.test(html2) ? "✅" : "❌"} 2. istek uygulandı (EST. 2019)`);
  const grew = html2.length > base.length;
  console.log(`${grew ? "✅" : "❌"} 1. istek hâlâ duruyor (belge büyüdü: ${base.length} → ${html2.length})`);

  require("fs").writeFileSync("/tmp/menu-revise-2.html", html2);
  console.log("\nÇıktı: /tmp/menu-revise-2.html");
  process.exit(0);
})().catch((e) => {
  console.error("HATA:", e.message);
  process.exit(1);
});
