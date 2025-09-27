const fs = require("fs");
const path = require("path");
const axios = require("axios");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

// Supabase client
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

// JSON dosyalarının yolları
const WOMAN_HAIR_STYLES_FILE = path.join(
  __dirname,
  "../lib/woman_hair_style_new.json"
);
const MAN_HAIR_STYLES_FILE = path.join(
  __dirname,
  "../lib/man_hair_style_new.json"
);
const EXAMPLE_IMAGE_PATH = path.join(__dirname, "../lib/example_hair.jpg");

// Dosya varlığını kontrol et
if (!fs.existsSync(EXAMPLE_IMAGE_PATH)) {
  console.error(`❌ Example image bulunamadı: ${EXAMPLE_IMAGE_PATH}`);
  process.exit(1);
}

// Delay fonksiyonu
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Prediction durumunu kontrol et (referenceBrowserRoutesV2.js'den alındı)
async function pollReplicateResult(predictionId, maxAttempts = 60) {
  console.log(`Replicate prediction polling başlatılıyor: ${predictionId}`);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await axios.get(
        `https://api.replicate.com/v1/predictions/${predictionId}`,
        {
          headers: {
            Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          responseType: "json",
          timeout: 15000,
        }
      );

      const result = response.data;
      console.log(`Polling attempt ${attempt + 1}: status = ${result.status}`);

      if (result.status === "succeeded") {
        console.log("Replicate işlemi başarıyla tamamlandı");
        return result;
      } else if (result.status === "failed") {
        console.error("Replicate işlemi başarısız:", result.error);

        // E005 (sensitive content) ve diğer kalıcı hatalar için sonraki pose'a geç
        if (
          result.error &&
          typeof result.error === "string" &&
          (result.error.includes("E005") ||
            result.error.includes("flagged as sensitive") ||
            result.error.includes("sensitive content") ||
            result.error.includes("Content moderated"))
        ) {
          console.log(
            "⚠️ Sensitive content hatası, sonraki pose'a geçiliyor:",
            result.error
          );
          throw new Error(`SKIP_POSE: ${result.error}`);
        }

        // E004 ve benzeri geçici hatalar için retry'a uygun hata fırlat
        if (
          result.error &&
          typeof result.error === "string" &&
          (result.error.includes("E004") ||
            result.error.includes("Service is temporarily unavailable") ||
            result.error.includes("Please try again later"))
        ) {
          console.log(
            "🔄 Geçici nano-banana hatası tespit edildi, retry'a uygun:",
            result.error
          );
          throw new Error(`RETRYABLE_ERROR: ${result.error}`);
        }

        throw new Error(result.error || "Replicate processing failed");
      } else if (result.status === "canceled") {
        console.error("Replicate işlemi iptal edildi");
        throw new Error("Replicate processing was canceled");
      }

      // Processing veya starting durumundaysa bekle
      if (result.status === "processing" || result.status === "starting") {
        await new Promise((resolve) => setTimeout(resolve, 2000)); // 2 saniye bekle
        continue;
      }
    } catch (error) {
      console.error(`Polling attempt ${attempt + 1} hatası:`, error.message);

      // SKIP_POSE hatası ise hemen fırlat
      if (error.message.includes("SKIP_POSE")) {
        throw error;
      }

      // "No image content found" hatası ise sonraki poza geç
      if (error.message.includes("No image content found in response")) {
        console.log(
          "⚠️ No image content hatası, sonraki pose'a geçiliyor:",
          error.message
        );
        throw new Error(`SKIP_POSE: ${error.message}`);
      }

      // Son deneme değilse devam et
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }

      throw error;
    }
  }

  console.log("⚠️ Polling timeout, sonraki pose'a geçiliyor");
  throw new Error(
    "SKIP_POSE: Polling timeout - maksimum deneme sayısına ulaşıldı"
  );
}

