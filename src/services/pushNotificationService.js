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

/* ------------------------------------------------------------------ */
/* Generation completed → OneSignal (yalnız uygulama arka plandayken görünür) */
/* ------------------------------------------------------------------ */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENERATION_PUSH_TYPE = "generation_completed";

// 70 dilin tamamı: OneSignal, headings/contents içindeki dil haritasından
// aboneliğin diline uyanı seçer, yoksa "en"e düşer. Böylece sunucu tarafında
// dil tespiti gerekmez; kullanıcı dilini değiştirse bile doğru metin gider.
let generationPushTexts = null;
function loadGenerationPushTexts() {
  if (generationPushTexts) return generationPushTexts;
  const headings = {};
  const contents = {};
  try {
    for (const file of fs.readdirSync(localesPath)) {
      if (!file.endsWith(".json")) continue;
      const lang = file.slice(0, -5);
      if (lang === "web") continue;
      try {
        const n = JSON.parse(fs.readFileSync(path.join(localesPath, file), "utf8"))?.notification;
        if (n?.generationCompletedTitle && n?.generationCompletedBody) {
          headings[lang] = n.generationCompletedTitle;
          contents[lang] = n.generationCompletedBody;
        }
      } catch (_) {}
    }
  } catch (error) {
    console.error("❌ [NOTIFICATION] Generation push metinleri yüklenemedi:", error);
  }
  if (!headings.en) headings.en = "Your generation is ready!";
  if (!contents.en) contents.en = "Your model photo is ready. Tap to see the results.";
  generationPushTexts = { headings, contents };
  return generationPushTexts;
}

/**
 * Kampanya push'uyla (acquisitionPush.localizedCampaign) aynı dil kuralı:
 * "tr-TR" / "pt_BR" → "tr" / "pt"; metni olmayan dil için null.
 */
function localizedGenerationText(language) {
  const lang = String(language || "").toLowerCase().replace("_", "-").split("-")[0];
  const { headings, contents } = loadGenerationPushTexts();
  if (!lang || !headings[lang] || !contents[lang]) return null;
  return { language: lang, title: headings[lang], body: contents[lang] };
}

/**
 * Kullanıcının uygulama dili. Öncelik, en taze kaynaktan en bayata:
 * 1. OneSignal kullanıcı profili `properties.language` — istemci her sync'te
 *    (AppState değişimi, 30 sn, dil değişimi) i18n dilini OneSignal.User.setLanguage
 *    ile yazar; Pro/Free fark etmez, 70 dilin hepsi olduğu gibi gider.
 * 2. users.preferred_language — save-device-token ile güncellenir ama 11 dile
 *    normalize edilir (desteklenmeyen dil → "en").
 * 3. acquisition_push_enrollments.language — yalnız kampanya kimliği geçerli
 *    (yeni, satın almamış) kullanıcılarda güncellenir; Pro'da bayatlar.
 */
