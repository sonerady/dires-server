#!/usr/bin/env node
/**
 * Model havuzu isimlerini onar (10 Eyl 2026).
 * Sorun: DeepSeek 70 dili tek istekte tam döndürmüyordu; eksik diller ilk bulunan
 * (af/am…) isimle dolduruluyor, isim hiç üretilemeyince Gemini'nin "Elif Naz"ı kalıyordu.
 * Bu betik bozuk kayıtları (isim yok / 70 dilde 20'den az farklı isim) yeni üreteçle
 * yeniden adlandırır; kullanıcı kopyalarını da günceller (reprocessOne → names).
 *
 *   cd server && node scripts/repair-pool-names.js            # tüm bozuk kayıtlar
 *   cd server && node scripts/repair-pool-names.js --ids 20,24 # belirli kayıtlar
 *   cd server && node scripts/repair-pool-names.js --dry      # sadece listele
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { supabaseAdmin } = require("../src/supabaseClient");
const { createModelPool } = require("../src/services/modelPool");
const { generatePoolModelNames, callPoolNamesText } = require("../src/utils/poolModelNames");

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const idsArg = args[args.indexOf("--ids") + 1];
const onlyIds = args.includes("--ids") && idsArg ? idsArg.split(",").map(Number).filter(Number.isInteger) : null;
const MIN_DISTINCT = 20;

(async () => {
  if (!supabaseAdmin) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY eksik");
  const pool = createModelPool({
    db: supabaseAdmin, createPortrait: null,
    // Replicate/Gemini ile adlandırma (yedek DeepSeek) — sunucuyla aynı yol.
    generateNames: (input) => generatePoolModelNames({ ...input, callText: callPoolNamesText }),
  });
  const { data: rows, error } = await supabaseAdmin.from("model_pool").select("*").eq("active", true).order("id");
  if (error) throw error;
  const broken = rows.filter((r) => {
    if (onlyIds) return onlyIds.includes(r.id);
    const names = r.names && typeof r.names === "object" ? r.names : {};
    const distinct = new Set(Object.values(names).map((v) => String(v).trim().toLowerCase())).size;
    return distinct < MIN_DISTINCT;
  });
  console.log(`${rows.length} havuz modeli, onarılacak: ${broken.length} → ${broken.map((r) => `#${r.id} ${r.name}`).join(", ")}`);
  if (dry) return;
  let ok = 0, fail = 0;
  for (const row of broken) {
    try {
      await pool.reprocessOne(row, { portrait: false, names: true });
      const { data } = await supabaseAdmin.from("model_pool").select("name,names").eq("id", row.id).single();
      const distinct = new Set(Object.values(data?.names || {})).size;
      console.log(`✓ #${row.id} ${row.name} → ${data?.name} (tr: ${data?.names?.tr || "-"}, ${distinct} farklı isim)`);
      ok++;
    } catch (e) { fail++; console.error(`✗ #${row.id} ${row.name}: ${e.message}`); }
  }
  console.log(`bitti: ${ok} onarıldı, ${fail} hata`);
})().catch((e) => { console.error(e); process.exit(1); });
