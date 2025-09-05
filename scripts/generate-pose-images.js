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
const WOMAN_POSES_FILE = path.join(__dirname, "../lib/woman_poses_new.json");
const MAN_POSES_FILE = path.join(__dirname, "../lib/man_poses_new.json");
const EXAMPLE_IMAGE_PATH = path.join(__dirname, "../lib/example.jpg");

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

      // Son deneme değilse devam et
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }

      throw error;
    }
  }

  throw new Error("Polling timeout - maksimum deneme sayısına ulaşıldı");
}

// Nano Banana API'ye istek gönder (retry ile)
async function callNanoBanana(prompt, imagePath, gender) {
  const maxRetries = 3;
  let lastError = null;

  for (let retry = 1; retry <= maxRetries; retry++) {
    try {
      console.log(
        `🎨 ${gender} pose için Nano Banana'ya istek gönderiliyor... (Deneme ${retry}/${maxRetries})`
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
      .from("new_poses")
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
Supabase'de 'new_poses' bucket için Row Level Security (RLS) politikası eksik.

Çözüm:
1. Supabase Dashboard'a git
2. Storage -> new_poses bucket -> Policies
3. Aşağıdaki INSERT politikasını ekle:

Name: Allow file uploads
Definition: true
Operation: INSERT

Veya SQL ile:
CREATE POLICY "Allow file uploads" ON storage.objects
FOR INSERT WITH CHECK (bucket_id = 'new_poses');
        `);
      }

      throw error;
    }

    console.log(`✅ ${fileName} Supabase'e yüklendi`);

    // Public URL al
    const { data: urlData } = supabase.storage
      .from("new_poses")
      .getPublicUrl(`${gender}/${fileName}.png`);

    return urlData.publicUrl;
  } catch (error) {
    console.error("❌ Supabase yükleme hatası:", error.message);
    throw error;
  }
}

// Prompt oluştur
function createPrompt(title, gender) {
  const genderText = gender === "woman" ? "female" : "male";

  return `${title}. Create a professional fashion photograph of a real person in a clean white seamless studio. The model is wearing a plain white athletic tank top paired with fitted white training shorts, presented as a simple and safe sports outfit. A colorful pose chart must be overlaid directly onto the clothing: bold lines connect each body joint, with bright round dots at the key points such as shoulders, elbows, wrists, hips, knees, ankles, and the head connection. Each limb section should use a distinct bright gradient color so the design appears sharp, vibrant, and aligned perfectly with the natural body curves. The overlay should look flat and graphic, integrated as if printed directly on the outfit, never floating above it. The model’s skin, hair, and face must remain unchanged and photorealistic while the background stays pure white and distraction-free, ensuring the result looks like a professional fashion studio photo used for educational visualization.
`;
}

// JSON dosyasını güncelle
function updateJsonFile(filePath, poseData) {
  try {
    const jsonData = JSON.parse(fs.readFileSync(filePath, "utf8"));

    // Pose'u bul ve image_url ekle
    const pose = jsonData.find((p) => p.id === poseData.id);
    if (pose) {
      pose.image_url = poseData.image_url;
      console.log(`✅ JSON güncellendi: ${pose.key} -> ${poseData.image_url}`);
    } else {
      console.warn(`⚠️ Pose bulunamadı: ID ${poseData.id}`);
    }

    // Dosyayı kaydet
    fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 2));
    console.log(`💾 JSON dosyası kaydedildi: ${filePath}`);
  } catch (error) {
    console.error("❌ JSON güncelleme hatası:", error.message);
    throw error;
  }
}

// Ana işlem fonksiyonu
async function processPoses(gender = "woman", startFromPose = null) {
  try {
    console.log(`🚀 ${gender} pose'ları işleniyor...`);

    // JSON dosyasını oku
    const jsonFile = gender === "woman" ? WOMAN_POSES_FILE : MAN_POSES_FILE;
    const poses = JSON.parse(fs.readFileSync(jsonFile, "utf8"));

    console.log(`📊 Toplam ${poses.length} pose bulundu`);

    // Başlangıç pose'unu bul
    let startIndex = 0;
    if (startFromPose) {
      startIndex = poses.findIndex((pose) => pose.key === startFromPose);
      if (startIndex === -1) {
        console.error(`❌ Pose bulunamadı: ${startFromPose}`);
        process.exit(1);
      }
      console.log(
        `🎯 ${startFromPose} pose'undan başlanıyor (${startIndex + 1}/${
          poses.length
        })`
      );
    }

    // Her pose için işlem yap
    for (let i = startIndex; i < poses.length; i++) {
      const pose = poses[i];

      console.log(`\n🔄 [${i + 1}/${poses.length}] İşleniyor: ${pose.key}`);
      console.log(`📝 Title: ${pose.title}`);

      try {
        // Prompt oluştur
        const prompt = createPrompt(pose.title, gender);

        // Nano Banana'ya gönder (retry ile)
        console.log(`🔄 ${pose.key} için işlem başlatılıyor...`);
        const generatedImageUrl = await callNanoBanana(
          prompt,
          EXAMPLE_IMAGE_PATH,
          gender
        );

        // Supabase'e yükle
        console.log(`📤 ${pose.key} Supabase'e yükleniyor...`);
        const supabaseUrl = await uploadToSupabase(
          generatedImageUrl,
          pose.key,
          gender
        );

        // JSON'u güncelle
        console.log(`💾 ${pose.key} JSON'a ekleniyor...`);
        updateJsonFile(jsonFile, {
          id: pose.id,
          image_url: supabaseUrl,
        });

        console.log(`✅ ${pose.key} başarıyla tamamlandı!`);

        // Rate limiting için bekle
        await delay(2000);
      } catch (error) {
        console.error(`❌ ${pose.key} işlenirken hata:`, error.message);

        // SKIP_POSE hatası ise sonraki pose'a geç
        if (error.message.includes("SKIP_POSE")) {
          console.log(`⏭️ ${pose.key} atlanıyor, sonraki pose'a geçiliyor...`);
          continue;
        }

        // RLS hatası ise sonraki pose'a geç (Supabase politikası eksik)
        if (error.message.includes("row-level security policy")) {
          console.log(
            `⏭️ ${pose.key} RLS hatası nedeniyle atlanıyor, sonraki pose'a geçiliyor...`
          );
          continue;
        }

        // RETRYABLE_ERROR hatası ise daha uzun bekle
        if (error.message.includes("RETRYABLE_ERROR")) {
          console.log(`⏳ Retryable hata, 30 saniye bekleniyor...`);
          await delay(30000);
        } else {
          console.log(`⏳ 10 saniye bekleniyor...`);
          await delay(10000);
        }

        console.log(`🔄 ${pose.key} tekrar deneniyor...`);
        i--; // Aynı pose'u tekrar dene
        continue;
      }
    }

    console.log(`\n🎉 ${gender} pose'ları işlemi tamamlandı!`);
  } catch (error) {
    console.error("❌ Ana işlem hatası:", error.message);
    throw error;
  }
}

// CLI argümanlarını kontrol et
const args = process.argv.slice(2);
const gender = args[0] || "woman";
const startFromPose = args[1] || null; // İkinci argüman: başlangıç pose'u

if (!["woman", "man"].includes(gender)) {
  console.error(
    "❌ Geçersiz gender. Kullanım: node generate-pose-images.js [woman|man] [startFromPose]"
  );
  process.exit(1);
}

// Ana fonksiyonu çalıştır
processPoses(gender, startFromPose)
  .then(() => {
    console.log("🎉 Script başarıyla tamamlandı!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Script hatası:", error.message);
    process.exit(1);
  });