// Nano Banana API'ye istek gönder (retry ile)
async function callNanoBanana(prompt, imagePath, gender) {
  const maxRetries = 3;
  let lastError = null;

  for (let retry = 1; retry <= maxRetries; retry++) {
    try {
      console.log(
        `🎨 ${gender} hair style için Nano Banana'ya istek gönderiliyor... (Deneme ${retry}/${maxRetries})`
      );
      console.log(`📝 Prompt: ${prompt.substring(0, 100)}...`);

      // Resmi base64'e çevir
      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString("base64");
      const dataUrl = `data:image/jpeg;base64,${base64Image}`;

      const requestBody = {
        input: {
          prompt: prompt,
          image_input: [dataUrl],
          output_format: "png",
        },
      };

      console.log("📡 API isteği gönderiliyor...");

      const response = await fetch(
        "https://api.replicate.com/v1/models/google/nano-banana/predictions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(
          `API hatası: ${response.status} - ${errorText}`
        );

        // Service unavailable hatası ise retry yap
        if (
          errorText.includes("Service is temporarily unavailable") ||
          errorText.includes("E004")
        ) {
          console.log(
            `⚠️ Service unavailable hatası, ${
              retry < maxRetries ? "retry yapılıyor..." : "son deneme başarısız"
            }`
          );
          lastError = error;
          if (retry < maxRetries) {
            await delay(5000 * retry); // Exponential backoff
            continue;
          }
        }
        throw error;
      }

      const result = await response.json();
      console.log("📄 İlk yanıt alındı, prediction ID:", result.id);
      console.log("⏳ Durum:", result.status);

      // Polling ile sonucu bekle
      const prediction = await pollReplicateResult(result.id);

      if (prediction.status === "succeeded" && prediction.output) {
        console.log("✅ Resim başarıyla oluşturuldu!");

        // Output'u kontrol et - string veya array olabilir
        let imageUrl;
        if (typeof prediction.output === "string") {
          imageUrl = prediction.output;
        } else if (
          Array.isArray(prediction.output) &&
          prediction.output.length > 0
        ) {
          imageUrl = prediction.output[0];
        } else {
          throw new Error(
            `Geçersiz output formatı: ${JSON.stringify(prediction.output)}`
          );
        }

        console.log("🔗 Generated URL:", imageUrl);

        // URL kontrolü
        if (!imageUrl || typeof imageUrl !== "string" || imageUrl.length < 10) {
          throw new Error(`Geçersiz URL alındı: ${imageUrl}`);
        }

        return imageUrl;
      } else {
        throw new Error(`Beklenmeyen durum: ${prediction.status}`);
      }
    } catch (error) {
      console.error(
        `❌ Nano Banana API hatası (Deneme ${retry}/${maxRetries}):`,
        error.message
      );
      lastError = error;

      // RETRYABLE_ERROR hatası ise retry yap
      if (error.message.includes("RETRYABLE_ERROR")) {
        if (retry < maxRetries) {
          console.log(
            `🔄 Retryable hata, retry yapılıyor... (${retry}/${maxRetries})`
          );
          await delay(5000 * retry); // Exponential backoff
          continue;
        }
      }

      // Diğer hatalar için retry yapma
      if (retry < maxRetries) {
        console.log(
          `🔄 Diğer hata, retry yapılıyor... (${retry}/${maxRetries})`
        );
        await delay(3000 * retry);
        continue;
      }
    }
  }

  // Tüm retry'lar başarısız
  throw lastError || new Error("Tüm retry denemeleri başarısız oldu");
}

// Resmi Supabase'e yükle
async function uploadToSupabase(imageUrl, fileName, gender) {
  try {
    console.log(`📤 ${fileName} Supabase'e yükleniyor...`);
    console.log(`🔗 Image URL: ${imageUrl}`);

    // URL kontrolü
    if (!imageUrl || typeof imageUrl !== "string") {
      throw new Error(`Geçersiz URL: ${imageUrl}`);
    }

    // Resmi indir
    console.log("📥 Resim indiriliyor...");
    const imageResponse = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
    });

    console.log(`📦 Resim boyutu: ${imageResponse.data.length} bytes`);
    const imageBuffer = Buffer.from(imageResponse.data);

    // Supabase'e yükle
    const { data, error } = await supabase.storage
      .from("hair_styles")
      .upload(`${gender}/${fileName}.png`, imageBuffer, {
        contentType: "image/png",
        cacheControl: "3600",
        upsert: true,
      });

    if (error) {
      console.error("❌ Supabase yükleme hatası:", error);

      // RLS hatası ise detaylı bilgi ver
      if (
        error.message &&
        error.message.includes("row-level security policy")
      ) {
        console.error(`
🔧 RLS HATASI ÇÖZÜMÜ:
Supabase'de 'hair_styles' bucket için Row Level Security (RLS) politikası eksik.

Çözüm:
1. Supabase Dashboard'a git
2. Storage -> hair_styles bucket -> Policies
3. Aşağıdaki INSERT politikasını ekle:

Name: Allow file uploads
Definition: true
Operation: INSERT

Veya SQL ile:
CREATE POLICY "Allow file uploads" ON storage.objects
FOR INSERT WITH CHECK (bucket_id = 'hair_styles');
        `);
      }

      throw error;
    }

    console.log(`✅ ${fileName} Supabase'e yüklendi`);

    // Public URL al
    const { data: urlData } = supabase.storage
      .from("hair_styles")
      .getPublicUrl(`${gender}/${fileName}.png`);

    return urlData.publicUrl;
  } catch (error) {
    console.error("❌ Supabase yükleme hatası:", error.message);
    throw error;
  }
}

// Prompt oluştur (hair style için)
function createPrompt(hairStylePrompt, gender) {
  const genderText = gender === "woman" ? "female" : "male";

  return `CHANGE HAIR STYLE: ${hairStylePrompt}. Keep the mannequin head exactly the same - white featureless head on white background. Only change the hair style, do not make it a real person.`;
}

