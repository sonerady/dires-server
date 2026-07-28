// 🔎 SALT OKUNUR tarama: mevcut stil profillerinin promptlarında cinsiyet/yaş
// ifadesi var mı? Hiçbir şey yazmaz, sadece raporlar.
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// Kelime sınırlı: "men" → "women" içinde eşleşmesin, "male" → "female"den ayrı kalsın.
const TERMS = [
  "woman","women","man","men","male","female","girl","girls","boy","boys",
  "lady","ladies","gentleman","guy","guys","she","he","her","hers","his",
  "herself","himself","young","youthful","teen","teenage","teenager","adult",
  "mature","elderly","child","children","kid","kids","toddler","baby",
  "twenties","thirties","20s","30s","40s","feminine","masculine",
];
const RE = new RegExp(`\\b(${TERMS.join("|")})\\b`, "gi");

(async () => {
  for (const table of ["style_profiles", "refiner_style_profiles"]) {
    const { data, error } = await supabase
      .from(table)
      .select("id, user_id, name, style_prompt, status")
      .not("style_prompt", "is", null);
    if (error) {
      console.log(`❌ ${table}: ${error.message}`);
      continue;
    }
    const hits = [];
    for (const row of data || []) {
      const found = [...new Set((String(row.style_prompt).match(RE) || []).map((w) => w.toLowerCase()))];
      if (found.length) hits.push({ row, found });
    }
    console.log(`\n=== ${table}: ${data.length} promptlu profil, ${hits.length} tanesinde ifade var ===`);
    for (const { row, found } of hits) {
      let title = row.name;
      try { const p = JSON.parse(row.name); title = p.tr || p.en || row.name; } catch {}
      console.log(`  • ${row.id}  ${row.user_id === "global" ? "[GLOBAL]" : "[user]"}  ${String(title).slice(0, 34)}`);
      console.log(`      ${found.join(", ")}`);
    }
  }
})();
