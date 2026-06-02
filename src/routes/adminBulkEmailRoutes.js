// admin bulk email routes — Resend-based mass email to user segments.
// Mounted at /api/admin-dashboard/bulk-email/* with requireAdmin.
// Targets (users.platform = 'ios' | 'android' | 'web'):
//   - user                 single user by id
//   - ios                  all users with platform='ios' and email NOT NULL
//   - android              all users with platform='android' and email NOT NULL
//   - android-inactive     android users with no reference_results in last 30 days
const express = require("express");
const { Resend } = require("resend");
const { supabase, supabaseAdmin } = require("../supabaseClient");
const { getBulkMarketingEmailTemplate } = require("../lib/emailTemplates");

const router = express.Router();
const db = supabaseAdmin || supabase;
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_ADDRESS = "Diress <noreply@diress.ai>";
const RESEND_BATCH_SIZE = 100;
const ALLOWED_TARGETS = new Set([
  "user",
  "ios",
  "android",
  "android-inactive",
  "ios-active-sub",
  "android-active-sub",
]);

async function resolveRecipients({ target, userId, email }) {
  if (target === "user") {
    if (!userId && !email) throw new Error("userId or email required for target=user");
    let query = db
      .from("users")
      .select("id, email, full_name, platform")
      .not("email", "is", null);
    if (email) {
      query = query.ilike("email", email.trim());
    } else {
      query = query.eq("id", userId);
    }
    const { data, error } = await query.limit(1).maybeSingle();
    if (error) throw error;
    return data ? [data] : [];
  }

  if (target === "ios" || target === "android") {
    const { data, error } = await db
      .from("users")
      .select("id, email, full_name, platform")
      .eq("platform", target)
      .not("email", "is", null);
    if (error) throw error;
    return data || [];
  }

  // Active paid subscribers (is_pro = true). Trial-only users (is_in_trial=true,
  // is_pro=false) are NOT included — change to OR-condition if you want trials too.
  if (target === "ios-active-sub" || target === "android-active-sub") {
    const platform = target === "ios-active-sub" ? "ios" : "android";
    const { data, error } = await db
      .from("users")
      .select("id, email, full_name, platform, is_pro, subscription_type")
      .eq("platform", platform)
      .eq("is_pro", true)
      .not("email", "is", null);
    if (error) throw error;
    return data || [];
  }

  if (target === "android-inactive") {
    // android users without any reference_results in last 30 days
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: activeUserIds, error: activeErr } = await db
      .from("reference_results")
      .select("user_id")
      .gte("created_at", cutoff);
    if (activeErr) throw activeErr;
    const activeSet = new Set((activeUserIds || []).map((r) => r.user_id));

    const { data: androidUsers, error: usersErr } = await db
      .from("users")
      .select("id, email, full_name, platform")
      .eq("platform", "android")
      .not("email", "is", null);
    if (usersErr) throw usersErr;

    return (androidUsers || []).filter((u) => !activeSet.has(u.id));
  }

  throw new Error(`Unknown target: ${target}`);
}