// JSON dosyasını güncelle (hair style için)
function updateJsonFile(filePath, styleData) {
  try {
    const jsonData = JSON.parse(fs.readFileSync(filePath, "utf8"));

    // Category ve style'ı bul ve image_url ekle
    for (const category of jsonData.categories) {
      const style = category.styles.find((s) => s.key === styleData.key);
      if (style) {
        style.image_url = styleData.image_url;
        console.log(
          `✅ JSON güncellendi: ${style.key} -> ${styleData.image_url}`
        );

        // Dosyayı kaydet
        fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 2));
        console.log(`💾 JSON dosyası kaydedildi: ${filePath}`);
        return;
      }
    }

    console.warn(`⚠️ Hair style bulunamadı: ${styleData.key}`);
  } catch (error) {
    console.error("❌ JSON güncelleme hatası:", error.message);
    throw error;
  }
}

// Ana işlem fonksiyonu (hair styles için)
async function processHairStyles(gender = "woman", startFromStyle = null) {
  try {
    console.log(`🚀 ${gender} hair style'ları işleniyor...`);

    // JSON dosyasını oku
    const jsonFile =
      gender === "woman" ? WOMAN_HAIR_STYLES_FILE : MAN_HAIR_STYLES_FILE;
    const hairData = JSON.parse(fs.readFileSync(jsonFile, "utf8"));

    // Toplam style sayısını hesapla
    let totalStyles = 0;
    for (const category of hairData.categories) {
      totalStyles += category.styles.length;
    }

    console.log(`📊 Toplam ${totalStyles} hair style bulundu`);

    let processedCount = 0;
    let startProcessing = !startFromStyle; // Eğer startFromStyle yoksa baştan başla

    // Her kategori ve style için işlem yap
    for (const category of hairData.categories) {
      console.log(
        `\n📂 Kategori: ${category.title} (${category.styles.length} style)`
      );

      for (const style of category.styles) {
        processedCount++;

        // Başlangıç style'ını kontrol et
        if (!startProcessing) {
          if (style.key === startFromStyle) {
            startProcessing = true;
            console.log(`🎯 ${startFromStyle} style'ından başlanıyor`);
          } else {
            continue; // Bu style'ı atla
          }
        }

        console.log(
          `\n🔄 [${processedCount}/${totalStyles}] İşleniyor: ${style.key}`
        );
        console.log(`📝 Prompt: ${style.prompt.substring(0, 100)}...`);

        try {
          // Prompt oluştur
          const prompt = createPrompt(style.prompt, gender);

          // Nano Banana'ya gönder (retry ile)
          console.log(`🔄 ${style.key} için işlem başlatılıyor...`);
          const generatedImageUrl = await callNanoBanana(
            prompt,
            EXAMPLE_IMAGE_PATH,
            gender
          );

          // Supabase'e yükle
          console.log(`📤 ${style.key} Supabase'e yükleniyor...`);
          const supabaseUrl = await uploadToSupabase(
            generatedImageUrl,
            style.key,
            gender
          );

          // JSON'u güncelle
          console.log(`💾 ${style.key} JSON'a ekleniyor...`);
          updateJsonFile(jsonFile, {
            key: style.key,
            image_url: supabaseUrl,
          });

          console.log(`✅ ${style.key} başarıyla tamamlandı!`);

          // Rate limiting için bekle
          await delay(2000);
        } catch (error) {
          console.error(`❌ ${style.key} işlenirken hata:`, error.message);

          // SKIP_POSE hatası ise sonraki style'a geç
          if (error.message.includes("SKIP_POSE")) {
            console.log(
              `⏭️ ${style.key} atlanıyor, sonraki style'a geçiliyor...`
            );
            continue;
          }

          // RLS hatası ise sonraki style'a geç (Supabase politikası eksik)
          if (error.message.includes("row-level security policy")) {
            console.log(
              `⏭️ ${style.key} RLS hatası nedeniyle atlanıyor, sonraki style'a geçiliyor...`
            );
            continue;
          }

          // Hata durumunda kısa bekle ve devam et
          console.log(`⏳ 10 saniye bekleniyor...`);
          await delay(10000);
          continue;
        }
      }
    }

    console.log(`\n🎉 ${gender} hair style'ları işlemi tamamlandı!`);
  } catch (error) {
    console.error("❌ Ana işlem hatası:", error.message);
    throw error;
  }
}

// CLI argümanlarını kontrol et
const args = process.argv.slice(2);
const gender = args[0] || "woman";
const startFromStyle = args[1] || null; // İkinci argüman: başlangıç style'u

if (!["woman", "man"].includes(gender)) {
  console.error(
    "❌ Geçersiz gender. Kullanım: node generate-hair-styles.js [woman|man] [startFromStyle]"
  );
  process.exit(1);
}

// Ana fonksiyonu çalıştır
processHairStyles(gender, startFromStyle)
  .then(() => {
    console.log("🎉 Script başarıyla tamamlandı!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Script hatası:", error.message);
    process.exit(1);
  });
