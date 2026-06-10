// Admin ASO takip API'si — aso_* tablolarından okur, manuel snapshot tetikler.
const express = require("express");
const router = express.Router();
const { supabaseAdmin, supabase } = require("../supabaseClient");
const { runAsoSnapshot } = require("../services/asoTracker");

const db = supabaseAdmin || supabase;

// Genel bakış: takip edilen her kelime için son sıra + baz çizgisi + 7 gün önceki sıra,
// ülke başına son rating snapshot'ı ve olay listesi.
router.get("/aso/overview", async (req, res) => {
  try {
    const { data: tracked, error: tErr } = await db
      .from("aso_tracked_keywords")
      .select("id, country, keyword, baseline_rank, baseline_date, active")
      .eq("active", true)
      .order("country")
      .order("keyword");
    if (tErr) throw tErr;

    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const { data: snaps, error: sErr } = await db
      .from("aso_keyword_snapshots")
      .select("snapshot_date, country, keyword, rank, total_results")
      .gte("snapshot_date", since)
      .order("snapshot_date", { ascending: false });
    if (sErr) throw sErr;

    const byKey = {};
    for (const s of snaps || []) {
      const k = `${s.country}::${s.keyword}`;
      (byKey[k] = byKey[k] || []).push(s);
    }

    const keywords = (tracked || []).map((t) => {
      const series = byKey[`${t.country}::${t.keyword}`] || [];
      const latest = series[0] || null;
      const prev = series[1] || null;
      const weekAgo =
        series.find(
          (s) =>
            new Date(latest?.snapshot_date || Date.now()) - new Date(s.snapshot_date) >=
            6.5 * 86400000
        ) || null;
      return {
        id: t.id,
        country: t.country,
        keyword: t.keyword,
        baselineRank: t.baseline_rank,
        baselineDate: t.baseline_date,
        rank: latest ? latest.rank : null,
        snapshotDate: latest ? latest.snapshot_date : null,
        totalResults: latest ? latest.total_results : null,
        prevRank: prev ? prev.rank : null,
        weekAgoRank: weekAgo ? weekAgo.rank : null,
        history: series
          .slice(0, 14)
          .reverse()
          .map((s) => ({ date: s.snapshot_date, rank: s.rank })),
      };
    });

    const { data: appSnaps } = await db
      .from("aso_app_snapshots")
      .select("snapshot_date, country, rating, rating_count")
      .gte("snapshot_date", since)
      .order("snapshot_date", { ascending: false });
    const ratings = {};
    for (const s of appSnaps || []) {
      if (!ratings[s.country]) {
        ratings[s.country] = {
          country: s.country,
          rating: s.rating,
          ratingCount: s.rating_count,
          date: s.snapshot_date,
        };
      }
    }

    const { data: events } = await db
      .from("aso_events")
      .select("id, event_date, label")
      .order("event_date", { ascending: false })
      .limit(20);

    res.json({
      success: true,
      keywords,
      ratings: Object.values(ratings),
      events: events || [],
    });
  } catch (e) {
    console.error("❌ [ADMIN_ASO] overview:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Tek kelimenin tarihçesi
router.get("/aso/history", async (req, res) => {
  try {
    const { country, keyword, days = 90 } = req.query;
    if (!country || !keyword)
      return res.status(400).json({ success: false, error: "country ve keyword gerekli" });
    const since = new Date(Date.now() - Number(days) * 86400000)
      .toISOString()
      .slice(0, 10);
    const { data, error } = await db
      .from("aso_keyword_snapshots")
      .select("snapshot_date, rank, total_results")
      .eq("country", country)
      .eq("keyword", keyword)
      .gte("snapshot_date", since)
      .order("snapshot_date");
    if (error) throw error;
    res.json({ success: true, history: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Manuel snapshot tetikle (uzun sürer: kelime sayısı × ~3.5 sn)
router.post("/aso/run", async (req, res) => {
  try {
    const summary = await runAsoSnapshot();
    res.json({ success: true, summary });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Takip kelimesi ekle / kaldır
router.post("/aso/keywords", async (req, res) => {
  try {
    const { country, keyword } = req.body || {};
    if (!country || !keyword)
      return res.status(400).json({ success: false, error: "country ve keyword gerekli" });
    const { data, error } = await db
      .from("aso_tracked_keywords")
      .upsert(
        { country: String(country).toLowerCase(), keyword: String(keyword).trim(), active: true },
        { onConflict: "country,keyword" }
      )
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, keyword: data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete("/aso/keywords/:id", async (req, res) => {
  try {
    const { error } = await db
      .from("aso_tracked_keywords")
      .update({ active: false })
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
