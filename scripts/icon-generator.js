const fs = require("fs");
const path = require("path");

// .env dosyasının doğru path'ini belirt
require("dotenv").config({ path: path.join(__dirname, "../.env") });

// AccessoryLibrary'yi import et
const accessoryLibraryData = require("../temp/accessoryLibrary_relevant.json");
const accessoryLibrary = accessoryLibraryData;

// Supabase client'ı import et (optional)
let supabase = null;
try {
  supabase = require("../src/supabaseClient");
  console.log("✅ Supabase bağlandı");
} catch (error) {
  console.log(
    "⚠️ Supabase bağlantısı başarısız, sadece local storage kullanılacak"
  );
}

const REPLICATE_API_TOKEN = "r8_VOZ18ZqNu1sgLJnZS7Py83sD9HGmYML0uXYyS";
const OUTPUT_DIR = path.join(__dirname, "../generated-icons");
const REFERENCE_IMAGE_PATH = path.join(__dirname, "../example_nano.png");

// Genişletilmiş renk paleti - her icon için farklı renk garantisi
const COLOR_PALETTE = [
  // Kırmızı tonları
  "#FF6B6B", // Coral kırmızı
  "#E74C3C", // Ateş kırmızısı
  "#C0392B", // Koyu kırmızı
  "#FF1744", // Pink kırmızı
  "#D32F2F", // Klasik kırmızı
  "#B71C1C", // Bordo
  "#FF5722", // Turuncu kırmızı

  // Turuncu tonları
  "#FF9800", // Turuncu
  "#FF6F00", // Amber turuncu
  "#FF8A65", // Açık turuncu
  "#F57C00", // Koyu turuncu
  "#FF7043", // Deep orange
  "#FFB74D", // Soft turuncu

  // Sarı tonları
  "#FFD54F", // Sarı
  "#FFC107", // Amber sarı
  "#FFEB3B", // Parlak sarı
  "#F9A825", // Koyu sarı
  "#FFF176", // Açık sarı
  "#FFD600", // Canary sarı

  // Yeşil tonları
  "#4CAF50", // Yeşil
  "#8BC34A", // Açık yeşil
  "#2E7D32", // Koyu yeşil
  "#00C853", // Parlak yeşil
  "#66BB6A", // Soft yeşil
  "#A5D6A7", // Pastel yeşil
  "#00BCD4", // Cyan yeşil
  "#26A69A", // Teal
  "#009688", // Koyu teal

  // Mavi tonları
  "#2196F3", // Mavi
  "#03A9F4", // Açık mavi
  "#0D47A1", // Koyu mavi
  "#1976D2", // Klasik mavi
  "#42A5F5", // Sky mavi
  "#64B5F6", // Soft mavi
  "#81C784", // Yeşilimsi mavi

  // Mor tonları
  "#9C27B0", // Purple
  "#673AB7", // Deep purple
  "#3F51B5", // Indigo
  "#E91E63", // Pink purple
  "#8E24AA", // Koyu mor
  "#BA68C8", // Açık mor
  "#CE93D8", // Soft mor

  // Ek renkler
  "#607D8B", // Blue grey
  "#795548", // Brown
  "#FF5252", // Red accent
  "#FF4081", // Pink accent
  "#E040FB", // Purple accent
  "#7C4DFF", // Deep purple accent
  "#536DFE", // Indigo accent
  "#40C4FF", // Light blue accent
  "#18FFFF", // Cyan accent
  "#64FFDA", // Teal accent
  "#69F0AE", // Green accent
  "#B2FF59", // Light green accent
  "#EEFF41", // Lime accent
  "#FFFF00", // Yellow accent
  "#FFD740", // Amber accent
  "#FFAB40", // Orange accent
  "#FF6E40", // Deep orange accent

  // Pastel renkler
  "#FFB3BA", // Pastel pembe
  "#FFDFBA", // Pastel turuncu
  "#FFFFBA", // Pastel sarı
  "#BAFFC9", // Pastel yeşil
  "#BAE1FF", // Pastel mavi
  "#E6E6FA", // Lavender
  "#FFE4E1", // Misty rose
  "#F0E68C", // Khaki
  "#DDA0DD", // Plum
  "#98FB98", // Pale green
  "#F5DEB3", // Wheat
  "#D3D3D3", // Light grey

  // Vibrant renkler
  "#FF073A", // Neon kırmızı
  "#39FF14", // Neon yeşil
  "#1B03A3", // Electric blue
  "#FE4164", // Radical red
  "#08E8DE", // Bright turquoise
  "#FBEC5D", // Laser lemon
  "#6A0DAD", // Purple2
  "#FF1493", // Deep pink
  "#00FF7F", // Spring green
  "#DC143C", // Crimson
  "#FF69B4", // Hot pink
  "#32CD32", // Lime green
  "#FF4500", // Orange red
  "#9370DB", // Medium purple
  "#20B2AA", // Light sea green
  "#FF6347", // Tomato
  "#4169E1", // Royal blue
  "#FFD700", // Gold
  "#00CED1", // Dark turquoise
  "#FF8C00", // Dark orange
  "#9ACD32", // Yellow green
];

