const axios = require("axios");
const sharp = require("sharp");
const { v4: uuidv4 } = require("uuid");

// ─── GPT Image 2: aspect ratio sanitizer (3:1 limitini aşan input resimleri pad'ler) ───
// fal.ai 3:1'e çok yakın oranlarda bile (ör. 2.997) reddedebiliyor — trigger 2.9, hedef 2.5.
async function prepareKitInputImages(imageUrls, userId, supabase) {
    const TRIGGER_RATIO = 2.9;
    const TARGET_RATIO = 2.5;
    const processedUrls = [];

    for (const url of imageUrls || []) {
        if (!url || typeof url !== "string") {
            processedUrls.push(url);
            continue;
        }
        try {
            const response = await axios.get(url, {
                responseType: "arraybuffer",
                timeout: 20000,
            });
            const buf = Buffer.from(response.data);

            const meta = await sharp(buf).metadata();
            const W = meta.width || 0;
            const H = meta.height || 0;
            if (!W || !H) {
                processedUrls.push(url);
                continue;
            }

            const ratio = W >= H ? W / H : H / W;
            if (ratio <= TRIGGER_RATIO) {
                processedUrls.push(url);
                continue;
            }

            console.log(`📐 [KIT_GPT_ASPECT] ${W}x${H} (ratio ${ratio.toFixed(3)}:1) > ${TRIGGER_RATIO}:1, padding uygulanıyor (hedef ${TARGET_RATIO}:1)...`);

            let padTop = 0, padBottom = 0, padLeft = 0, padRight = 0;
            let newW = W, newH = H;
            if (W > H) {
                newH = Math.ceil(W / TARGET_RATIO);
                const totalPadV = newH - H;
                padTop = Math.floor(totalPadV / 2);
                padBottom = totalPadV - padTop;
            } else {
                newW = Math.ceil(H / TARGET_RATIO);
                const totalPadH = newW - W;
                padLeft = Math.floor(totalPadH / 2);
                padRight = totalPadH - padLeft;
            }

            const padded = await sharp(buf)
                .extend({
                    top: padTop,
                    bottom: padBottom,
                    left: padLeft,
                    right: padRight,
                    background: { r: 255, g: 255, b: 255 },
                })
                .jpeg({ quality: 90 })
                .toBuffer();

            const timestamp = Date.now();
            const randomId = uuidv4().substring(0, 8);
            const fileName = `temp_${timestamp}_kit_gpt2_pad_${userId || "anonymous"}_${randomId}.jpg`;

            const { error: upErr } = await supabase.storage
                .from("reference")
                .upload(fileName, padded, { contentType: "image/jpeg" });

            if (upErr) {
                console.warn(`❌ [KIT_GPT_ASPECT] Supabase upload failed:`, upErr.message);
                processedUrls.push(url);
                continue;
            }

            const { data: urlData } = supabase.storage.from("reference").getPublicUrl(fileName);
            console.log(`✅ [KIT_GPT_ASPECT] Padded: ${newW}x${newH}, URL: ${urlData.publicUrl}`);
            processedUrls.push(urlData.publicUrl);
        } catch (err) {
            console.warn(`⚠️ [KIT_GPT_ASPECT] Preprocess error:`, err.message);
            processedUrls.push(url);
        }
    }

    return processedUrls;
}

module.exports = { prepareKitInputImages };
