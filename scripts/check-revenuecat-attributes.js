// RevenueCat Attributes Health Check Script
//
// Bu script Supabase'deki tüm user'ları RevenueCat'te tek tek sorgular
// ve hangi user'ların $fbAnonId attribute'una sahip olduğunu raporlar.
//
// Kullanım:
//   node scripts/check-revenuecat-attributes.js              (tüm user'lar)
//   node scripts/check-revenuecat-attributes.js --limit=100  (ilk 100)
//   node scripts/check-revenuecat-attributes.js --recent=7   (son 7 gün)
//   node scripts/check-revenuecat-attributes.js --csv        (CSV'ye export)
//
// Environment:
//   REVENUECAT_SECRET_API_KEY veya REVENUECAT_SECRET_KEY gerekli
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY gerekli

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// ---- Config ----
const REVENUECAT_KEY =
  process.env.REVENUECAT_SECRET_API_KEY ||
  process.env.REVENUECAT_SECRET_KEY ||
  process.env.REVENUECAT_API_KEY;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!REVENUECAT_KEY) {
  console.error("❌ REVENUECAT_SECRET_API_KEY .env'de yok!");
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY .env'de yok!");
  process.exit(1);
}

// ---- CLI args ----
const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const recentArg = args.find((a) => a.startsWith("--recent="));
const exportCsv = args.includes("--csv");
const userLimit = limitArg ? parseInt(limitArg.split("=")[1], 10) : null;
const recentDays = recentArg ? parseInt(recentArg.split("=")[1], 10) : null;