// Çıktı klasörünü oluştur
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Delay fonksiyonu
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Replicate prediction'ı poll et
async function pollPrediction(predictionId, accessoryName) {
  const MAX_POLL_ATTEMPTS = 60; // 10 dakika (10 saniye x 60)
  let attempt = 0;

  while (attempt < MAX_POLL_ATTEMPTS) {
    try {
      console.log(
        `🔄 ${accessoryName} polling... (${attempt + 1}/${MAX_POLL_ATTEMPTS})`
      );

      const response = await fetch(
        `https://api.replicate.com/v1/predictions/${predictionId}`,
        {
          headers: {
            Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Poll API hatası: ${response.status}`);
      }

      const result = await response.json();

      if (result.status === "succeeded" && result.output) {
        console.log(`✅ ${accessoryName} polling tamamlandı!`);
        // Output direkt string veya array olabilir
        const imageUrl = Array.isArray(result.output)
          ? result.output[0]
          : result.output;
        return { success: true, imageUrl: imageUrl };
      } else if (result.status === "failed") {
        return { success: false, error: result.error || "Prediction failed" };
      } else if (result.status === "canceled") {
        return { success: false, error: "Prediction canceled" };
      }

      // Hala processing durumunda, bekle
      await delay(10000); // 10 saniye bekle
      attempt++;
    } catch (error) {
      console.error(`❌ ${accessoryName} polling hatası:`, error.message);
      await delay(5000); // Hata durumunda 5 saniye bekle
      attempt++;
    }
  }

  return { success: false, error: "Polling timeout - 10 dakika geçti" };
}

// Kullanılan renkleri takip et
const usedColors = new Set();
let colorCounter = 0; // Basit counter sistemi

// Renk seçme fonksiyonu - her accessory için gerçekten farklı renk
function getColorForAccessory(accessoryName, category) {
  // Basit sıralı renk seçimi
  const colorIndex = colorCounter % COLOR_PALETTE.length;
  const selectedColor = COLOR_PALETTE[colorIndex];

  // Counter'ı artır
  colorCounter++;

  // Rengi kullanılan renkler listesine ekle
  usedColors.add(selectedColor);

  console.log(
    `🎨 ${accessoryName} -> Renk #${colorIndex + 1}: ${selectedColor}`
  );

  return selectedColor;
}

// Renk istatistiklerini göster
function logColorStats() {
  console.log(`\n🎨 RENK İSTATİSTİKLERİ:`);
  console.log(`📊 Toplam renk paleti: ${COLOR_PALETTE.length} renk`);
  console.log(`✅ Kullanılan renkler: ${usedColors.size} renk`);
  console.log(
    `📈 Renk çeşitliliği: ${(
      (usedColors.size / COLOR_PALETTE.length) *
      100
    ).toFixed(1)}%`
  );

  if (usedColors.size === COLOR_PALETTE.length) {
    console.log(`🌈 Tüm renkler kullanıldı! Mükemmel çeşitlilik!`);
  } else if (usedColors.size > COLOR_PALETTE.length * 0.8) {
    console.log(`🎯 Harika renk çeşitliliği!`);
  }
}

// Referans resmi base64'e çevir
function getReferenceImageBase64() {
  try {
    if (fs.existsSync(REFERENCE_IMAGE_PATH)) {
      const imageBuffer = fs.readFileSync(REFERENCE_IMAGE_PATH);
      const base64 = imageBuffer.toString("base64");
      return `data:image/png;base64,${base64}`;
    } else {
      console.warn("⚠️ Referans resim bulunamadı:", REFERENCE_IMAGE_PATH);
      return null;
    }
  } catch (error) {
    console.error("❌ Referans resim okunamadı:", error.message);
    return null;
  }
}

// Icon oluşturma fonksiyonu
async function generateIcon(accessoryName, category, retryCount = 0) {
  const MAX_RETRIES = 3;

  // 3D isometric stil kullandığımız için renk belirtmiyoruz

  console.log(
    `🎨 ${accessoryName} iconunu oluşturuyor... (Kategori: ${category})`
  );

  const prompt = `Create a 3D isometric icon of a ${accessoryName}:
- centered in the frame
- simple clay-like rendering style
- soft pastel colors with smooth gradients
- subtle shadows and highlights
- white background
- consistent proportions, medium size
- playful, modern, app-icon style`;

  const requestBody = {
    input: {
      prompt: prompt,
      output_format: "png",
    },
  };

  // Referans resim base64 formatında ekle
  const referenceImage = getReferenceImageBase64();
  if (referenceImage) {
    requestBody.input.image_input = [referenceImage];
    console.log(`📷 Referans resim eklendi (base64)`);
  } else {
    console.log(`⚠️ Referans resim eklenemedi`);
  }

  try {
    const response = await fetch(
      "https://api.replicate.com/v1/models/google/nano-banana/predictions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
          Prefer: "wait",
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      throw new Error(
        `API hatası: ${response.status} - ${response.statusText}`
      );
    }

    const result = await response.json();

    if (result.status === "succeeded" && result.output) {
      // Output direkt string veya array olabilir
      const imageUrl = Array.isArray(result.output)
        ? result.output[0]
        : result.output;
      console.log(`🔗 Image URL: ${imageUrl}`);
      await downloadImage(imageUrl, accessoryName, category);
      console.log(`✅ ${accessoryName} başarıyla oluşturuldu!`);
      return { success: true, accessoryName, category };
    } else if (result.status === "processing") {
      // Prediction işleniyor, poll et
      console.log(
        `⏳ ${accessoryName} işleniyor... Prediction ID: ${result.id}`
      );
      const finalResult = await pollPrediction(result.id, accessoryName);

      if (finalResult.success) {
        await downloadImage(finalResult.imageUrl, accessoryName, category);
        console.log(`✅ ${accessoryName} başarıyla oluşturuldu!`);
        return { success: true, accessoryName, category };
      } else {
        throw new Error(finalResult.error);
      }
    } else {
      throw new Error(
        `Görüntü oluşturulamadı: ${
          result.error || result.detail || "Bilinmeyen hata"
        }`
      );
    }
  } catch (error) {
    console.error(`❌ ${accessoryName} oluşturulurken hata:`, error.message);

    if (retryCount < MAX_RETRIES) {
      console.log(
        `🔄 ${accessoryName} için yeniden deneniyor... (${
          retryCount + 1
        }/${MAX_RETRIES})`
      );
      await delay(2000); // 2 saniye bekle
      return generateIcon(accessoryName, category, retryCount + 1);
    } else {
      console.error(
        `💀 ${accessoryName} için maksimum deneme sayısına ulaşıldı`
      );
      return { success: false, accessoryName, category, error: error.message };
    }
  }
}

// Supabase'e upload fonksiyonu (optional)
async function uploadToSupabase(buffer, fileName, accessoryName, category) {
  if (!supabase) {
    console.log(
      `⏭️ Supabase bağlantısı yok, ${fileName} sadece local'e kaydedildi`
    );
    return null;
  }

  try {
    const supabasePath = `generated-icons/${fileName}`;

    const { data, error } = await supabase.storage
      .from("icons")
      .upload(supabasePath, buffer, {
        contentType: "image/jpeg",
        upsert: true,
      });

    if (error) {
      throw error;
    }

    console.log(`☁️ ${fileName} Supabase'e yüklendi`);

    // Public URL al
    const { data: publicData } = supabase.storage
      .from("icons")
      .getPublicUrl(supabasePath);

    return {
      path: supabasePath,
      publicUrl: publicData.publicUrl,
      bucket: "icons",
    };
  } catch (error) {
    console.error(`Supabase upload hatası:`, error.message);
    return null; // Hata durumunda null dön, işlemi durdurma
  }
}

// Görüntüyü indirme ve kaydetme fonksiyonu
async function downloadImage(imageUrl, accessoryName, category) {
  try {
    console.log(`📥 İndiriliyor: ${imageUrl}`);
    const response = await fetch(imageUrl);
    const buffer = await response.arrayBuffer();

    // Dosya adını güvenli hale getir
    const safeFileName = accessoryName
      .replace(/[^a-zA-Z0-9]/g, "_")
      .toLowerCase();
    const fileName = `${category}_${safeFileName}.png`;
    const filePath = path.join(OUTPUT_DIR, fileName);

    // Buffer'ı Node.js Buffer'ına çevir
    const nodeBuffer = Buffer.from(buffer);

    // Local'e kaydet
    fs.writeFileSync(filePath, nodeBuffer);
    console.log(`💾 ${fileName} local'e kaydedildi`);

    // Supabase'e yükle
    const supabaseResult = await uploadToSupabase(
      nodeBuffer,
      fileName,
      accessoryName,
      category
    );
    console.log(`🌐 Public URL: ${supabaseResult.publicUrl}`);

    return {
      localPath: filePath,
      fileName: fileName,
      supabase: supabaseResult,
    };
  } catch (error) {
    console.error(`Görüntü indirilemedi:`, error.message);
    throw error;
  }
}

// Tüm iconları oluştur
async function generateAllIcons() {
  console.log("🚀 Icon Generator başlatılıyor...");
  console.log(`📁 Çıktı klasörü: ${OUTPUT_DIR}`);

  const results = {
    successful: [],
    failed: [],
  };

  let totalCount = 0;
  let processedCount = 0;

  // Toplam item sayısını hesapla
  Object.keys(accessoryLibrary).forEach((category) => {
    totalCount += accessoryLibrary[category].length;
  });

  console.log(`📊 Toplam ${totalCount} icon oluşturulacak`);

  // Her kategori için iconları oluştur
  for (const [category, accessories] of Object.entries(accessoryLibrary)) {
    console.log(
      `\n📂 ${category} kategorisi işleniyor... (${accessories.length} item)`
    );

    for (const accessory of accessories) {
      processedCount++;
      console.log(`\n[${processedCount}/${totalCount}] İşleniyor...`);

      const result = await generateIcon(accessory.name, category);

      if (result.success) {
        results.successful.push(result);
      } else {
        results.failed.push(result);
      }

      // API rate limit için kısa bir bekleme
      await delay(1000);
    }
  }

  // Sonuçları göster
  console.log("\n" + "=".repeat(50));
  console.log("📊 SONUÇLAR:");
  console.log(`✅ Başarılı: ${results.successful.length}`);
  console.log(`❌ Başarısız: ${results.failed.length}`);
  console.log(`📈 Toplam: ${totalCount}`);

  if (results.failed.length > 0) {
    console.log("\n❌ Başarısız olanlar:");
    results.failed.forEach((item) => {
      console.log(`  - ${item.category}/${item.accessoryName}: ${item.error}`);
    });
  }

  // Sonuçları JSON olarak kaydet
  const reportPath = path.join(OUTPUT_DIR, "generation-report.json");
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        totalCount,
        successful: results.successful.length,
        failed: results.failed.length,
        details: results,
      },
      null,
      2
    )
  );

  console.log(`\n📄 Rapor kaydedildi: ${reportPath}`);
  console.log("🎉 Icon generation tamamlandı!");
}

// Belirli bir kategori için iconları oluştur
async function generateCategoryIcons(categoryName) {
  if (!accessoryLibrary[categoryName]) {
    console.error(`❌ Kategori bulunamadı: ${categoryName}`);
    console.log(
      "Mevcut kategoriler:",
      Object.keys(accessoryLibrary).join(", ")
    );
    return;
  }

  console.log(
    `🚀 ${categoryName} kategorisi için icon generation başlatılıyor...`
  );

  const accessories = accessoryLibrary[categoryName];
  const results = { successful: [], failed: [] };

  for (let i = 0; i < accessories.length; i++) {
    const accessory = accessories[i];
    console.log(
      `\n[${i + 1}/${accessories.length}] ${accessory.name} işleniyor...`
    );

    const result = await generateIcon(accessory.name, categoryName);

    if (result.success) {
      results.successful.push(result);
      console.log(
        `✅ Başarılı: ${results.successful.length} / İşlenen: ${i + 1}`
      );
    } else {
      results.failed.push(result);
      console.log(`❌ Başarısız: ${results.failed.length} / İşlenen: ${i + 1}`);
    }

    await delay(1000);
  }

  console.log("\n" + "=".repeat(30));
  console.log(`📊 ${categoryName} SONUÇLARI:`);
  console.log(`✅ Başarılı: ${results.successful.length}`);
  console.log(`❌ Başarısız: ${results.failed.length}`);
}

// CLI argümanlarını kontrol et
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    generateAllIcons().catch(console.error);
  } else if (args[0] === "--category" && args[1]) {
    generateCategoryIcons(args[1]).catch(console.error);
  } else if (args[0] === "--list-categories") {
    console.log("Mevcut kategoriler:");
    Object.keys(accessoryLibrary).forEach((category) => {
      console.log(`- ${category} (${accessoryLibrary[category].length} item)`);
    });
  } else {
    console.log("Kullanım:");
    console.log(
      "  node icon-generator.js                    # Tüm iconları oluştur"
    );
    console.log(
      "  node icon-generator.js --category Casual  # Sadece belirli kategori"
    );
    console.log(
      "  node icon-generator.js --list-categories  # Kategorileri listele"
    );
  }
}

module.exports = {
  generateIcon,
  generateAllIcons,
  generateCategoryIcons,
};
