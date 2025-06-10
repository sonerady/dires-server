const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function removeTitleColumn() {
  try {
    console.log("🗑️ info_modals tablosundan title column'u kaldırılıyor...");

    // Önce mevcut verileri backup al
    const { data: existingModals, error: selectError } = await supabase
      .from("info_modals")
      .select("*");

    if (selectError) {
      console.error("❌ Mevcut veri okuma hatası:", selectError);
      return;
    }

    console.log(`📊 ${existingModals.length} adet modal bulundu`);

    // Title'ları content içine taşı
    for (const modal of existingModals) {
      if (modal.title && modal.content) {
        const updatedContent = { ...modal.content };

        // Her dil için title ekle
        Object.keys(updatedContent).forEach((lang) => {
          if (
            updatedContent[lang] &&
            typeof updatedContent[lang] === "object"
          ) {
            updatedContent[lang].title = modal.title;
          }
        });

        // Eğer hiç dil yoksa en azından tr ve en ekle
        if (Object.keys(updatedContent).length === 0) {
          updatedContent.tr = { title: modal.title };
          updatedContent.en = { title: modal.title };
        }

        // Content'i güncelle
        const { error: updateError } = await supabase
          .from("info_modals")
          .update({ content: updatedContent })
          .eq("id", modal.id);

        if (updateError) {
          console.error(`❌ Modal ${modal.id} güncelleme hatası:`, updateError);
        } else {
          console.log(`✅ Modal ${modal.id} title'ı content'e taşındı`);
        }
      }
    }

    // Şimdi title column'unu kaldır
    console.log("🗑️ Title column'u kaldırılıyor...");

    // Not: Bu Supabase RPC ile yapılması gerekebilir
    console.log(
      "ℹ️ Lütfen Supabase Dashboard'dan manuel olarak şu komutu çalıştırın:"
    );
    console.log("ALTER TABLE info_modals DROP COLUMN IF EXISTS title;");
  } catch (error) {
    console.error("❌ Migration hatası:", error);
  }
}

removeTitleColumn();
