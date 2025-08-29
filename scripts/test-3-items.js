const fs = require("fs");
const path = require("path");

// .env dosyasının doğru path'ini belirt
require("dotenv").config({ path: path.join(__dirname, "../.env") });

// AccessoryLibrary'yi import et
const { accessoryLibrary } = require("../temp/accessoryLibrary_relevant.js");

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

// Çıktı klasörünü oluştur
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Renk paleti (basit)
const COLOR_PALETTE = ["#FF6B6B", "#E74C3C", "#C0392B", "#FF1744", "#D32F2F"];
let colorCounter = 0;

function getTestColor(accessoryName) {
  const colorIndex = colorCounter % COLOR_PALETTE.length;
  const selectedColor = COLOR_PALETTE[colorIndex];
  colorCounter++;
  console.log(
    `🎨 ${accessoryName} -> Renk #${colorIndex + 1}: ${selectedColor}`
  );
  return selectedColor;
}

// Test generation function
async function generateTestIcon(accessoryName, category) {
  const color = getTestColor(accessoryName);

  console.log(
    `🎨 ${accessoryName} iconunu oluşturuyor... (Kategori: ${category}, Renk: ${color})`
  );

  const prompt = `Draw a simple flat icon of a ${accessoryName} in the same style as the reference:
- clean outline illustration with bold lines
- single color stroke in ${color} color
- no shading, no gradients, no 3D effects
- white background
- minimalist, sticker-like style`;

  const requestBody = {
    input: {
      prompt: prompt,
      output_format: "jpg",
    },
  };

  try {
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
      throw new Error(`API hatası: ${response.status}`);
    }

    const result = await response.json();
    console.log(
      `📄 ${accessoryName} için prediction oluşturuldu: ${result.id}`
    );

    return {
      success: true,
      accessoryName,
      category,
      color,
      predictionId: result.id,
    };
  } catch (error) {
    console.error(`❌ ${accessoryName} hatası:`, error.message);
    return { success: false, accessoryName, category, error: error.message };
  }
}

// Ana test fonksiyonu
async function test3Items() {
  console.log("🚀 3 Item Test başlatılıyor...");

  const testItems = [
    { name: "Sunglasses", category: "Casual" },
    { name: "Baseball Cap", category: "Casual" },
    { name: "Beanie", category: "Casual" },
  ];

  for (const item of testItems) {
    console.log(
      `\n[${testItems.indexOf(item) + 1}/3] ${item.name} işleniyor...`
    );

    const result = await generateTestIcon(item.name, item.category);

    if (result.success) {
      console.log(
        `✅ ${item.name} başarıyla başlatıldı! (Renk: ${result.color})`
      );
    } else {
      console.log(`❌ ${item.name} başarısız: ${result.error}`);
    }

    // API rate limit için bekle
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.log("\n🎉 Test tamamlandı!");
  console.log(
    "📝 Predictions oluşturuldu. 1-2 dakika sonra sonuçları kontrol edebilirsin."
  );
}

test3Items().catch(console.error);
