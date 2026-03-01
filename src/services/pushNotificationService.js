const { Expo } = require("expo-server-sdk");
const { supabase } = require("../supabaseClient");
const path = require("path");
const fs = require("fs");

const expo = new Expo();

// Locales dosyalarını yükle
const localesPath = path.join(__dirname, "../../../client/locales");
const translations = {};

try {
  const localeFiles = ["en", "tr", "es", "fr", "de", "it", "ja", "ko", "pt", "ru", "zh"];
  localeFiles.forEach((locale) => {
    const filePath = path.join(localesPath, `${locale}.json`);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf8");
      translations[locale] = JSON.parse(content);
    }
  });
  console.log(`✅ [LOCALES] ${Object.keys(translations).length} dil yüklendi`);
} catch (error) {
  console.error("❌ [LOCALES] Locales yükleme hatası:", error);
}

// Dil kodunu normalize et (tr-TR -> tr, en-US -> en)
function normalizeLanguageCode(language) {
  if (!language) return "en";
  // İlk 2 karakteri al (tr-TR -> tr, en-US -> en)
  const normalized = language.split("-")[0].toLowerCase();
  // Desteklenen diller listesi
  const supportedLanguages = ["en", "tr", "es", "fr", "de", "it", "ja", "ko", "pt", "ru", "zh"];
  // Eğer desteklenen dillerden biri değilse "en" döndür
  return supportedLanguages.includes(normalized) ? normalized : "en";
}

// Notification metinlerini al
function getNotificationText(language, key) {
  const lang = normalizeLanguageCode(language);
  const locale = translations[lang] || translations["en"];
  return locale?.notification?.[key] || translations["en"]?.notification?.[key] || "";
}

/**
 * Push notification gönderme fonksiyonu
 * @param {string} userId - Kullanıcı ID'si
 * @param {string} title - Bildirim başlığı
 * @param {string} body - Bildirim içeriği
 * @param {object} data - Ek data (opsiyonel)
 * @returns {Promise<{success: boolean, error?: string, tickets?: array}>}
 */
async function sendPushNotification(userId, title, body, data = {}) {
  try {
    console.log(`📱 [PUSH] Notification gönderiliyor - UserId: ${userId?.slice(0, 8)}`);

    // Kullanıcının push token'ını ve dil tercihini veritabanından al
    const { data: userData, error } = await supabase
      .from("users")
      .select("push_token, preferred_language")
      .eq("id", userId)
      .single();

    if (error) {
      console.error(`❌ [PUSH] User sorgu hatası:`, error);
      return { success: false, error: "Kullanıcı bulunamadı" };
    }

    if (!userData || !userData.push_token) {
      console.log(`⚠️ [PUSH] User ${userId?.slice(0, 8)} için push token bulunamadı`);
      return { success: false, error: "Push token bulunamadı" };
    }

    const pushToken = userData.push_token;

    // Token geçerliliğini kontrol et
    if (!Expo.isExpoPushToken(pushToken)) {
      console.error(`❌ [PUSH] Geçersiz Expo push token: ${pushToken?.substring(0, 20)}...`);
      return { success: false, error: "Geçersiz push token" };
    }

    // Notification mesajını hazırla
    const messages = [
      {
        to: pushToken,
        sound: "default",
        title: title,
        body: body,
        data: data,
        badge: 1,
      },
    ];

    // Mesajları chunk'lara böl (Expo'nun limiti var)
    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];

    // Her chunk'ı gönder
    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
        console.log(`✅ [PUSH] Chunk gönderildi: ${chunk.length} mesaj`);
        
        // Ticket sonuçlarını kontrol et
        ticketChunk.forEach((ticket, index) => {
          if (ticket.status === "error") {
            console.error(`❌ [PUSH] Ticket hatası:`, {
              error: ticket.message,
              details: ticket.details,
              token: chunk[index]?.to?.substring(0, 30) + "...",
            });
          } else if (ticket.status === "ok") {
            console.log(`✅ [PUSH] Ticket başarılı - ID: ${ticket.id}`);
          }
        });
      } catch (error) {
        console.error("❌ [PUSH] Notification gönderme hatası:", error);
      }
    }

    // Ticket'larda hata var mı kontrol et
    const hasErrors = tickets.some(ticket => ticket.status === "error");
    if (hasErrors) {
      console.error(`❌ [PUSH] Bazı ticket'larda hata var - UserId: ${userId?.slice(0, 8)}`);
    } else {
      console.log(`✅ [PUSH] Notification başarıyla gönderildi - UserId: ${userId?.slice(0, 8)}`);
    }
    
    return { success: !hasErrors, tickets };
  } catch (error) {
    console.error("❌ [PUSH] Push notification hatası:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Generation completed notification gönderme fonksiyonu
 * @param {string} userId - Kullanıcı ID'si
 * @param {string} generationId - Generation ID'si
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendGenerationCompletedNotification(userId, generationId, options = {}) {
  // Skip push notification for web-generated requests
  if (options.source === 'web') {
    console.log(`⏭️ [NOTIFICATION] Skipping push notification for web request: ${generationId?.slice(0, 8)}`);
    return { success: true, skipped: true };
  }

  try {
    // Kullanıcının dil tercihini al
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("preferred_language")
      .eq("id", userId)
      .single();

    const rawLanguage = userData?.preferred_language || "en";
    // Dil kodunu normalize et (tr-TR -> tr)
    const language = normalizeLanguageCode(rawLanguage);
    
    console.log(`🌐 [NOTIFICATION] Raw language: ${rawLanguage}, Normalized: ${language}`);
    
    // Lokalize edilmiş metinleri al
    const title = getNotificationText(language, "generationCompletedTitle");
    const body = getNotificationText(language, "generationCompletedBody");
    
    // Fallback: Eğer metin bulunamazsa İngilizce kullan
    const finalTitle = title || "🎉 Your process is complete!";
    const finalBody = body || "Your model photo is ready. You can view the results.";
    
    console.log(`🌐 [NOTIFICATION] Language: ${language}, Title: ${finalTitle.substring(0, 30)}...`);
    
    const data = {
      type: "generation_completed",
      generationId: generationId,
    };

    return await sendPushNotification(userId, finalTitle, finalBody, data);
  } catch (error) {
    console.error("❌ [NOTIFICATION] sendGenerationCompletedNotification hatası:", error);
    // Hata durumunda İngilizce fallback kullan
    const title = "🎉 Your process is complete!";
    const body = "Your model photo is ready. You can view the results.";
    const data = {
      type: "generation_completed",
      generationId: generationId,
    };
    return await sendPushNotification(userId, title, body, data);
  }
}

module.exports = {
  sendPushNotification,
  sendGenerationCompletedNotification,
};

