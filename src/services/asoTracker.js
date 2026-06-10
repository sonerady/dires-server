// ASO takip servisi: aso_tracked_keywords listesindeki her (ülke, kelime) için
// iTunes Search API'den uygulamanın arama sıralamasını ölçer, günlük snapshot yazar.
// iTunes arama sonucu sırası, App Store arama sıralamasının yaygın kullanılan
// bir proxy'sidir (birebir aynı değildir ama trend takibi için güvenilirdir).
// Harici API key gerektirmez. Rate limit ~20 istek/dk → istekler arası 3.5 sn beklenir.

const cron = require("node-cron");
const { supabaseAdmin, supabase } = require("../supabaseClient");

const db = supabaseAdmin || supabase;
const APP_ID = 6738030797;
const SEARCH_LIMIT = 200;
const REQUEST_DELAY_MS = 3500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "diress-aso-tracker" } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function keywordRank(keyword, country) {
  const url =
    `https://itunes.apple.com/search?term=${encodeURIComponent(keyword)}` +
    `&country=${country}&entity=software&limit=${SEARCH_LIMIT}`;
  const json = await fetchJson(url);
  const results = json.results || [];
  const idx = results.findIndex((r) => r.trackId === APP_ID);
  return {
    rank: idx >= 0 ? idx + 1 : null,
    totalResults: json.resultCount ?? results.length,
  };
}

async function appRating(country) {
  const json = await fetchJson(
    `https://itunes.apple.com/lookup?id=${APP_ID}&country=${country}`
  );
  const app = (json.results || [])[0];
  if (!app) return null;
  return {
    rating: app.averageUserRating ?? null,
    ratingCount: app.userRatingCount ?? null,
  };
}

let running = false;

async function runAsoSnapshot() {
  if (running) return { skipped: true, reason: "already running" };
  running = true;
  const startedAt = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const summary = { date: today, keywords: 0, ranked: 0, countries: 0, errors: [] };

  try {
    const { data: tracked, error } = await db
      .from("aso_tracked_keywords")
      .select("id, country, keyword, baseline_rank, baseline_date")
      .eq("active", true)
      .order("country");
    if (error) throw error;
    if (!tracked || !tracked.length) return { ...summary, reason: "no tracked keywords" };

    // Ülke başına rating snapshot'ı (lookup)
    const countries = [...new Set(tracked.map((t) => t.country))];
    summary.countries = countries.length;
    for (const country of countries) {
      try {
        const r = await appRating(country);
        if (r) {
          await db.from("aso_app_snapshots").upsert(
            {
              snapshot_date: today,
              country,
              rating: r.rating,
              rating_count: r.ratingCount,
            },
            { onConflict: "snapshot_date,country" }
          );
        }
      } catch (e) {
        summary.errors.push(`lookup ${country}: ${e.message}`);
      }
      await sleep(REQUEST_DELAY_MS);
    }

    // Keyword sıralamaları
    for (const t of tracked) {
      try {
        const { rank, totalResults } = await keywordRank(t.keyword, t.country);
        await db.from("aso_keyword_snapshots").upsert(
          {
            snapshot_date: today,
            country: t.country,
            keyword: t.keyword,
            rank,
            total_results: totalResults,
          },
          { onConflict: "snapshot_date,country,keyword" }
        );
        // İlk ölçüm = baz çizgisi
        if (!t.baseline_date) {
          await db
            .from("aso_tracked_keywords")
            .update({ baseline_rank: rank, baseline_date: today })
            .eq("id", t.id);
        }
        summary.keywords++;
        if (rank) summary.ranked++;
      } catch (e) {
        summary.errors.push(`${t.country}/${t.keyword}: ${e.message}`);
      }
      await sleep(REQUEST_DELAY_MS);
    }

    summary.durationSec = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      `📈 [ASO_TRACKER] ${today}: ${summary.keywords} kelime ölçüldü, ${summary.ranked} sıralı, ${summary.errors.length} hata (${summary.durationSec}s)`
    );
    return summary;
  } finally {
    running = false;
  }
}

function startAsoCron() {
  // Her gün 06:10 UTC (09:10 TR) — istekler yavaş aktığı için yoğun saat dışı
  cron.schedule("10 6 * * *", () => {
    runAsoSnapshot().catch((e) =>
      console.error("❌ [ASO_TRACKER] snapshot hatası:", e.message)
    );
  });
  console.log("📈 [ASO_TRACKER] günlük cron kuruldu (06:10 UTC)");
}

module.exports = { runAsoSnapshot, startAsoCron };