// ---- Helpers ----
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchSubscriber(userId) {
  try {
    const res = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
      {
        headers: {
          Authorization: `Bearer ${REVENUECAT_KEY}`,
          Accept: "application/json",
        },
      },
    );

    if (res.status === 404) return { status: "not_found" };
    if (res.status === 429) return { status: "rate_limited" };
    if (!res.ok) return { status: "error", code: res.status };

    const data = await res.json();
    const attrs = data?.subscriber?.subscriber_attributes || {};

    return {
      status: "ok",
      hasFbAnonId: !!attrs.$fbAnonId?.value,
      hasIdfa:
        !!attrs.$idfa?.value &&
        attrs.$idfa.value !== "00000000-0000-0000-0000-000000000000",
      hasIdfv: !!attrs.$idfv?.value,
      hasIp: !!attrs.$ip?.value,
      hasEmail: !!attrs.$email?.value || !!attrs.email?.value,
      hasAttConsent: !!attrs.$attConsentStatus?.value,
      fbAnonId: attrs.$fbAnonId?.value || null,
      firstSeen: data?.subscriber?.first_seen || null,
      lastSeen: data?.subscriber?.last_seen || null,
    };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

async function getUsers() {
  // users tablosundan supabase_user_id veya user_id çek
  let query = supabase.from("users").select("id, email, created_at");

  if (recentDays) {
    const since = new Date();
    since.setDate(since.getDate() - recentDays);
    query = query.gte("created_at", since.toISOString());
  }

  query = query.order("created_at", { ascending: false });

  if (userLimit) {
    query = query.limit(userLimit);
  } else {
    query = query.limit(5000); // safety cap
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function main() {
  console.log("🔍 RevenueCat Attribute Health Check\n");
  console.log("Config:");
  console.log(`  User limit: ${userLimit || "unlimited (max 5000)"}`);
  console.log(`  Recent filter: ${recentDays ? `${recentDays} gün` : "none"}`);
  console.log(`  Export CSV: ${exportCsv ? "yes" : "no"}\n`);

  console.log("📥 Supabase'den user'lar çekiliyor...");
  const users = await getUsers();
  console.log(`✅ ${users.length} user bulundu\n`);

  if (users.length === 0) {
    console.log("User yok, çıkılıyor.");
    return;
  }

  const stats = {
    total: users.length,
    ok: 0,
    notFound: 0,
    error: 0,
    rateLimited: 0,
    hasFbAnonId: 0,
    hasIdfa: 0,
    hasIdfv: 0,
    hasIp: 0,
    hasEmail: 0,
    hasAttConsent: 0,
  };

  const results = [];
  const startTime = Date.now();

  console.log("🚀 RevenueCat'e sorgular başlıyor...\n");

  // Rate limit: RevenueCat ~1200 req/min, biz 600 req/min hedefliyoruz (güvenli)
  // Yani her req arası 100ms
  const delayMs = 100;

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const result = await fetchSubscriber(user.id);

    // Stats
    if (result.status === "ok") {
      stats.ok++;
      if (result.hasFbAnonId) stats.hasFbAnonId++;
      if (result.hasIdfa) stats.hasIdfa++;
      if (result.hasIdfv) stats.hasIdfv++;
      if (result.hasIp) stats.hasIp++;
      if (result.hasEmail) stats.hasEmail++;
      if (result.hasAttConsent) stats.hasAttConsent++;
    } else if (result.status === "not_found") {
      stats.notFound++;
    } else if (result.status === "rate_limited") {
      stats.rateLimited++;
      await sleep(2000); // rate limit'te 2sn bekle
    } else {
      stats.error++;
    }

    results.push({
      user_id: user.id,
      email: user.email || "",
      created_at: user.created_at,
      ...result,
    });

    // Progress
    if ((i + 1) % 50 === 0 || i === users.length - 1) {
      const pct = (((i + 1) / users.length) * 100).toFixed(1);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(
        `  ${i + 1}/${users.length} (${pct}%) - ${elapsed}s - fbAnonId: ${stats.hasFbAnonId}`,
      );
    }

    await sleep(delayMs);
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // ---- Report ----
  console.log("\n" + "=".repeat(60));
  console.log("📊 SONUÇLAR");
  console.log("=".repeat(60));
  console.log(`Toplam süre: ${totalTime}s`);
  console.log(`Toplam user: ${stats.total}`);
  console.log(`  ✅ RevenueCat'te bulundu: ${stats.ok}`);
  console.log(`  ⚠️  Bulunamadı (404): ${stats.notFound}`);
  console.log(`  ❌ Hata: ${stats.error}`);
  if (stats.rateLimited > 0) console.log(`  ⏱️  Rate limited: ${stats.rateLimited}`);
  console.log();
  console.log("📌 ATTRIBUTE DOLULUK:");
  const pct = (n) => ((n / stats.ok) * 100).toFixed(1);
  console.log(
    `  $fbAnonId       : ${stats.hasFbAnonId}/${stats.ok} (${pct(stats.hasFbAnonId)}%)`,
  );
  console.log(
    `  $idfa (ATT ok)  : ${stats.hasIdfa}/${stats.ok} (${pct(stats.hasIdfa)}%)`,
  );
  console.log(
    `  $idfv           : ${stats.hasIdfv}/${stats.ok} (${pct(stats.hasIdfv)}%)`,
  );
  console.log(
    `  $ip             : ${stats.hasIp}/${stats.ok} (${pct(stats.hasIp)}%)`,
  );
  console.log(
    `  $email          : ${stats.hasEmail}/${stats.ok} (${pct(stats.hasEmail)}%)`,
  );
  console.log(
    `  $attConsent     : ${stats.hasAttConsent}/${stats.ok} (${pct(stats.hasAttConsent)}%)`,
  );
  console.log("=".repeat(60));
  console.log();
  console.log("💡 YORUM:");
  if (stats.hasFbAnonId / stats.ok < 0.1) {
    console.log(
      "⚠️  $fbAnonId çok düşük (<%10). Build henüz yayılmamış olabilir.",
    );
  } else if (stats.hasFbAnonId / stats.ok < 0.5) {
    console.log("🟡 $fbAnonId dolum halinde. Build yayılmaya devam ediyor.");
  } else if (stats.hasFbAnonId / stats.ok < 0.8) {
    console.log("🟢 $fbAnonId iyi durumda. Çoğunluk güncellendi.");
  } else {
    console.log("✅ $fbAnonId mükemmel. Pipeline tam çalışıyor.");
  }

  // ---- CSV Export ----
  if (exportCsv) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `revenuecat-attributes-${timestamp}.csv`;
    const filepath = path.join(__dirname, filename);

    const headers = [
      "user_id",
      "email",
      "created_at",
      "status",
      "hasFbAnonId",
      "hasIdfa",
      "hasIdfv",
      "hasIp",
      "hasEmail",
      "firstSeen",
      "lastSeen",
    ];
    const rows = results.map((r) =>
      headers
        .map((h) => {
          const v = r[h];
          if (v === null || v === undefined) return "";
          if (typeof v === "boolean") return v ? "1" : "0";
          return String(v).replace(/"/g, '""');
        })
        .map((v) => `"${v}"`)
        .join(","),
    );

    fs.writeFileSync(filepath, [headers.join(","), ...rows].join("\n"));
    console.log(`\n📁 CSV kaydedildi: ${filepath}`);
  }
}

main().catch((err) => {
  console.error("❌ Script hatası:", err);
  process.exit(1);
});
