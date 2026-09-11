// Ortak kit görsel üretim yolu (SimpleImageModal kitleri: e-ticaret V2, fashion, product V1, street icon).
//
// Varsayılan: GPT Image 2.5 (fal; kalite app_config.gpt25_quality, boyut gpt25Edit ~4 MP tablosu). Hata olursa Nano Banana 2 (→ nano-banana-pro).
// app_config.kit_route ("gpt" | "nb2", varsayılan "gpt") hangi sağlayıcının ÖNCE deneneceğini seçer;
// diğeri her zaman yedek olarak kalır. 60 sn önbellek — tablo değişince yeniden deploy gerekmez
// (gpt25_quality ile aynı desen).
const axios = require("axios");
const { fal } = require("@fal-ai/client");
const { createClient } = require("@supabase/supabase-js");
const { GPT25_EDIT_MODEL, gpt25ImageSize } = require("./gpt25Edit");
// Kitler GPT Image 2.5 Sunburst ile üretilir (araçlarla aynı model).
const KIT_GPT25_MODEL = GPT25_EDIT_MODEL;
const KIT_GPT25_QUALITY = "medium";

if (process.env.FAL_API_KEY) fal.config({ credentials: process.env.FAL_API_KEY });

const KIT_ROUTES = ["gpt", "nb2"];
const KIT_DEFAULT_ROUTE = "gpt";
const ROUTE_TTL_MS = 60 * 1000;

let cachedRoute = KIT_DEFAULT_ROUTE;
let cachedAt = 0;
let inflight = null;
let supabase = null;

function db() {
    if (supabase) return supabase;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    return supabase;
}

function normalizeRoute(v) {
    const s = String(v || "").trim().toLowerCase();
    return KIT_ROUTES.includes(s) ? s : null;
}

/** app_config.kit_route → önbellekli; hata/kolon yoksa son bilinen değer. */
async function refreshKitRoute() {
    const client = db();
    if (!client) return cachedRoute;
    if (inflight) return inflight;
    inflight = (async () => {
        try {
            const { data } = await client.from("app_config").select("kit_route").limit(1).maybeSingle();
            const v = normalizeRoute(data && data.kit_route);
            if (v) cachedRoute = v;
        } catch (e) {
            // kolon yoksa / ağ hatası → varsayılan kalır
        } finally {
            cachedAt = Date.now();
            inflight = null;
        }
        return cachedRoute;
    })();
    return inflight;
}

/** Senkron okuma: süresi dolduysa arka planda tazeler, eldeki değeri döner. */
function getKitRoute() {
    if (Date.now() - cachedAt > ROUTE_TTL_MS) refreshKitRoute().catch(() => {});
    return cachedRoute;
}
refreshKitRoute().catch(() => {});

// ─── Aspect ratio eşlemeleri ───
const LEGACY_SIZE_TO_RATIO = { "1024x1024": "1:1", "1536x1024": "3:2", "1024x1536": "2:3" };
const GPT_SIZE_ENUMS = new Set([
    "auto", "square", "square_hd", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9",
]);

/** "1024x1536" | "9:16" | "portrait_16_9" → NB aspect_ratio ("W:H"). */
function toAspectRatio(value, fallback = "9:16") {
    if (!value) return fallback;
    if (LEGACY_SIZE_TO_RATIO[value]) return LEGACY_SIZE_TO_RATIO[value];
    const enumToRatio = {
        square: "1:1", square_hd: "1:1", portrait_4_3: "3:4", portrait_16_9: "9:16",
        landscape_4_3: "4:3", landscape_16_9: "16:9",
    };
    if (enumToRatio[value]) return enumToRatio[value];
    return /^\d+:\d+$/.test(String(value)) ? String(value) : fallback;
}

