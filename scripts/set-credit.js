#!/usr/bin/env node
/* Kullanım (server klasöründe):
 *   node scripts/set-credit.js nodselemen@gmail.com 0        → bakiyeyi 0 yapar, eski değeri yazdırır
 *   node scripts/set-credit.js nodselemen@gmail.com 85420    → geri alır
 *   node scripts/set-credit.js nodselemen@gmail.com          → sadece mevcut değeri gösterir
 * .env'deki SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY kullanılır; başka hiçbir alan değişmez. */
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const [email, valueArg] = process.argv.slice(2);
if (!email) { console.error("e-posta gerekli"); process.exit(1); }
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

(async () => {
  const { data: rows, error } = await sb.from("users").select("id, email, credit_balance, is_pro").ilike("email", email.trim());
  if (error) throw error;
  if (!rows?.length) { console.error("kullanıcı bulunamadı:", email); process.exit(1); }
  const u = rows[0];
  console.log(`mevcut → ${u.email}: credit_balance=${u.credit_balance} is_pro=${u.is_pro}`);
  if (valueArg == null) return;
  const next = Number(valueArg);
  if (!Number.isFinite(next) || next < 0) { console.error("geçersiz miktar"); process.exit(1); }
  const { error: e2 } = await sb.from("users").update({ credit_balance: next }).eq("id", u.id);
  if (e2) throw e2;
  console.log(`güncellendi → credit_balance=${next}   (geri almak için: node scripts/set-credit.js ${u.email} ${u.credit_balance})`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
