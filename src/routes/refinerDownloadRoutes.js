const express = require("express");
const router = express.Router();
const axios = require("axios");
const sharp = require("sharp");
const { createCanvas, loadImage } = require("canvas");
const { v4: uuidv4 } = require("uuid");
const { supabase } = require("../supabaseClient");

const FAL_ENDPOINT = "https://fal.run/pixelcut/background-removal";

// Test endpoint
router.get("/test", (req, res) => {
    console.log("✅ [REFINER-DL] Test endpoint hit!");
    res.json({ success: true, message: "Refiner download route is working!" });
});

router.post("/download", async (req, res) => {
    const { imageUrl, format, pngType, colorSpace, userId } = req.body;

    console.log("📥 [REFINER-DL] Request received:", { imageUrl, format, pngType, colorSpace });

    if (!imageUrl) {
        return res.status(400).json({ success: false, message: "Image URL is required" });
    }

    try {
        let finalBuffer;
        let contentType;
        let fileExtension;

        // 1. URL'den resmi indir
        console.log("⬇️ [REFINER-DL] Downloading original image...");
        const imageResponse = await axios.get(imageUrl, { responseType: "arraybuffer" });
        let imageBuffer = Buffer.from(imageResponse.data);

        // 2. Format işlemlemesi
        if (format === "png") {
            // PNG Type kontrolü: transparent ise arkaplan sil, rgba ise sadece format dönüştür
            if (pngType === "transparent") {
                // Transparent: Arkaplanı kaldır (fal.ai pixelcut kullanarak)
                console.log("🖼️ [REFINER-DL] Format is PNG (Transparent) - Removing background via fal.ai pixelcut...");

                try {
                    const falResponse = await axios.post(
                        FAL_ENDPOINT,
                        { image_url: imageUrl },
                        {
                            headers: {
                                Authorization: `Key ${process.env.FAL_API_KEY}`,
                                "Content-Type": "application/json",
                            },
                            timeout: 180000,
                        }
                    );

                    // fal.ai çıktısını parse et
                    const output = falResponse.data;
                    let resultImageUrl = null;
                    if (output.image && output.image.url) {
                        resultImageUrl = output.image.url;
                    } else if (output.images && Array.isArray(output.images) && output.images.length > 0) {
                        resultImageUrl = output.images[0].url;
                    } else {
                        resultImageUrl = output.url || null;
                    }

                    if (!resultImageUrl) {
                        throw new Error("fal.ai response did not contain a valid image URL");
                    }

                    console.log("✅ [REFINER-DL] Background removed. Downloading result:", resultImageUrl);
                    const bgRemovedResponse = await axios.get(resultImageUrl, { responseType: "arraybuffer", timeout: 30000 });
                    imageBuffer = Buffer.from(bgRemovedResponse.data);

                    // Sharp ile transparent pixelleri trim et (spacing kaldır)
                    console.log("✂️ [REFINER-DL] Trimming transparent pixels...");
                    const trimmedBuffer = await sharp(imageBuffer)
                        .trim()
                        .png()
                        .toBuffer();

                    // Supabase'e yükle
                    console.log("📤 [REFINER-DL] Uploading to Supabase transparent-products bucket...");
                    const safeUserId = userId || "anonymous";
                    const filename = `${safeUserId}/${Date.now()}_${uuidv4()}.png`;

                    const { error: uploadError } = await supabase.storage
                        .from("transparent-products")
                        .upload(filename, trimmedBuffer, {
                            contentType: "image/png",
                            cacheControl: "3600"
                        });

                    if (uploadError) {
                        throw new Error(`Supabase upload failed: ${uploadError.message}`);
                    }

                    const { data: publicUrlData } = supabase.storage
                        .from("transparent-products")
                        .getPublicUrl(filename);

                    console.log("✅ [REFINER-DL] PNG uploaded. URL:", publicUrlData.publicUrl);

                    return res.json({
                        success: true,
                        type: "png",
                        imageUrl: publicUrlData.publicUrl
                    });

                } catch (bgError) {
                    console.error("❌ [REFINER-DL] Background removal failed:", bgError);
                    return res.status(500).json({ success: false, message: bgError.message });
                }
            } else {
                // RGBA: Sadece PNG formatına dönüştür, arkaplan silme
                console.log("🖼️ [REFINER-DL] Format is PNG (RGBA) - Converting to PNG without background removal...");

                try {
                    const pngBuffer = await sharp(imageBuffer)
                        .png()
                        .toBuffer();

                    console.log(`📤 [REFINER-DL] Sending PNG response (${pngBuffer.length} bytes)...`);

                    res.set("Content-Type", "image/png");
                    res.set("Content-Disposition", `attachment; filename="image.png"`);
                    return res.send(pngBuffer);

                } catch (pngError) {
                    console.error("❌ [REFINER-DL] PNG conversion failed:", pngError);
                    return res.status(500).json({ success: false, message: pngError.message });
                }
            }
        } else if (format === "pdf") {
            // PDF seçili ise
            console.log("📄 [REFINER-DL] Format is PDF - Generating PDF...");

            // Get dimensions
            const metadata = await sharp(imageBuffer).metadata();
            const width = metadata.width;
            const height = metadata.height;

            // Create PDF canvas
            const canvas = createCanvas(width, height, "pdf");
            const ctx = canvas.getContext("2d");

            // Load image into canvas
            const img = await loadImage(imageBuffer);
            ctx.drawImage(img, 0, 0, width, height);

            const pdfBuffer = canvas.toBuffer("application/pdf");

            // PDF için Supabase'e yükle ve link döndür
            console.log("📤 [REFINER-DL] Uploading PDF to Supabase...");
            const safeUserId = userId || "anonymous";
            const filename = `${safeUserId}/${Date.now()}_${uuidv4()}.pdf`;

            const { error: uploadError } = await supabase.storage
                .from("refiner-pdf")
                .upload(filename, pdfBuffer, {
                    contentType: "application/pdf",
                    cacheControl: "3600"
                });

            if (uploadError) {
                throw new Error(`Supabase upload failed: ${uploadError.message}`);
            }

            const { data: publicUrlData } = supabase.storage
                .from("refiner-pdf")
                .getPublicUrl(filename);

            console.log("✅ [REFINER-DL] PDF uploaded. URL:", publicUrlData.publicUrl);

            return res.json({
                success: true,
                type: "pdf",
                pdfUrl: publicUrlData.publicUrl
            });

        } else {
            // Default: JPG
            console.log("📸 [REFINER-DL] Format is JPG");
            finalBuffer = await sharp(imageBuffer).jpeg({ quality: 95 }).toBuffer();
            contentType = "image/jpeg";
            fileExtension = "jpg";
        }

        // 3. Renk Uzayı İşlemesi (CMYK conversion - Only for image formats, PDF handles it internally or handled before)
        // Not: PDF color space conversion in canvas is complex, we skip for PDF for now or assume input was converted?
        // Actually, if format is PDF, we put the image AS IS or as RGB.
        // If format is standard image (jpg/png) AND colorSpace is CMYK:
        if (colorSpace === "cmyk" && format !== "pdf") {
            console.log("🎨 [REFINER-DL] Converting to CMYK...");
            try {
                // Sharp ile CMYK dönüşümü (basit dönüşüm)
                finalBuffer = await sharp(finalBuffer)
                    .toColourspace("cmyk")
                    .toBuffer();
            } catch (cmykError) {
                console.warn("⚠️ [REFINER-DL] CMYK conversion failed, keeping original:", cmykError.message);
            }
        }

        // 4. Response gönder
        console.log(`📤 [REFINER-DL] Sending response (${finalBuffer.length} bytes)...`);

        res.set("Content-Type", contentType);
        res.set("Content-Disposition", `attachment; filename="image.${fileExtension}"`);
        res.send(finalBuffer);

    } catch (error) {
        console.error("❌ [REFINER-DL] Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