/** "9:16" | "1024x1536" | enum → GPT Image image_size enum. */
function toGptImageSize(value, fallback = "portrait_16_9") {
    if (!value) return fallback;
    if (GPT_SIZE_ENUMS.has(value)) return value;
    const ratio = toAspectRatio(value, null);
    const mapping = {
        "21:9": "landscape_16_9", "16:9": "landscape_16_9", "3:2": "landscape_4_3", "4:3": "landscape_4_3",
        "5:4": "landscape_4_3", "1:1": "square_hd", "4:5": "portrait_4_3", "3:4": "portrait_4_3",
        "2:3": "portrait_4_3", "9:16": "portrait_16_9",
    };
    return mapping[ratio] || fallback;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── GPT Image 2.5 (fal queue) ───
async function callGpt25KitEdit({ prompt, imageUrls, imageSize, maxRetries = 2, tag = "KIT" }) {
    const urls = (imageUrls || []).filter(Boolean);
    if (!urls.length) throw new Error("No input images for GPT Image 2.5 kit edit");

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🎨 [${tag}_GPT25] attempt ${attempt}/${maxRetries}, image_size: ${typeof imageSize === "string" ? imageSize : `${imageSize.width}x${imageSize.height}`}, quality: ${KIT_GPT25_QUALITY}, images: ${urls.length}`);
            const { request_id } = await fal.queue.submit(KIT_GPT25_MODEL, {
                input: {
                    prompt,
                    image_urls: urls,
                    image_size: imageSize,
                    quality: KIT_GPT25_QUALITY, // kitler sabit medium (app_config.gpt25_quality yalnız araçları etkiler)
                    num_images: 1,
                    output_format: "jpeg",
                },
            });
            if (!request_id) throw new Error("Fal.ai did not return a request_id");

            const maxPolls = 90;
            for (let poll = 0; poll < maxPolls; poll++) {
                const status = await fal.queue.status(KIT_GPT25_MODEL, { requestId: request_id, logs: false });
                if (status.status === "COMPLETED") {
                    const final = await fal.queue.result(KIT_GPT25_MODEL, { requestId: request_id });
                    const url = final.data?.images?.[0]?.url;
                    if (url) {
                        console.log(`✅ [${tag}_GPT25] Image generated`);
                        return url;
                    }
                    throw new Error("No images in completed GPT Image 2.5 result");
                }
                if (status.status === "FAILED") throw new Error("Fal.ai GPT Image 2.5 generation failed");
                await sleep(2000);
            }
            throw new Error("Fal.ai GPT Image 2.5 polling timeout");
        } catch (error) {
            console.error(`❌ [${tag}_GPT25] attempt ${attempt} failed:`, error.message);
            if (attempt === maxRetries) throw error;
            await sleep(Math.min(2000 * Math.pow(2, attempt - 1), 10000));
        }
    }
}

// ─── Nano Banana 2 (fal.run, senkron) → nano-banana-pro yedeği ───
async function callNanoBananaKitEdit({ prompt, imageUrls, aspectRatio, maxRetries = 2, tag = "KIT" }) {
    const FAL_API_KEY = process.env.FAL_API_KEY;
    if (!FAL_API_KEY) throw new Error("FAL_API_KEY environment variable is not set");
    const urls = (imageUrls || []).filter(Boolean);
    if (!urls.length) throw new Error("No input images for Nano Banana kit edit");

    const models = [
        { name: "nano-banana-2", url: "https://fal.run/fal-ai/nano-banana-2/edit" },
        { name: "nano-banana-pro", url: "https://fal.run/fal-ai/nano-banana-pro/edit" },
    ];

    for (const model of models) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`🍌 [${tag}_NB] ${model.name} attempt ${attempt}/${maxRetries}, aspect: ${aspectRatio}`);
                const response = await axios.post(
                    model.url,
                    {
                        prompt,
                        image_urls: urls,
                        aspect_ratio: aspectRatio,
                        resolution: "1K",
                        output_format: "jpeg",
                        safety_tolerance: "6",
                        num_images: 1,
                    },
                    {
                        headers: { Authorization: `Key ${FAL_API_KEY}`, "Content-Type": "application/json" },
                        timeout: 300000,
                    }
                );
                const url = response.data?.images?.[0]?.url;
                if (url) {
                    console.log(`✅ [${tag}_NB] ${model.name} image generated`);
                    return url;
                }
                throw new Error("No image URL in Fal.ai response");
            } catch (error) {
                const errMsg = error.response?.data?.detail || error.message || "unknown error";
                console.error(`❌ [${tag}_NB] ${model.name} attempt ${attempt} failed:`, errMsg);
                const isCapacityError = typeof errMsg === "string" &&
                    (errMsg.includes("E003") || errMsg.includes("unavailable") || errMsg.includes("capacity") || errMsg.includes("overloaded"));
                if (isCapacityError || attempt === maxRetries) break;
                await sleep(Math.min(2000 * Math.pow(2, attempt - 1), 10000));
            }
        }
        console.log(`⚠️ [${tag}_NB] ${model.name} failed, trying next model...`);
    }
    throw new Error("All Nano Banana models failed on Fal.ai (nano-banana-2 and nano-banana-pro)");
}

/**
 * Tek kit sahnesi üret.
 * @param {object} p
 * @param {string} p.prompt
 * @param {string[]} p.imageUrls  — [sonuç görseli, referans/ürün görseli]; GPT için ≤3:1 olacak şekilde önceden pad'lenmiş olmalı
 * @param {string} [p.aspectRatio] — "9:16" | "2:3" | "1024x1536" | GPT enum; varsayılan 9:16
 * @param {string} [p.tag] — log etiketi
 * @param {string} [p.route] — test/override; yoksa app_config.kit_route
 */
async function generateKitImage({ prompt, imageUrls, aspectRatio, tag = "KIT", route } = {}) {
    const primary = normalizeRoute(route) || getKitRoute();
    /* GPT 2.5: fal preset adı yerine orana göre ~4 MP sabit boyut (utils/gpt25Edit GPT25_IMAGE_SIZES); bilinmeyen oran → preset */
    const ratioKey = toAspectRatio(aspectRatio, null);
    const fixed = ratioKey ? gpt25ImageSize(ratioKey) : "auto";
    const gptSize = fixed && fixed !== "auto" ? fixed : toGptImageSize(aspectRatio);
    const nbRatio = toAspectRatio(aspectRatio);

    const viaGpt = () => callGpt25KitEdit({ prompt, imageUrls, imageSize: gptSize, tag });
    const viaNb = () => callNanoBananaKitEdit({ prompt, imageUrls, aspectRatio: nbRatio, tag });
    const [first, second, firstName, secondName] = primary === "nb2"
        ? [viaNb, viaGpt, "Nano Banana 2", "GPT Image 2.5"]
        : [viaGpt, viaNb, "GPT Image 2.5", "Nano Banana 2"];

    try {
        return await first();
    } catch (err) {
        console.warn(`⚠️ [${tag}_ROUTE] ${firstName} failed — falling back to ${secondName}: ${err.message}`);
        return await second();
    }
}

module.exports = {
    KIT_ROUTES,
    KIT_DEFAULT_ROUTE,
    getKitRoute,
    refreshKitRoute,
    toAspectRatio,
    toGptImageSize,
    callGpt25KitEdit,
    callNanoBananaKitEdit,
    generateKitImage,
};
