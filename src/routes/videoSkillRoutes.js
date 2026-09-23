// 🎬 Video stüdyosu — Video Remix referans videosu yükleme (23 Eyl 2026).
// POST /api/video-skills/upload-reference { base64Video | videoUrl, userId } → { success, url, duration }
// videoUrl: doğrudan video dosyası linki (mp4/mov/webm). TikTok/Instagram gibi SAYFA linkleri
// HTML döner → UNSUPPORTED_URL (bu sunucuda yt-dlp yok). SSRF: yalnız http(s) + herkese açık IP.
// Seedance reference-to-video şartları: 2–15 sn, ~480p–720p (0.41–0.93 MP), <50 MB.
// Gelen video ffmpeg ile bu aralığa getirilir (ilk 15 sn, ~0.9 MP, H.264, ses korunur)
// ve Supabase `user_videos/skill-refs/` altına yüklenir.
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const ffmpeg = require("ffmpeg-static");
const dns = require("dns").promises;
const net = require("net");
const { supabase } = require("../supabaseClient");

const router = express.Router();
const MAX_INPUT_BYTES = 45 * 1024 * 1024;

const run = (args) => new Promise((resolve, reject) => {
  execFile(ffmpeg, args, { maxBuffer: 8 * 1024 * 1024, timeout: 120000 }, (err, stdout, stderr) => {
    if (err) { err.stderr = String(stderr || ""); reject(err); } else resolve(String(stderr || ""));
  });
});

async function probeDuration(file) {
  try { await run(["-i", file]); } catch (err) {
    const m = String(err.stderr || "").match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  return null;
}

const isPrivateIp = (ip) => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
};

/** Linkteki videoyu indir (≤45 MB, yalnız video/* içerik). Hata → err.code */
async function downloadVideoUrl(rawUrl) {
  const fail = (code) => Object.assign(new Error(code), { code });
  let u;
  try { u = new URL(String(rawUrl).trim()); } catch { throw fail("INVALID_URL"); }
  if (!/^https?:$/.test(u.protocol)) throw fail("INVALID_URL");
  const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw fail("INVALID_URL");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const resp = await fetch(u.toString(), { redirect: "follow", signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 DiressBot" } });
    if (!resp.ok) throw fail("URL_FETCH_FAILED");
    const type = String(resp.headers.get("content-type") || "").toLowerCase();
    if (!type.startsWith("video/") && !type.includes("octet-stream")) throw fail("UNSUPPORTED_URL");
    if (Number(resp.headers.get("content-length") || 0) > MAX_INPUT_BYTES) throw fail("VIDEO_TOO_LARGE");
    const chunks = [];
    let size = 0;
    for await (const chunk of resp.body) {
      size += chunk.length;
      if (size > MAX_INPUT_BYTES) { ctrl.abort(); throw fail("VIDEO_TOO_LARGE"); }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (err) {
    if (err.code) throw err;
    throw fail("URL_FETCH_FAILED");
  } finally { clearTimeout(timer); }
}

router.post("/video-skills/upload-reference", async (req, res) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skillref-"));
  try {
    const { base64Video, videoUrl, userId } = req.body || {};
    const hasB64 = typeof base64Video === "string" && base64Video.length > 0;
    const hasUrl = typeof videoUrl === "string" && videoUrl.trim().length > 0;
    if (!userId || (!hasB64 && !hasUrl)) {
      return res.status(400).json({ success: false, message: "userId and base64Video or videoUrl are required" });
    }
    let raw;
    if (hasB64) {
      raw = Buffer.from(base64Video.includes(",") ? base64Video.split(",")[1] : base64Video, "base64");
    } else {
      try { raw = await downloadVideoUrl(videoUrl); } catch (err) {
        const code = err.code || "URL_FETCH_FAILED";
        return res.status(code === "VIDEO_TOO_LARGE" ? 413 : 400).json({ success: false, code, message: "Video link could not be used" });
      }
    }
    if (!raw.length || raw.length > MAX_INPUT_BYTES) {
      return res.status(413).json({ success: false, code: "VIDEO_TOO_LARGE", message: "Video must be under 45 MB" });
    }
    const input = path.join(tmp, "in");
    const output = path.join(tmp, "out.mp4");
    fs.writeFileSync(input, raw);
    const duration = await probeDuration(input);
    if (!duration || duration < 2) {
      return res.status(400).json({ success: false, code: "VIDEO_TOO_SHORT", message: "Reference video must be at least 2 seconds" });
    }
    // ~0.9 MP'ye ölçekle (9:16 → 720×1280, 1:1 → ~948×948 değil: çift sayıya yuvarlanır), ilk 15 sn
    await run([
      "-y", "-i", input, "-t", "15",
      "-vf", "scale='trunc(sqrt(900000*iw/ih)/2)*2':-2,fps=30",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", output,
    ]);
    const key = `skill-refs/${String(userId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64)}/${uuidv4()}.mp4`;
    const { error } = await supabase.storage.from("user_videos").upload(key, fs.readFileSync(output), { contentType: "video/mp4", upsert: false });
    if (error) throw error;
    const url = supabase.storage.from("user_videos").getPublicUrl(key).data.publicUrl;
    console.log(`🎬 [VIDEO-SKILL] referans video yüklendi (${duration.toFixed(1)} sn → ${Math.min(15, duration).toFixed(1)} sn): ${key}`);
    return res.json({ success: true, url, duration: Math.min(15, duration) });
  } catch (err) {
    console.error("❌ [VIDEO-SKILL] referans video yüklenemedi:", err?.message, String(err?.stderr || "").slice(-300));
    return res.status(500).json({ success: false, message: "Reference video could not be processed" });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

module.exports = router;