async function resolveUserLanguage({ db, fetchImpl, appId, apiKey }, userId) {
  try {
    const response = await fetchImpl(`https://api.onesignal.com/apps/${appId}/users/by/external_id/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Key ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    const profile = response.ok ? await response.json().catch(() => null) : null;
    if (profile?.properties?.language) return { language: profile.properties.language, from: "onesignal" };
  } catch (_) {}
  try {
    const { data } = await db.from("users").select("preferred_language").eq("id", userId).maybeSingle();
    if (data?.preferred_language) return { language: data.preferred_language, from: "users" };
  } catch (_) {}
  try {
    const { data } = await db.from("acquisition_push_enrollments").select("language").eq("user_id", userId).maybeSingle();
    if (data?.language) return { language: data.language, from: "enrollment" };
  } catch (_) {}
  return { language: null, from: "none" };
}

/**
 * OneSignal'e gidecek generation-completed payload'ı.
 * Hedef: kullanıcının external_id'si (OneSignal.login(userId) ile eşleşir),
 * yani kullanıcının tüm abone cihazları.
 */
function buildGenerationCompletedPush(appId, userId, generationId, options = {}) {
  // Dil sunucuda seçilir (kampanya push'uyla aynı mantık); OneSignal'in kendi
  // dil eşlemesine bırakılmaz. Metin bulunamazsa İngilizce'ye düşülür —
  // sonuç bildirimi kampanya gibi atlanamaz, kullanıcı sonucunu bekliyor.
  const text = localizedGenerationText(options.language) || localizedGenerationText("en");
  const push = {
    app_id: appId,
    include_aliases: { external_id: [String(userId)] },
    target_channel: "push",
    headings: { en: text.title },
    contents: { en: text.body },
    // Sonuç 1 saat içinde teslim edilemezse anlamını yitirir; kullanıcı zaten uygulamada görür.
    ttl: 3600,
    ios_interruption_level: "active",
    ios_badgeType: "Increase",
    ios_badgeCount: 1,
    isIos: true,
    isAndroid: true,
    data: {
      type: GENERATION_PUSH_TYPE,
      generationId,
      source: options.source || "default",
      language: text.language,
    },
  };
  // Aynı generation için tekrar deneme olursa OneSignal ikinci kez göndermez.
  if (UUID_RE.test(String(generationId || ""))) push.idempotency_key = generationId;
  return push;
}

/**
 * Generation completed bildirimi (OneSignal).
 *
 * "Sadece arka plandayken" kuralı istemcide uygulanır: OneSignalService,
 * foregroundWillDisplay olayında type=generation_completed bildirimlerini
 * bastırır. Uygulama ön plandaysa banner çıkmaz, arka planda/kapalıysa çıkar.
 * Sunucu her durumda gönderir; ön plan/arka plan bilgisi sunucuda güvenilir
 * bilinemez (AppState kaybı, ağ gecikmesi).
 *
 * GENERATION_PUSH_ENABLED=false ile tamamen kapatılabilir.
 * @param {string} userId
 * @param {string} generationId
 * @param {{source?: string, fetchImpl?: Function, env?: object}} options
 */
async function sendGenerationCompletedNotification(userId, generationId, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const tag = `gen: ${String(generationId || "").slice(0, 8)}, source: ${options.source || "default"}`;
  if (String(env.GENERATION_PUSH_ENABLED || "true").toLowerCase() === "false") {
    console.log(`⏭️ [NOTIFICATION] Generation completed push disabled by env - skipping (${tag})`);
    return { success: true, skipped: true, reason: "disabled" };
  }
  if (!userId || userId === "anonymous_user") {
    return { success: false, skipped: true, reason: "no_user" };
  }
  const appId = env.ONESIGNAL_APP_ID;
  const apiKey = String(env.ONESIGNAL_REST_API_KEY || "").trim().replace(/^(key|basic)\s+/i, "");
  if (!appId || !apiKey) {
    console.warn(`⚠️ [NOTIFICATION] OneSignal credentials missing - skipping (${tag})`);
    return { success: false, skipped: true, reason: "credentials_missing" };
  }
  try {
    const db = options.db || supabase;
    const resolved = options.language
      ? { language: options.language, from: "option" }
      : await resolveUserLanguage({ db, fetchImpl, appId, apiKey }, userId);
    const push = buildGenerationCompletedPush(appId, userId, generationId, { ...options, language: resolved.language });
    console.log(`🌐 [NOTIFICATION] Generation push dili: ${push.data.language} (${resolved.from}: ${resolved.language || "-"}) (${tag})`);
    const response = await fetchImpl("https://api.onesignal.com/notifications?c=push", {
      method: "POST",
      headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(push),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.errors) {
      const detail = Array.isArray(data.errors) ? data.errors.join("; ") : JSON.stringify(data.errors || "");
      // "All included players are not subscribed" vb. → kullanıcının abone cihazı yok; hata değil.
      const noRecipients = /not subscribed|no recipients|no subscribed/i.test(detail);
      if (noRecipients) {
        console.log(`⏭️ [NOTIFICATION] Generation push: abone cihaz yok (${tag})`);
        return { success: true, skipped: true, reason: "no_subscribed_devices" };
      }
      throw new Error(`OneSignal HTTP ${response.status} ${detail}`.trim());
    }
    console.log(`✅ [NOTIFICATION] Generation completed push gönderildi (${tag}) → ${data.id}`);
    return { success: true, id: data.id };
  } catch (error) {
    console.error(`❌ [NOTIFICATION] Generation completed push hatası (${tag}):`, error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendPushNotification,
  sendGenerationCompletedNotification,
  buildGenerationCompletedPush,
  localizedGenerationText,
  GENERATION_PUSH_TYPE,
};