function dedupeByEmail(users) {
  const seen = new Set();
  const out = [];
  for (const u of users) {
    const key = (u.email || "").toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

// Enrich recipients with their last reference_results created_at (for inspection table).
// Best-effort: any failure leaves last_generation_at = null.
async function enrichWithLastGeneration(recipients) {
  if (!recipients || recipients.length === 0) return recipients;
  try {
    const ids = recipients.map((u) => u.id);
    const { data, error } = await db
      .from("reference_results")
      .select("user_id, created_at")
      .in("user_id", ids)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const lastByUser = new Map();
    for (const row of data || []) {
      if (!lastByUser.has(row.user_id)) {
        lastByUser.set(row.user_id, row.created_at);
      }
    }
    return recipients.map((u) => ({
      ...u,
      last_generation_at: lastByUser.get(u.id) || null,
    }));
  } catch (err) {
    console.warn("[bulk-email/recipients] enrich failed:", err?.message);
    return recipients.map((u) => ({ ...u, last_generation_at: null }));
  }
}

// Recipients list — full inspection table for any target.
// Hard cap 500 rows to keep payload sane.
router.post("/bulk-email/recipients", async (req, res) => {
  try {
    const { target, userId, email } = req.body || {};
    if (!ALLOWED_TARGETS.has(target)) {
      return res.status(400).json({ success: false, error: "invalid target" });
    }
    const all = dedupeByEmail(await resolveRecipients({ target, userId, email }));
    const CAP = 500;
    const truncated = all.length > CAP;
    const slice = truncated ? all.slice(0, CAP) : all;
    const enriched = await enrichWithLastGeneration(slice);
    return res.json({
      success: true,
      total: all.length,
      truncated,
      cap: CAP,
      recipients: enriched,
    });
  } catch (err) {
    console.error("[bulk-email/recipients]", err);
    return res.status(500).json({ success: false, error: err.message || "recipients failed" });
  }
});

// Preview — kaç user'a gönderilecek
router.post("/bulk-email/preview", async (req, res) => {
  try {
    const { target, userId, email } = req.body || {};
    if (!ALLOWED_TARGETS.has(target)) {
      return res.status(400).json({ success: false, error: "invalid target" });
    }
    const recipients = dedupeByEmail(await resolveRecipients({ target, userId, email }));
    return res.json({ success: true, count: recipients.length, sample: recipients.slice(0, 5).map((u) => u.email) });
  } catch (err) {
    console.error("[bulk-email/preview]", err);
    return res.status(500).json({ success: false, error: err.message || "preview failed" });
  }
});

// Send — gerçek gönderim, batch'leyerek
router.post("/bulk-email/send", async (req, res) => {
  try {
    const { target, userId, email, subject, html, previewText } = req.body || {};

    if (!ALLOWED_TARGETS.has(target)) {
      return res.status(400).json({ success: false, error: "invalid target" });
    }
    if (!subject || typeof subject !== "string" || subject.length === 0) {
      return res.status(400).json({ success: false, error: "subject required" });
    }
    if (!html || typeof html !== "string" || html.length === 0) {
      return res.status(400).json({ success: false, error: "html required" });
    }

    const recipients = dedupeByEmail(await resolveRecipients({ target, userId, email }));
    if (recipients.length === 0) {
      return res.status(404).json({ success: false, error: "no recipients matched" });
    }

    const wrappedHtml = getBulkMarketingEmailTemplate({ subject, bodyHtml: html, previewText });

    const batches = [];
    for (let i = 0; i < recipients.length; i += RESEND_BATCH_SIZE) {
      batches.push(recipients.slice(i, i + RESEND_BATCH_SIZE));
    }

    let sent = 0;
    let failed = 0;
    const errors = [];

    for (const batch of batches) {
      try {
        const payload = batch.map((u) => ({
          from: FROM_ADDRESS,
          to: u.email,
          subject,
          html: wrappedHtml,
        }));
        const result = await resend.batch.send(payload);
        // Resend batch returns { data: [...] } on success
        const succeeded = Array.isArray(result?.data?.data)
          ? result.data.data.length
          : Array.isArray(result?.data)
            ? result.data.length
            : batch.length;
        sent += succeeded;
        if (succeeded < batch.length) {
          failed += batch.length - succeeded;
        }
      } catch (batchErr) {
        console.error("[bulk-email/send] batch error:", batchErr?.message);
        failed += batch.length;
        errors.push(batchErr?.message || "batch failed");
      }
    }

    console.log(
      `[bulk-email] target=${target} total=${recipients.length} sent=${sent} failed=${failed} subject="${subject}"`
    );

    // Persist audit log (best-effort — never block the response)
    try {
      const firstRecipient = target === "user" ? recipients[0] : null;
      await db.from("bulk_email_log").insert({
        target,
        recipient_user_id: firstRecipient?.id || null,
        recipient_email: firstRecipient?.email || null,
        subject,
        preview_text: previewText || null,
        body_html: html,
        total_recipients: recipients.length,
        sent_count: sent,
        failed_count: failed,
        errors: errors.length > 0 ? errors : null,
        sent_by: req.adminUser?.email || "admin",
      });
    } catch (logErr) {
      console.warn("[bulk-email/send] log insert failed:", logErr?.message);
    }

    return res.json({
      success: true,
      target,
      total: recipients.length,
      sent,
      failed,
      errors: errors.slice(0, 5),
    });
  } catch (err) {
    console.error("[bulk-email/send]", err);
    return res.status(500).json({ success: false, error: err.message || "send failed" });
  }
});

// ============================================================================
// CUSTOM LIST EMAIL — Manual email list with per-language templates
// ----------------------------------------------------------------------------
// 1. /custom-list/lookup  : paste email list → server resolves preferred_language
// 2. /custom-list/send    : send mail to all using per-language templates
// 3. /custom-list/send-one: send mail to a single email with given language
// ============================================================================

function normalizeLang(raw) {
  if (!raw) return "en";
  const s = String(raw).toLowerCase().trim();
  if (!s) return "en";
  // pt-BR → pt, en-US → en, zh-Hans → zh, etc.
  return s.split(/[-_]/)[0];
}

function parseEmailList(raw) {
  if (!raw) return [];
  const parts = String(raw)
    .split(/[\s,;\n\r\t]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s && s.includes("@"));
  return Array.from(new Set(parts));
}

router.post("/bulk-email/custom-list/lookup", async (req, res) => {
  try {
    const emails = parseEmailList(req.body?.emails);
    if (emails.length === 0) {
      return res.status(400).json({ success: false, error: "no valid emails" });
    }

    const { data, error } = await db
      .from("users")
      .select("id, email, full_name, platform, preferred_language")
      .in("email", emails);
    if (error) throw error;

    const foundByEmail = new Map();
    for (const u of data || []) {
      const key = (u.email || "").toLowerCase();
      if (key) foundByEmail.set(key, u);
    }

    const found = [];
    const not_found = [];
    for (const e of emails) {
      const u = foundByEmail.get(e);
      if (u) {
        found.push({
          id: u.id,
          email: u.email,
          full_name: u.full_name || null,
          platform: u.platform || null,
          preferred_language: u.preferred_language || null,
          language: normalizeLang(u.preferred_language),
        });
      } else {
        not_found.push(e);
      }
    }

    // Enrich with last generation timestamp
    const enriched = await enrichWithLastGeneration(found);

    const by_language = {};
    for (const u of enriched) {
      by_language[u.language] = (by_language[u.language] || 0) + 1;
    }

    return res.json({
      success: true,
      total_input: emails.length,
      found_count: enriched.length,
      not_found_count: not_found.length,
      not_found,
      by_language,
      recipients: enriched,
    });
  } catch (err) {
    console.error("[bulk-email/custom-list/lookup]", err);
    return res.status(500).json({ success: false, error: err.message || "lookup failed" });
  }
});

// Bulk send to custom list using per-language templates.
// Body: { emails, templates: { [langKey]: { subject, html, previewText } }, defaultLanguage }
router.post("/bulk-email/custom-list/send", async (req, res) => {
  try {
    const emails = parseEmailList(req.body?.emails);
    const templates = req.body?.templates || {};
    const defaultLanguage = normalizeLang(req.body?.defaultLanguage || "en");

    if (emails.length === 0) {
      return res.status(400).json({ success: false, error: "no valid emails" });
    }
    if (!templates || Object.keys(templates).length === 0) {
      return res.status(400).json({ success: false, error: "templates required" });
    }

    const { data, error } = await db
      .from("users")
      .select("id, email, full_name, preferred_language")
      .in("email", emails);
    if (error) throw error;

    const userByEmail = new Map();
    for (const u of data || []) {
      const k = (u.email || "").toLowerCase();
      if (k) userByEmail.set(k, u);
    }

    // Group by resolved language
    const groups = {}; // { lang: [{email, ...}, ...] }
    const skipped = []; // emails with no matching template & no default
    for (const e of emails) {
      const u = userByEmail.get(e);
      const lang = u ? normalizeLang(u.preferred_language) : defaultLanguage;
      const chosen = templates[lang] ? lang : (templates[defaultLanguage] ? defaultLanguage : null);
      if (!chosen) {
        skipped.push(e);
        continue;
      }
      if (!groups[chosen]) groups[chosen] = [];
      groups[chosen].push({ email: e, user: u || null });
    }

    let totalSent = 0;
    let totalFailed = 0;
    const byLanguage = {};
    const errors = [];

    for (const [lang, list] of Object.entries(groups)) {
      const tpl = templates[lang];
      if (!tpl?.subject || !tpl?.html) {
        skipped.push(...list.map((x) => x.email));
        continue;
      }
      const wrappedHtml = getBulkMarketingEmailTemplate({
        subject: tpl.subject,
        bodyHtml: tpl.html,
        previewText: tpl.previewText,
      });
      const langSent = [];
      const langFailed = [];

      for (let i = 0; i < list.length; i += RESEND_BATCH_SIZE) {
        const batch = list.slice(i, i + RESEND_BATCH_SIZE);
        try {
          const payload = batch.map((x) => ({
            from: FROM_ADDRESS,
            to: x.email,
            subject: tpl.subject,
            html: wrappedHtml,
          }));
          await resend.batch.send(payload);
          langSent.push(...batch.map((x) => x.email));
        } catch (batchErr) {
          console.error(`[custom-list/send] batch error (${lang}):`, batchErr?.message);
          langFailed.push(...batch.map((x) => x.email));
          errors.push(`${lang}: ${batchErr?.message || "batch failed"}`);
        }
      }
      byLanguage[lang] = { sent: langSent.length, failed: langFailed.length };
      totalSent += langSent.length;
      totalFailed += langFailed.length;
    }

    // Audit
    try {
      await db.from("bulk_email_log").insert({
        target: "custom-list",
        recipient_user_id: null,
        recipient_email: null,
        subject: `[Multi-lang custom list] ${Object.keys(templates).join(", ")}`,
        preview_text: null,
        body_html: JSON.stringify(templates),
        total_recipients: emails.length,
        sent_count: totalSent,
        failed_count: totalFailed,
        errors: errors.length > 0 ? errors : null,
        sent_by: req.adminUser?.email || "admin",
      });
    } catch (logErr) {
      console.warn("[custom-list/send] log insert failed:", logErr?.message);
    }

    return res.json({
      success: true,
      total: emails.length,
      sent: totalSent,
      failed: totalFailed,
      skipped,
      by_language: byLanguage,
      errors: errors.slice(0, 10),
    });
  } catch (err) {
    console.error("[bulk-email/custom-list/send]", err);
    return res.status(500).json({ success: false, error: err.message || "send failed" });
  }
});

// Single send to one email with explicit language template.
// Body: { email, language, subject, html, previewText }
router.post("/bulk-email/custom-list/send-one", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const language = normalizeLang(req.body?.language || "en");
    const subject = req.body?.subject;
    const html = req.body?.html;
    const previewText = req.body?.previewText;

    if (!email || !email.includes("@")) {
      return res.status(400).json({ success: false, error: "valid email required" });
    }
    if (!subject || !html) {
      return res.status(400).json({ success: false, error: "subject and html required" });
    }

    const wrappedHtml = getBulkMarketingEmailTemplate({ subject, bodyHtml: html, previewText });
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: email,
      subject,
      html: wrappedHtml,
    });

    // Audit
    try {
      await db.from("bulk_email_log").insert({
        target: "custom-list",
        recipient_user_id: null,
        recipient_email: email,
        subject,
        preview_text: previewText || null,
        body_html: html,
        total_recipients: 1,
        sent_count: 1,
        failed_count: 0,
        errors: null,
        sent_by: req.adminUser?.email || "admin",
      });
    } catch (logErr) {
      console.warn("[custom-list/send-one] log insert failed:", logErr?.message);
    }

    return res.json({ success: true, email, language });
  } catch (err) {
    console.error("[bulk-email/custom-list/send-one]", err);
    return res.status(500).json({ success: false, error: err.message || "send failed" });
  }
});

// History — past sends, newest first
router.get("/bulk-email/history", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const { data, error, count } = await db
      .from("bulk_email_log")
      .select(
        "id, target, recipient_user_id, recipient_email, subject, preview_text, total_recipients, sent_count, failed_count, sent_by, sent_at",
        { count: "exact" }
      )
      .order("sent_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return res.json({
      success: true,
      total: count ?? 0,
      data: data || [],
    });
  } catch (err) {
    console.error("[bulk-email/history]", err);
    return res.status(500).json({ success: false, error: err.message || "history failed" });
  }
});

// History detail — single send including full body_html
router.get("/bulk-email/history/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await db
      .from("bulk_email_log")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    console.error("[bulk-email/history/:id]", err);
    return res.status(500).json({ success: false, error: err.message || "detail failed" });
  }
});

module.exports = router;
