// Varsayılan videoları Supabase'e ekleyen script
const supabase = require("../src/supabaseClient");

const defaultVideos = [
  // Hero videoları (HomeScreen için)
  {
    type: "hero",
    title: "Ana Hero Video",
    url: "https://dsaprojectsphqnfhzpzpch.supabase.co/storage/v1/object/public/video_files/hero_main.mp4",
    description: "Ana sayfa hero videosu - temel demonstrasyon",
    priority: 1,
  },
  {
    type: "hero",
    title: "Hero Video 2",
    url: "https://dsaprojectsphqnfhzpzpch.supabase.co/storage/v1/object/public/video_files/hero_alt.mp4",
    description: "Ana sayfa alternatif hero videosu",
    priority: 2,
  },

  // Paywall videoları (PaywallV3Screen için)
  {
    type: "paywall",
    title: "Paywall Hero Video",
    url: "https://dsaprojectsphqnfhzpzpch.supabase.co/storage/v1/object/public/video_files/paywall_hero.mp4",
    description: "Paywall sayfası hero videosu - premium özellikleri",
    priority: 1,
  },
  {
    type: "paywall",
    title: "Paywall Demo Video",
    url: "https://dsaprojectsphqnfhzpzpch.supabase.co/storage/v1/object/public/video_files/paywall_demo.mp4",
    description: "Paywall demonstrasyon videosu",
    priority: 2,
  },

  // Before/After videoları (Popular cards için)
  {
    type: "before_after",
    title: "Image to Video Transformation",
    url: "https://dsaprojectsphqnfhzpzpch.supabase.co/storage/v1/object/public/video_files/before_after_video.mp4",
    description: "Resimden videoya dönüşüm örneği - AI teknolojisi",
    priority: 1,
  },
  {
    type: "before_after",
    title: "AI Enhancement Demo",
    url: "https://dsaprojectsphqnfhzpzpch.supabase.co/storage/v1/object/public/video_files/ai_enhancement.mp4",
    description: "AI ile resim geliştirme demonstrasyonu",
    priority: 2,
  },
];

async function setupDefaultVideos() {
  try {
    console.log("🎬 Varsayılan videolar Supabase'e ekleniyor...");

    for (const video of defaultVideos) {
      console.log(`📹 Ekleniyor: ${video.title} (${video.type})`);

      // Aynı başlıkta video var mı kontrol et
      const { data: existingVideo } = await supabase
        .from("videos")
        .select("id")
        .eq("title", video.title)
        .single();

      if (existingVideo) {
        console.log(`   ⚠️  Zaten mevcut, atlanıyor: ${video.title}`);
        continue;
      }

      // Video ekle
      const { data, error } = await supabase
        .from("videos")
        .insert([
          {
            ...video,
            is_active: true,
            created_at: new Date().toISOString(),
          },
        ])
        .select()
        .single();

      if (error) {
        console.error(`   ❌ Hata: ${video.title}:`, error.message);
      } else {
        console.log(`   ✅ Başarıyla eklendi: ${data.id}`);
      }
    }

    console.log("🎉 Varsayılan video kurulumu tamamlandı!");

    // Sonuçları göster
    const { data: allVideos, error } = await supabase
      .from("videos")
      .select("*")
      .eq("is_active", true)
      .order("type")
      .order("priority");

    if (!error) {
      console.log("\n📊 Mevcut videolar:");
      allVideos.forEach((video) => {
        console.log(
          `  ${video.type}: ${video.title} (Priority: ${video.priority})`
        );
      });
    }
  } catch (error) {
    console.error("❌ Script hatası:", error);
  }
}

// Script çalıştır
if (require.main === module) {
  setupDefaultVideos()
    .then(() => {
      console.log("✅ Script tamamlandı");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Script başarısız:", error);
      process.exit(1);
    });
}

module.exports = { setupDefaultVideos, defaultVideos };
