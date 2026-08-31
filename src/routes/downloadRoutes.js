const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const { createCanvas, loadImage, registerFont } = require("canvas");
const sharp = require("sharp");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

// ⚠️ Filigran fontu REPO'DAN gelir, sistemden DEĞİL.
// Railway/Linux konteynerinde Arial (ve çoğu zaman hiçbir font) kurulu değil;
// node-canvas font bulamayınca glyph yerine boş kare (tofu) çiziyordu.
// Bundle edilmiş TTF ile her ortamda aynı görünüm garanti.
const WATERMARK_FONT_FAMILY = "DiressWatermark";
try {
  registerFont(
    path.join(__dirname, "../assets/fonts/ArchivoBlack-Regular.ttf"),
    { family: WATERMARK_FONT_FAMILY }
  );
  console.log("🔤 [DOWNLOAD API] Filigran fontu yüklendi: ArchivoBlack");
} catch (fontError) {
  console.error("❌ [DOWNLOAD API] Filigran fontu yüklenemedi:", fontError.message);
}

// 🌍 Latin dışı alfabeler için Noto Sans ailesi (13 Ağu 2026): Archivo Black
// yalnız Latin glyph içerir; Kiril/Yunan/Vietnamca NotoSans'tan, Arapça/İbranice
// (Pango shaping+bidi'yi hallediyor), Japonca/Korece/Çince (subset OTF),
// Devanagari ve Tay kendi Noto dosyalarından gelir. Yüklenemeyen dosya o dilleri
// İngilizce'ye düşürür (tofu basılmaz) — loadedWatermarkFonts bunun kaydı.
const loadedWatermarkFonts = new Set();
[
  ["NotoSans-Bold.ttf", "WMNoto"],
  ["NotoSansArabic-Bold.ttf", "WMNotoAr"],
  ["NotoSansHebrew-Bold.ttf", "WMNotoHe"],
  ["NotoSansDevanagari-Bold.ttf", "WMNotoDev"],
  ["NotoSansThai-Bold.ttf", "WMNotoTh"],
  ["NotoSansJP-Bold.otf", "WMNotoJP"],
  ["NotoSansKR-Bold.otf", "WMNotoKR"],
  ["NotoSansSC-Bold.otf", "WMNotoSC"],
  ["NotoSansTC-Bold.otf", "WMNotoTC"],
  ["NotoSansEthiopic-Bold.ttf", "WMNotoEth"],
  ["NotoSansBengali-Bold.ttf", "WMNotoBn"],
  ["NotoSansGujarati-Bold.ttf", "WMNotoGu"],
  ["NotoSansArmenian-Bold.ttf", "WMNotoHy"],
  ["NotoSansGeorgian-Bold.ttf", "WMNotoKa"],
  ["NotoSansKhmer-Bold.ttf", "WMNotoKm"],
  ["NotoSansKannada-Bold.ttf", "WMNotoKn"],
  ["NotoSansLao-Bold.ttf", "WMNotoLo"],
  ["NotoSansMalayalam-Bold.ttf", "WMNotoMl"],
  ["NotoSansGurmukhi-Bold.ttf", "WMNotoPa"],
  ["NotoSansSinhala-Bold.ttf", "WMNotoSi"],
  ["NotoSansTamil-Bold.ttf", "WMNotoTa"],
  ["NotoSansTelugu-Bold.ttf", "WMNotoTe"],
].forEach(([file, family]) => {
  try {
    registerFont(path.join(__dirname, `../assets/fonts/${file}`), { family });
    loadedWatermarkFonts.add(family);
  } catch (e) {
    console.error(`❌ [DOWNLOAD API] ${file} yüklenemedi:`, e.message);
  }
});
console.log(
  `🔤 [DOWNLOAD API] ${loadedWatermarkFonts.size}/22 uluslararası filigran fontu yüklendi`,
);

// Dil → birincil font ailesi. Latin dilleri listede YOK: onlar Archivo Black ile
// basılır (marka görünümü). Latin dışı dillerde cümlenin TAMAMI Noto'dan gelir —
// Archivo önde olsaydı cümle içindeki Latin kelimeler (PRO, DMCA) çok daha kalın
// Archivo'dan, gerisi Noto'dan gelirdi ve karışım çirkin duruyor.
// az Latin yazsa da ə (schwa) Archivo'da yok → Noto'ya alındı.
const WATERMARK_FONT_BY_LANG = {
  ru: "WMNoto",
  uk: "WMNoto",
  bg: "WMNoto",
  el: "WMNoto",
  vi: "WMNoto",
  az: "WMNoto",
  ar: "WMNotoAr",
  fa: "WMNotoAr",
  he: "WMNotoHe",
  hi: "WMNotoDev",
  th: "WMNotoTh",
  ja: "WMNotoJP",
  ko: "WMNotoKR",
  zh: "WMNotoSC",
  zh_tw: "WMNotoTC",
  be: "WMNoto",
  kk: "WMNoto",
  ky: "WMNoto",
  mk: "WMNoto",
  mn: "WMNoto",
  sr: "WMNoto",
  mr: "WMNotoDev",
  ne: "WMNotoDev",
  ur: "WMNotoAr",
  am: "WMNotoEth",
  bn: "WMNotoBn",
  gu: "WMNotoGu",
  hy: "WMNotoHy",
  ka: "WMNotoKa",
  km: "WMNotoKm",
  kn: "WMNotoKn",
  lo: "WMNotoLo",
  ml: "WMNotoMl",
  pa: "WMNotoPa",
  si: "WMNotoSi",
  ta: "WMNotoTa",
  te: "WMNotoTe",
};

// Dilin ctx.font'ta kullanılacak aile zinciri (per-glyph fallback Pango'da var)
function watermarkFontStackFor(lang) {
  const primary = WATERMARK_FONT_BY_LANG[lang];
  if (primary && loadedWatermarkFonts.has(primary)) {
    return `"${primary}", "${WATERMARK_FONT_FAMILY}"`;
  }
  return loadedWatermarkFonts.has("WMNoto")
    ? `"${WATERMARK_FONT_FAMILY}", "WMNoto"`
    : `"${WATERMARK_FONT_FAMILY}"`;
}

// App ikonu bir kez yüklenip bellekte tutulur (her indirmede diskten okumaya gerek yok)
const APP_ICON_PATH = path.join(__dirname, "../assets/brand/app_icon.png");
let appIconImage = null;
loadImage(APP_ICON_PATH)
  .then((img) => {
    appIconImage = img;
    console.log("🎨 [DOWNLOAD API] App ikonu yüklendi (filigran bandı için)");
  })
  .catch((iconError) => {
    console.error("❌ [DOWNLOAD API] App ikonu yüklenemedi:", iconError.message);
  });

// Supabase istemci oluştur
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// İndirmede filigransız dosyaya yalnızca ücretli Pro kullanıcı erişebilir.
// Trial sırasında users.is_pro=true tutulduğu için is_in_trial ayrıca kontrol edilir.
async function checkUserDownloadAccess(userId) {
  try {
    if (!userId || userId === "anonymous_user") {
      return {
        isPro: false,
        isInTrial: false,
        canDownloadOriginal: false,
        preferredLanguage: null,
      };
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("is_pro, is_in_trial, preferred_language")
      .eq("id", userId)
      .single();

    if (error) {
      console.error("❌ User download access kontrol hatası:", error);
      return {
        isPro: false,
        isInTrial: false,
        canDownloadOriginal: false,
        preferredLanguage: null,
      };
    }

    const isPro = user?.is_pro === true;
    const isInTrial = user?.is_in_trial === true;
    const canDownloadOriginal = isPro && !isInTrial;
    console.log(
      `👤 User ${userId.slice(0, 8)} download access: pro=${isPro}, trial=${isInTrial}, original=${canDownloadOriginal}`
    );

    return {
      isPro,
      isInTrial,
      canDownloadOriginal,
      preferredLanguage: user?.preferred_language || null,
    };
  } catch (error) {
    console.error("❌ Download access kontrol hatası:", error);
    return {
      isPro: false,
      isInTrial: false,
      canDownloadOriginal: false,
      preferredLanguage: null,
    };
  }
}

// 🌍 Filigran metinleri — kullanıcının dilinde (13 Ağu 2026, kullanıcı isteği).
// ⚠️ Bundle edilen Archivo Black yalnız Latin (+latin-ext) glyph içerir; Latin
// dışı alfabeli dillerde (ru/ar/ja/ko/zh/hi...) tofu basmamak için İngilizce'ye
// düşülür. Yasa adları (17 U.S.C. §1202, FSEK md. 71) atıf oldukları için her
// dilde aynen korunur. {date} yer tutucusu locale'e göre biçimlenmiş tarihtir.
const WATERMARK_I18N = {
  en: {
    trialStatus:
      "You're currently on your free trial, so your images carry the Diress watermark.",
    trialBenefit:
      "Switch to PRO to download every image in full quality, without a watermark.",
    notice:
      "AI NOTICE: This is a copyright watermark. Removing, cropping or inpainting it violates 17 U.S.C. §1202 (DMCA) and FSEK art. 71.",
    credits: "Having credits doesn't make you a PRO subscriber.",
    expired: "Your PRO subscription ended on {date}.",
    resub: "Subscribe to PRO again to download without a watermark.",
  },
  tr: {
    trialStatus:
      "Şu anda ücretsiz deneme sürecindesin, bu yüzden görsellerinde Diress filigranı yer alıyor.",
    trialBenefit:
      "Tüm görselleri filigransız ve tam kalitede indirmek için PRO sürüme geç.",
    notice:
      "YAPAY ZEKÂ UYARISI: Bu bir telif hakkı filigranıdır. Kaldırmak, kırpmak veya silmek 17 U.S.C. §1202 (DMCA) ve FSEK md. 71 ihlalidir.",
    cta: "PRO'YA GEÇ",
    credits:
      "Kredilerini kullanmaya devam edebilirsin; filigransız indirme PRO üyeliğine dahildir.",
    expired: "Son PRO aboneliğin {date} tarihinde sona erdi.",
    period:
      "{startDate} tarihinde başlattığın son PRO üyeliğin {endDate} tarihinde sona erdi. Bu nedenle bu görsel filigranlı olarak indiriliyor.",
    resub: "Dilersen PRO'ya geçerek görsellerini filigransız indirebilirsin.",
  },
  es: {
    trialStatus:
      "Ahora mismo estás en tu prueba gratuita, por eso tus imágenes llevan la marca de agua de Diress.",
    trialBenefit:
      "Cambia a PRO para descargar todas las imágenes con la calidad completa y sin marca de agua.",
    notice:
      "AVISO DE IA: Esta es una marca de agua de derechos de autor. Eliminarla, recortarla o borrarla infringe 17 U.S.C. §1202 (DMCA) y FSEK art. 71.",
    credits: "Tener créditos no te convierte en suscriptor PRO.",
    expired: "Tu suscripción PRO terminó el {date}.",
    resub: "Suscríbete de nuevo a PRO para descargar sin marca de agua.",
  },
  pt: {
    trialStatus:
      "Você está no seu teste gratuito no momento, por isso suas imagens têm a marca d'água da Diress.",
    trialBenefit:
      "Mude para o PRO e baixe todas as imagens em qualidade total, sem marca d'água.",
    notice:
      "AVISO DE IA: Esta é uma marca d'água de direitos autorais. Removê-la, cortá-la ou apagá-la viola 17 U.S.C. §1202 (DMCA) e FSEK art. 71.",
    credits: "Ter créditos não faz de você um assinante PRO.",
    expired: "Sua assinatura PRO terminou em {date}.",
    resub: "Assine o PRO novamente para baixar sem marca d'água.",
  },
  de: {
    trialStatus:
      "Du befindest dich gerade in der kostenlosen Testphase, deshalb tragen deine Bilder das Diress-Wasserzeichen.",
    trialBenefit:
      "Wechsle zu PRO, um jedes Bild in voller Qualität und ohne Wasserzeichen herunterzuladen.",
    notice:
      "KI-HINWEIS: Dies ist ein Urheberrechts-Wasserzeichen. Entfernen, Zuschneiden oder Übermalen verstößt gegen 17 U.S.C. §1202 (DMCA) und FSEK Art. 71.",
    credits: "Guthaben zu haben macht dich nicht zum PRO-Abonnenten.",
    expired: "Dein PRO-Abo endete am {date}.",
    resub: "Abonniere PRO erneut, um ohne Wasserzeichen herunterzuladen.",
  },
  fr: {
    trialStatus:
      "Tu es actuellement en période d'essai gratuite, c'est pourquoi tes images portent le filigrane Diress.",
    trialBenefit:
      "Passe à PRO pour télécharger toutes tes images en pleine qualité et sans filigrane.",
    notice:
      "AVIS IA : Ceci est un filigrane de droit d'auteur. Le supprimer, le rogner ou l'effacer viole 17 U.S.C. §1202 (DMCA) et FSEK art. 71.",
    credits: "Avoir des crédits ne fait pas de vous un abonné PRO.",
    expired: "Votre abonnement PRO a pris fin le {date}.",
    resub: "Réabonnez-vous à PRO pour télécharger sans filigrane.",
  },
  it: {
    trialStatus:
      "Al momento stai usando la prova gratuita, per questo le tue immagini riportano la filigrana Diress.",
    trialBenefit:
      "Passa a PRO per scaricare ogni immagine in piena qualità e senza filigrana.",
    notice:
      "AVVISO IA: Questa è una filigrana di copyright. Rimuoverla, ritagliarla o cancellarla viola 17 U.S.C. §1202 (DMCA) e FSEK art. 71.",
    credits: "Avere crediti non ti rende un abbonato PRO.",
    expired: "Il tuo abbonamento PRO è terminato il {date}.",
    resub: "Abbonati di nuovo a PRO per scaricare senza filigrana.",
  },
  id: {
    trialStatus:
      "Kamu sedang dalam masa uji coba gratis, jadi gambarmu masih memiliki watermark Diress.",
    trialBenefit:
      "Beralihlah ke PRO untuk mengunduh semua gambar dalam kualitas penuh tanpa watermark.",
    notice:
      "PEMBERITAHUAN AI: Ini adalah watermark hak cipta. Menghapus, memotong, atau menghilangkannya melanggar 17 U.S.C. §1202 (DMCA) dan FSEK ps. 71.",
    credits: "Memiliki kredit tidak menjadikanmu pelanggan PRO.",
    expired: "Langganan PRO-mu berakhir pada {date}.",
    resub: "Berlangganan PRO lagi untuk mengunduh tanpa watermark.",
  },
  nl: {
    trialStatus:
      "Je zit nu in je gratis proefperiode, daarom dragen je afbeeldingen het Diress-watermerk.",
    trialBenefit:
      "Stap over op PRO om elke afbeelding in volledige kwaliteit en zonder watermerk te downloaden.",
    notice:
      "AI-KENNISGEVING: Dit is een auteursrechtwatermerk. Verwijderen, bijsnijden of wegwerken schendt 17 U.S.C. §1202 (DMCA) en FSEK art. 71.",
    credits: "Credits hebben maakt je geen PRO-abonnee.",
    expired: "Je PRO-abonnement eindigde op {date}.",
    resub: "Abonneer je opnieuw op PRO om zonder watermerk te downloaden.",
  },
  pl: {
    trialStatus:
      "Korzystasz teraz z bezpłatnego okresu próbnego, dlatego Twoje obrazy mają znak wodny Diress.",
    trialBenefit:
      "Przejdź na PRO, aby pobierać każdy obraz w pełnej jakości i bez znaku wodnego.",
    notice:
      "INFORMACJA AI: To jest znak wodny praw autorskich. Usuwanie, przycinanie lub zamalowywanie narusza 17 U.S.C. §1202 (DMCA) i FSEK art. 71.",
    credits: "Posiadanie kredytów nie czyni cię subskrybentem PRO.",
    expired: "Twoja subskrypcja PRO wygasła {date}.",
    resub: "Subskrybuj PRO ponownie, aby pobierać bez znaku wodnego.",
  },
  ro: {
    trialStatus:
      "Momentan ești în perioada de probă gratuită, de aceea imaginile tale poartă marcajul Diress.",
    trialBenefit:
      "Treci la PRO ca să descarci fiecare imagine la calitate maximă, fără marcaj de apă.",
    notice:
      "NOTIFICARE AI: Acesta este un filigran de drepturi de autor. Îndepărtarea, decuparea sau ștergerea lui încalcă 17 U.S.C. §1202 (DMCA) și FSEK art. 71.",
    credits: "Faptul că ai credite nu te face abonat PRO.",
    expired: "Abonamentul tău PRO s-a încheiat pe {date}.",
    resub: "Abonează-te din nou la PRO pentru a descărca fără filigran.",
  },
  cs: {
    trialStatus:
      "Právě máš bezplatnou zkušební verzi, a proto tvé obrázky nesou vodoznak Diress.",
    trialBenefit:
      "Přejdi na PRO a stahuj každý obrázek v plné kvalitě a bez vodoznaku.",
    notice:
      "UPOZORNĚNÍ AI: Toto je autorskoprávní vodoznak. Jeho odstranění, oříznutí nebo zamalování porušuje 17 U.S.C. §1202 (DMCA) a FSEK čl. 71.",
    credits: "Mít kredity z tebe nedělá předplatitele PRO.",
    expired: "Tvé předplatné PRO skončilo {date}.",
    resub: "Předplať si PRO znovu a stahuj bez vodoznaku.",
  },
  hu: {
    trialStatus:
      "Jelenleg az ingyenes próbaidőszakot használod, ezért a képeiden a Diress vízjele látható.",
    trialBenefit:
      "Válts PRO verzióra, hogy minden képet teljes minőségben, vízjel nélkül tölthess le.",
    notice:
      "AI ÉRTESÍTÉS: Ez egy szerzői jogi vízjel. Eltávolítása, levágása vagy kiretusálása sérti a 17 U.S.C. §1202 (DMCA) és az FSEK 71. cikkét.",
    credits: "A kreditek birtoklása nem tesz PRO előfizetővé.",
    expired: "A PRO előfizetésed {date} napján lejárt.",
    resub: "Fizess elő újra a PRO-ra, hogy vízjel nélkül tölthess le.",
  },
  sv: {
    trialStatus:
      "Du är just nu på din kostnadsfria provperiod, därför har dina bilder Diress-vattenstämpeln.",
    trialBenefit:
      "Byt till PRO för att ladda ner alla bilder i full kvalitet och utan vattenstämpel.",
    notice:
      "AI-MEDDELANDE: Detta är en upphovsrättsvattenstämpel. Att ta bort, beskära eller sudda den bryter mot 17 U.S.C. §1202 (DMCA) och FSEK art. 71.",
    credits: "Att ha krediter gör dig inte till PRO-prenumerant.",
    expired: "Din PRO-prenumeration upphörde den {date}.",
    resub: "Prenumerera på PRO igen för att ladda ner utan vattenstämpel.",
  },
  da: {
    trialStatus:
      "Du er i gang med din gratis prøveperiode, så dine billeder har Diress-vandmærket.",
    trialBenefit:
      "Skift til PRO for at downloade alle billeder i fuld kvalitet og uden vandmærke.",
    notice:
      "AI-MEDDELELSE: Dette er et ophavsretligt vandmærke. Fjernelse, beskæring eller udviskning overtræder 17 U.S.C. §1202 (DMCA) og FSEK art. 71.",
    credits: "At have kreditter gør dig ikke til PRO-abonnent.",
    expired: "Dit PRO-abonnement udløb den {date}.",
    resub: "Abonnér på PRO igen for at downloade uden vandmærke.",
  },
  no: {
    trialStatus:
      "Du er akkurat nå på den gratis prøveperioden, derfor har bildene dine Diress-vannmerket.",
    trialBenefit:
      "Bytt til PRO for å laste ned alle bilder i full kvalitet og uten vannmerke.",
    notice:
      "AI-VARSEL: Dette er et opphavsrettsvannmerke. Å fjerne, beskjære eller viske det ut bryter 17 U.S.C. §1202 (DMCA) og FSEK art. 71.",
    credits: "Å ha kreditter gjør deg ikke til PRO-abonnent.",
    expired: "PRO-abonnementet ditt utløp {date}.",
    resub: "Abonner på PRO igjen for å laste ned uten vannmerke.",
  },
  fi: {
    trialStatus:
      "Olet parhaillaan ilmaisella kokeilujaksolla, joten kuvissasi näkyy Diress-vesileima.",
    trialBenefit:
      "Siirry PRO-versioon, niin lataat jokaisen kuvan täydellä laadulla ilman vesileimaa.",
    notice:
      "TEKOÄLYILMOITUS: Tämä on tekijänoikeusvesileima. Sen poistaminen, rajaaminen tai häivyttäminen rikkoo 17 U.S.C. §1202 (DMCA) ja FSEK art. 71 vastaan.",
    credits: "Krediittien omistaminen ei tee sinusta PRO-tilaajaa.",
    expired: "PRO-tilauksesi päättyi {date}.",
    resub: "Tilaa PRO uudelleen ladataksesi ilman vesileimaa.",
  },
  az: {
    trialStatus:
      "Hazırda pulsuz sınaq müddətindəsən, ona görə də şəkillərində Diress su nişanı var.",
    trialBenefit:
      "Bütün şəkilləri su nişanı olmadan tam keyfiyyətdə yükləmək üçün PRO versiyaya keç.",
    notice:
      "Sİ BİLDİRİŞİ: Bu, müəllif hüququ filiqranıdır. Onu silmək, kəsmək və ya örtmək 17 U.S.C. §1202 (DMCA) və FSEK m. 71-i pozur.",
    credits: "Kreditlərin olması səni PRO abunəçisi etmir.",
    expired: "PRO abunəliyin {date} tarixində bitdi.",
    resub: "Filiqransız yükləmək üçün yenidən PRO-ya abunə ol.",
  },
  ru: {
    trialStatus:
      "Сейчас у вас бесплатный пробный период, поэтому на изображениях есть водяной знак Diress.",
    trialBenefit:
      "Перейдите на PRO, чтобы скачивать каждое изображение в полном качестве и без водяного знака.",
    notice:
      "УВЕДОМЛЕНИЕ ИИ: Это водяной знак авторского права. Его удаление, обрезка или закрашивание нарушает 17 U.S.C. §1202 (DMCA) и FSEK ст. 71.",
    credits: "Наличие кредитов не делает вас подписчиком PRO.",
    expired: "Ваша подписка PRO закончилась {date}.",
    resub: "Оформите подписку PRO снова, чтобы скачивать без водяного знака.",
  },
  uk: {
    trialStatus:
      "Зараз у тебе безкоштовний пробний період, тому на твоїх зображеннях є водяний знак Diress.",
    trialBenefit:
      "Перейди на PRO, щоб завантажувати кожне зображення в повній якості та без водяного знака.",
    notice:
      "ПОВІДОМЛЕННЯ ШІ: Це водяний знак авторського права. Його видалення, обрізання або замальовування порушує 17 U.S.C. §1202 (DMCA) та FSEK ст. 71.",
    credits: "Наявність кредитів не робить вас підписником PRO.",
    expired: "Ваша підписка PRO закінчилася {date}.",
    resub: "Оформіть підписку PRO знову, щоб завантажувати без водяного знака.",
  },
  bg: {
    trialStatus:
      "В момента си в безплатния пробен период, затова изображенията ти носят водния знак на Diress.",
    trialBenefit:
      "Премини към PRO, за да изтегляш всяко изображение в пълно качество и без воден знак.",
    notice:
      "ИЗВЕСТИЕ ЗА ИИ: Това е воден знак за авторски права. Премахването, изрязването или заличаването му нарушава 17 U.S.C. §1202 (DMCA) и FSEK чл. 71.",
    credits: "Наличието на кредити не те прави PRO абонат.",
    expired: "Твоят PRO абонамент изтече на {date}.",
    resub: "Абонирай се отново за PRO, за да изтегляш без воден знак.",
  },
  el: {
    trialStatus:
      "Αυτή τη στιγμή βρίσκεσαι στη δωρεάν δοκιμή, γι' αυτό οι εικόνες σου φέρουν το υδατογράφημα Diress.",
    trialBenefit:
      "Πέρασε στο PRO για να κατεβάζεις κάθε εικόνα σε πλήρη ποιότητα, χωρίς υδατογράφημα.",
    notice:
      "ΕΙΔΟΠΟΙΗΣΗ AI: Αυτό είναι υδατογράφημα πνευματικών δικαιωμάτων. Η αφαίρεση, περικοπή ή το σβήσιμό του παραβιάζει το 17 U.S.C. §1202 (DMCA) και το FSEK άρθ. 71.",
    credits: "Το να έχεις credits δεν σε κάνει συνδρομητή PRO.",
    expired: "Η συνδρομή σου PRO έληξε στις {date}.",
    resub: "Κάνε ξανά συνδρομή PRO για λήψη χωρίς υδατογράφημα.",
  },
  vi: {
    trialStatus:
      "Bạn đang trong thời gian dùng thử miễn phí, vì vậy ảnh của bạn có hình mờ Diress.",
    trialBenefit:
      "Chuyển sang PRO để tải mọi ảnh với chất lượng đầy đủ và không có hình mờ.",
    notice:
      "THÔNG BÁO AI: Đây là hình mờ bản quyền. Việc xóa, cắt hoặc tẩy nó vi phạm 17 U.S.C. §1202 (DMCA) và FSEK điều 71.",
    credits: "Có credit không có nghĩa bạn là người đăng ký PRO.",
    expired: "Gói PRO của bạn đã kết thúc vào {date}.",
    resub: "Đăng ký PRO lần nữa để tải xuống không có hình mờ.",
  },
  ar: {
    trialStatus:
      "أنت الآن في الفترة التجريبية المجانية، لذلك تحمل صورك علامة Diress المائية.",
    trialBenefit:
      "انتقل إلى PRO لتنزيل كل صورة بجودة كاملة وبدون علامة مائية.",
    notice:
      "تنبيه الذكاء الاصطناعي: هذه علامة مائية لحقوق النشر. إزالتها أو قصها أو طمسها يخالف 17 U.S.C. §1202 (DMCA) و FSEK م. 71.",
    credits: "امتلاك الرصيد لا يجعلك مشتركًا في PRO.",
    expired: "انتهى اشتراكك في PRO بتاريخ {date}.",
    resub: "اشترك في PRO مجددًا للتنزيل بدون علامة مائية.",
  },
  fa: {
    trialStatus:
      "شما در حال حاضر در دوره آزمایشی رایگان هستید، به همین دلیل تصاویرتان واترمارک Diress دارند.",
    trialBenefit:
      "برای دانلود همه تصاویر با کیفیت کامل و بدون واترمارک، به نسخه PRO بروید.",
    notice:
      "اعلان هوش مصنوعی: این یک واترمارک حق نشر است. حذف، برش یا پاک کردن آن نقض 17 U.S.C. §1202 (DMCA) و FSEK ماده ۷۱ است.",
    credits: "داشتن اعتبار به معنای اشتراک PRO نیست.",
    expired: "اشتراک PRO شما در {date} به پایان رسید.",
    resub: "برای دانلود بدون واترمارک دوباره مشترک PRO شوید.",
  },
  he: {
    trialStatus:
      "אתה נמצא כרגע בתקופת הניסיון החינמית, ולכן התמונות שלך נושאות את סימן המים של Diress.",
    trialBenefit:
      "עבור ל‑PRO כדי להוריד כל תמונה באיכות מלאה וללא סימן מים.",
    notice:
      "הודעת AI: זהו סימן מים של זכויות יוצרים. הסרתו, חיתוכו או מחיקתו מפרים את 17 U.S.C. §1202 (DMCA) ואת FSEK סע' 71.",
    credits: "קרדיטים אינם הופכים אותך למנוי PRO.",
    expired: "מנוי ה-PRO שלך הסתיים בתאריך {date}.",
    resub: "הירשם שוב ל-PRO כדי להוריד ללא סימן מים.",
  },
  hi: {
    trialStatus:
      "आप अभी फ्री ट्रायल पर हैं, इसलिए आपकी तस्वीरों पर Diress वॉटरमार्क रहता है।",
    trialBenefit:
      "हर तस्वीर को बिना वॉटरमार्क के पूरी क्वालिटी में डाउनलोड करने के लिए PRO पर जाएं।",
    notice:
      "एआई सूचना: यह एक कॉपीराइट वॉटरमार्क है। इसे हटाना, काटना या मिटाना 17 U.S.C. §1202 (DMCA) और FSEK अनु. 71 का उल्लंघन है।",
    credits: "क्रेडिट होने से आप PRO सब्सक्राइबर नहीं बन जाते।",
    expired: "आपकी PRO सदस्यता {date} को समाप्त हो गई।",
    resub: "वॉटरमार्क के बिना डाउनलोड करने के लिए फिर से PRO सब्सक्राइब करें।",
  },
  th: {
    trialStatus:
      "ตอนนี้คุณอยู่ในช่วงทดลองใช้ฟรี ภาพของคุณจึงมีลายน้ำ Diress",
    trialBenefit:
      "เปลี่ยนเป็น PRO เพื่อดาวน์โหลดทุกภาพในคุณภาพเต็มโดยไม่มีลายน้ำ",
    notice:
      "ประกาศ AI: นี่คือลายน้ำลิขสิทธิ์ การลบ ตัด หรือลบเลือนถือเป็นการละเมิด 17 U.S.C. §1202 (DMCA) และ FSEK มาตรา 71",
    credits: "การมีเครดิตไม่ได้ทำให้คุณเป็นสมาชิก PRO",
    expired: "การสมัคร PRO ของคุณสิ้นสุดเมื่อ {date}",
    resub: "สมัคร PRO อีกครั้งเพื่อดาวน์โหลดแบบไม่มีลายน้ำ",
  },
  ja: {
    trialStatus:
      "現在は無料トライアル中のため、画像にDiressのウォーターマークが入ります。",
    trialBenefit:
      "すべての画像をウォーターマークなしのフル画質でダウンロードするには、PROに切り替えてください。",
    notice:
      "AI通知: これは著作権の透かしです。削除・切り抜き・塗りつぶしは 17 U.S.C. §1202 (DMCA) および FSEK 第71条に違反します。",
    credits: "クレジットがあってもPRO会員にはなりません。",
    expired: "PROの購読は{date}に終了しました。",
    resub: "透かしなしでダウンロードするには、再度PROにご登録ください。",
  },
  ko: {
    trialStatus:
      "지금은 무료 체험 기간이라 이미지에 Diress 워터마크가 표시됩니다.",
    trialBenefit:
      "모든 이미지를 워터마크 없이 최상의 화질로 저장하려면 PRO로 전환하세요.",
    notice:
      "AI 알림: 이것은 저작권 워터마크입니다. 제거, 자르기 또는 지우기는 17 U.S.C. §1202 (DMCA) 및 FSEK 제71조 위반입니다.",
    credits: "크레딧이 있다고 PRO 구독자가 되는 것은 아닙니다.",
    expired: "PRO 구독이 {date}에 종료되었습니다.",
    resub: "워터마크 없이 다운로드하려면 PRO를 다시 구독하세요.",
  },
  zh: {
    trialStatus:
      "您目前正在免费试用期，因此图片上会带有 Diress 水印。",
    trialBenefit:
      "升级到 PRO，即可以完整画质下载每一张无水印图片。",
    notice:
      "AI提示：这是版权水印。移除、裁剪或涂抹将违反 17 U.S.C. §1202 (DMCA) 及 FSEK 第71条。",
    credits: "拥有点数并不代表您是PRO订阅者。",
    expired: "您的PRO订阅已于{date}到期。",
    resub: "再次订阅PRO即可无水印下载。",
  },
  zh_tw: {
    trialStatus:
      "您目前正在免費試用期，因此圖片上會帶有 Diress 浮水印。",
    trialBenefit:
      "升級到 PRO，即可以完整畫質下載每一張無浮水印圖片。",
    notice:
      "AI提示：這是版權浮水印。移除、裁切或塗抹將違反 17 U.S.C. §1202 (DMCA) 及 FSEK 第71條。",
    credits: "擁有點數並不代表您是PRO訂閱者。",
    expired: "您的PRO訂閱已於{date}到期。",
    resub: "再次訂閱PRO即可無浮水印下載。",
  },
  af: { trialStatus: "Jy is tans op jou gratis proeftydperk, daarom dra jou beelde die Diress-watermerk.", trialBenefit: "Skakel oor na PRO om elke beeld in volle gehalte af te laai, sonder 'n watermerk.", notice: "KI-KENNISGEWING: Hierdie is 'n kopiereg-watermerk. Om dit te verwyder, te sny of uit te vee, oortree 17 U.S.C. §1202 (DMCA) en FSEK art. 71.", credits: "Om krediete te hê maak jou nie 'n PRO-intekenaar nie.", expired: "Jou PRO-intekening het op {date} geëindig.", resub: "Teken weer op PRO in om sonder watermerk af te laai." },
  am: { trialStatus: "አሁን በነጻ የሙከራ ጊዜ ላይ ስለሆንክ ምስሎችህ የDiress ውሃ ምልክት ይይዛሉ።", trialBenefit: "እያንዳንዱን ምስል ያለ ውሃ ምልክት በሙሉ ጥራት ለማውረድ ወደ PRO ቀይር።", notice: "የAI ማስታወቂያ፡ ይህ የቅጂ መብት የውሃ ምልክት ነው። እሱን ማስወገድ፣ መቁረጥ ወይም መደምሰስ 17 U.S.C. §1202 (DMCA) እና FSEK አንቀጽ 71ን ይጥሳል።", credits: "ክሬዲት መኖሩ የPRO ደንበኛ አያደርግዎትም።", expired: "የPRO ምዝገባዎ በ{date} አብቅቷል።", resub: "ያለ የውሃ ምልክት ለማውረድ እንደገና ለPRO ይመዝገቡ።" },
  be: { trialStatus: "Зараз у вас бясплатны пробны перыяд, таму на вашых выявах ёсць вадзяны знак Diress.", trialBenefit: "Перайдзіце на PRO, каб спампоўваць кожную выяву ў поўнай якасці і без вадзянога знака.", notice: "ПАВЕДАМЛЕННЕ ШІ: Гэта вадзяны знак аўтарскага права. Яго выдаленне, абразанне або замалёўванне парушае 17 U.S.C. §1202 (DMCA) і FSEK арт. 71.", credits: "Наяўнасць крэдытаў не робіць вас падпісчыкам PRO.", expired: "Ваша падпіска PRO скончылася {date}.", resub: "Аформіце падпіску PRO зноў, каб спампоўваць без вадзянога знака." },
  bn: { trialStatus: "আপনি এখন ফ্রি ট্রায়ালে আছেন, তাই আপনার ছবিগুলোতে Diress ওয়াটারমার্ক থাকে।", trialBenefit: "প্রতিটি ছবি ওয়াটারমার্ক ছাড়া পূর্ণ মানে ডাউনলোড করতে PRO-তে যান।", notice: "এআই বিজ্ঞপ্তি: এটি একটি কপিরাইট জলছাপ। এটি সরানো, কাটা বা মুছে ফেলা 17 U.S.C. §1202 (DMCA) এবং FSEK ধারা 71 লঙ্ঘন করে।", credits: "ক্রেডিট থাকলেই আপনি PRO গ্রাহক হন না।", expired: "আপনার PRO সাবস্ক্রিপশন {date} তারিখে শেষ হয়েছে।", resub: "জলছাপ ছাড়া ডাউনলোড করতে আবার PRO সাবস্ক্রাইব করুন।" },
  ca: { trialStatus: "Ara mateix estàs en la prova gratuïta, per això les teves imatges porten la marca d'aigua de Diress.", trialBenefit: "Passa a PRO per descarregar totes les imatges amb la qualitat completa i sense marca d'aigua.", notice: "AVÍS D'IA: Aquesta és una marca d'aigua de drets d'autor. Eliminar-la, retallar-la o esborrar-la infringeix 17 U.S.C. §1202 (DMCA) i FSEK art. 71.", credits: "Tenir crèdits no et converteix en subscriptor PRO.", expired: "La teva subscripció PRO va acabar el {date}.", resub: "Subscriu-te de nou a PRO per descarregar sense marca d'aigua." },
  et: { trialStatus: "Sul on praegu tasuta prooviperiood, seetõttu kannavad su pildid Diressi vesimärki.", trialBenefit: "Mine üle PRO-le, et laadida iga pilt alla täiskvaliteedis ja ilma vesimärgita.", notice: "AI TEADE: See on autoriõiguse vesimärk. Selle eemaldamine, kärpimine või kustutamine rikub 17 U.S.C. §1202 (DMCA) ja FSEK art. 71.", credits: "Krediitide omamine ei tee sinust PRO tellijat.", expired: "Sinu PRO tellimus lõppes {date}.", resub: "Telli PRO uuesti, et alla laadida ilma vesimärgita." },
  eu: { trialStatus: "Une honetan doako probaldian zaude, eta horregatik dute zure irudiek Diress ur-marka.", trialBenefit: "Pasatu PRO bertsiora irudi guztiak kalitate osoan eta ur-markarik gabe deskargatzeko.", notice: "AA OHARRA: Hau copyright ur-marka bat da. Kentzea, moztea edo ezabatzea 17 U.S.C. §1202 (DMCA) eta FSEK 71. art. urratzen ditu.", credits: "Kredituak izateak ez zaitu PRO harpidedun bihurtzen.", expired: "Zure PRO harpidetza {date} amaitu zen.", resub: "Harpidetu berriro PROra ur-markarik gabe deskargatzeko." },
  fil: { trialStatus: "Nasa libreng trial ka pa ngayon, kaya may Diress watermark ang iyong mga larawan.", trialBenefit: "Lumipat sa PRO para ma-download ang bawat larawan sa buong kalidad, nang walang watermark.", notice: "ABISO NG AI: Ito ay isang copyright watermark. Ang pag-aalis, pag-crop o pagbura nito ay lumalabag sa 17 U.S.C. §1202 (DMCA) at FSEK art. 71.", credits: "Ang pagkakaroon ng credits ay hindi ka ginagawang PRO subscriber.", expired: "Natapos ang iyong PRO subscription noong {date}.", resub: "Mag-subscribe muli sa PRO para mag-download nang walang watermark." },
  gl: { trialStatus: "Agora mesmo estás na proba gratuíta, por iso as túas imaxes levan a marca de auga de Diress.", trialBenefit: "Cambia a PRO para descargar todas as imaxes coa calidade completa e sen marca de auga.", notice: "AVISO DE IA: Esta é unha marca de auga de dereitos de autor. Eliminala, recortala ou borrala infrinxe 17 U.S.C. §1202 (DMCA) e FSEK art. 71.", credits: "Ter créditos non te converte en subscritor PRO.", expired: "A túa subscrición PRO rematou o {date}.", resub: "Subscríbete de novo a PRO para descargar sen marca de auga." },
  gu: { trialStatus: "તમે અત્યારે મફત ટ્રાયલમાં છો, તેથી તમારી છબીઓ પર Diress વોટરમાર્ક હોય છે.", trialBenefit: "દરેક છબી વોટરમાર્ક વિના પૂરી ગુણવત્તામાં ડાઉનલોડ કરવા માટે PRO પર જાઓ.", notice: "AI સૂચના: આ કૉપિરાઇટ વૉટરમાર્ક છે. તેને દૂર કરવું, કાપવું કે ભૂંસવું 17 U.S.C. §1202 (DMCA) અને FSEK કલમ 71નું ઉલ્લંઘન છે.", credits: "ક્રેડિટ હોવાથી તમે PRO સબ્સ્ક્રાઇબર બનતા નથી.", expired: "તમારું PRO સબ્સ્ક્રિપ્શન {date}ના રોજ સમાપ્ત થયું.", resub: "વૉટરમાર્ક વિના ડાઉનલોડ કરવા ફરીથી PRO સબ્સ્ક્રાઇબ કરો." },
  hr: { trialStatus: "Trenutačno koristiš besplatno probno razdoblje, zato tvoje slike nose Diress vodeni žig.", trialBenefit: "Prijeđi na PRO kako bi preuzeo svaku sliku u punoj kvaliteti i bez vodenog žiga.", notice: "AI OBAVIJEST: Ovo je autorski vodeni žig. Uklanjanje, izrezivanje ili brisanje krši 17 U.S.C. §1202 (DMCA) i FSEK čl. 71.", credits: "Posjedovanje kredita ne čini te PRO pretplatnikom.", expired: "Tvoja PRO pretplata istekla je {date}.", resub: "Pretplati se ponovno na PRO za preuzimanje bez vodenog žiga." },
  hy: { trialStatus: "Դու այժմ անվճար փորձաշրջանում ես, դրա համար քո պատկերները կրում են Diress-ի ջրանիշը։", trialBenefit: "Անցիր PRO-ի՝ բոլոր պատկերները լիարժեք որակով և առանց ջրանիշի ներբեռնելու համար։", notice: "AI ԾԱՆՈՒՑՈՒՄ. Սա հեղինակային իրավունքի ջրանիշ է։ Այն հեռացնելը, կտրելը կամ ջնջելը խախտում է 17 U.S.C. §1202 (DMCA) և FSEK հոդ. 71-ը։", credits: "Կրեդիտներ ունենալը քեզ PRO բաժանորդ չի դարձնում։", expired: "Քո PRO բաժանորդագրությունն ավարտվել է {date}-ին։", resub: "Կրկին բաժանորդագրվիր PRO-ին՝ առանց ջրանիշի ներբեռնելու համար։" },
  is: { trialStatus: "Þú ert núna á ókeypis prufutímabili, þess vegna bera myndirnar þínar Diress-vatnsmerkið.", trialBenefit: "Skiptu yfir í PRO til að hlaða niður öllum myndum í fullum gæðum og án vatnsmerkis.", notice: "AI TILKYNNING: Þetta er höfundarréttarvatnsmerki. Að fjarlægja, skera eða má það út brýtur gegn 17 U.S.C. §1202 (DMCA) og FSEK gr. 71.", credits: "Að eiga inneign gerir þig ekki að PRO áskrifanda.", expired: "PRO áskriftin þín rann út {date}.", resub: "Gerstu aftur PRO áskrifandi til að hlaða niður án vatnsmerkis." },
  ka: { trialStatus: "ამჟამად უფასო საცდელ პერიოდზე ხარ, ამიტომ შენს სურათებზე Diress-ის წყლის ნიშანია.", trialBenefit: "გადადი PRO-ზე, რომ ყველა სურათი სრული ხარისხით და წყლის ნიშნის გარეშე ჩამოტვირთო.", notice: "AI შეტყობინება: ეს არის საავტორო უფლების ჭვირნიშანი. მისი წაშლა, მოჭრა ან გადაფარვა არღვევს 17 U.S.C. §1202 (DMCA)-სა და FSEK მუხ. 71-ს.", credits: "კრედიტების ქონა არ გხდის PRO გამომწერად.", expired: "შენი PRO გამოწერა დასრულდა {date}.", resub: "კვლავ გამოიწერე PRO, რომ ჩამოტვირთო ჭვირნიშნის გარეშე." },
  kk: { trialStatus: "Сіз қазір тегін сынақ кезеңіндесіз, сондықтан суреттеріңізде Diress су таңбасы бар.", trialBenefit: "Барлық суретті су таңбасыз әрі толық сапада жүктеу үшін PRO нұсқасына ауысыңыз.", notice: "ЖИ ХАБАРЛАМАСЫ: Бұл авторлық құқық су белгісі. Оны жою, қию немесе өшіру 17 U.S.C. §1202 (DMCA) және FSEK 71-бабын бұзады.", credits: "Кредиттің болуы сізді PRO жазылушысы етпейді.", expired: "PRO жазылымыңыз {date} аяқталды.", resub: "Су белгісіз жүктеу үшін PRO-ға қайта жазылыңыз." },
  km: { trialStatus: "អ្នកកំពុងស្ថិតក្នុងការសាកល្បងឥតគិតថ្លៃ ដូច្នេះរូបភាពរបស់អ្នកមានឡាយសញ្ញាទឹក Diress។", trialBenefit: "ប្ដូរទៅ PRO ដើម្បីទាញយករូបភាពទាំងអស់ក្នុងគុណភាពពេញលេញ ដោយគ្មានឡាយសញ្ញាទឹក។", notice: "សេចក្ដីជូនដំណឹង AI៖ នេះជាសញ្ញាទឹករក្សាសិទ្ធិ។ ការលុប កាត់ ឬបំបាត់វា ល្មើសនឹង 17 U.S.C. §1202 (DMCA) និង FSEK មាត្រា 71។", credits: "ការមានក្រេឌីតមិនធ្វើឱ្យអ្នកក្លាយជាអតិថិជន PRO ទេ។", expired: "ការជាវ PRO របស់អ្នកបានបញ្ចប់នៅ {date}។", resub: "ជាវ PRO ម្ដងទៀត ដើម្បីទាញយកដោយគ្មានសញ្ញាទឹក។" },
  kn: { trialStatus: "ನೀವು ಈಗ ಉಚಿತ ಟ್ರಯಲ್‌ನಲ್ಲಿದ್ದೀರಿ, ಆದ್ದರಿಂದ ನಿಮ್ಮ ಚಿತ್ರಗಳಲ್ಲಿ Diress ವಾಟರ್‌ಮಾರ್ಕ್ ಇರುತ್ತದೆ.", trialBenefit: "ಪ್ರತಿ ಚಿತ್ರವನ್ನೂ ವಾಟರ್‌ಮಾರ್ಕ್ ಇಲ್ಲದೆ ಪೂರ್ಣ ಗುಣಮಟ್ಟದಲ್ಲಿ ಡೌನ್‌ಲೋಡ್ ಮಾಡಲು PRO ಗೆ ಬದಲಾಯಿಸಿ.", notice: "AI ಸೂಚನೆ: ಇದು ಹಕ್ಕುಸ್ವಾಮ್ಯ ವಾಟರ್‌ಮಾರ್ಕ್. ಇದನ್ನು ತೆಗೆದುಹಾಕುವುದು, ಕತ್ತರಿಸುವುದು ಅಥವಾ ಅಳಿಸುವುದು 17 U.S.C. §1202 (DMCA) ಮತ್ತು FSEK ವಿಧಿ 71ರ ಉಲ್ಲಂಘನೆ.", credits: "ಕ್ರೆಡಿಟ್ ಇದ್ದ ಮಾತ್ರಕ್ಕೆ ನೀವು PRO ಚಂದಾದಾರರಾಗುವುದಿಲ್ಲ.", expired: "ನಿಮ್ಮ PRO ಚಂದಾದಾರಿಕೆ {date}ರಂದು ಕೊನೆಗೊಂಡಿತು.", resub: "ವಾಟರ್‌ಮಾರ್ಕ್ ಇಲ್ಲದೆ ಡೌನ್‌ಲೋಡ್ ಮಾಡಲು ಮತ್ತೆ PRO ಚಂದಾದಾರರಾಗಿ." },
  ky: { trialStatus: "Сиз азыр акысыз сынак мезгилиндесиз, ошондуктан сүрөттөрүңүздө Diress суу белгиси бар.", trialBenefit: "Бардык сүрөттөрдү суу белгисиз, толук сапатта жүктөө үчүн PRO версиясына өтүңүз.", notice: "ЖИ БИЛДИРҮҮСҮ: Бул автордук укук суу белгиси. Аны өчүрүү, кесүү же жашыруу 17 U.S.C. §1202 (DMCA) жана FSEK 71-беренесин бузат.", credits: "Кредиттин болушу сизди PRO жазылуучу кылбайт.", expired: "PRO жазылууңуз {date} аяктаган.", resub: "Суу белгисиз жүктөп алуу үчүн PRO'го кайра жазылыңыз." },
  lo: { trialStatus: "ຕອນນີ້ທ່ານກຳລັງໃຊ້ການທົດລອງໃຊ້ຟຣີ ດັ່ງນັ້ນຮູບຂອງທ່ານຈຶ່ງມີລາຍນ້ຳ Diress.", trialBenefit: "ປ່ຽນເປັນ PRO ເພື່ອດາວໂຫຼດທຸກຮູບໃນຄຸນນະພາບເຕັມ ໂດຍບໍ່ມີລາຍນ້ຳ.", notice: "ແຈ້ງການ AI: ນີ້ແມ່ນລາຍນ້ຳລິຂະສິດ. ການລຶບ ຕັດ ຫຼືລົບລ້າງມັນ ລະເມີດ 17 U.S.C. §1202 (DMCA) ແລະ FSEK ມາດຕາ 71.", credits: "ການມີເຄຣດິດບໍ່ໄດ້ເຮັດໃຫ້ທ່ານເປັນສະມາຊິກ PRO.", expired: "ການສະໝັກ PRO ຂອງທ່ານສິ້ນສຸດເມື່ອ {date}.", resub: "ສະໝັກ PRO ອີກຄັ້ງເພື່ອດາວໂຫຼດໂດຍບໍ່ມີລາຍນ້ຳ." },
  lt: { trialStatus: "Šiuo metu naudojiesi nemokamu bandomuoju laikotarpiu, todėl tavo vaizduose matomas Diress vandens ženklas.", trialBenefit: "Pereik prie PRO, kad kiekvieną vaizdą atsisiųstum visa kokybe ir be vandens ženklo.", notice: "DI PRANEŠIMAS: Tai autorių teisių vandens ženklas. Jo pašalinimas, apkarpymas ar užtrynimas pažeidžia 17 U.S.C. §1202 (DMCA) ir FSEK 71 str.", credits: "Kreditų turėjimas nepadaro tavęs PRO prenumeratoriumi.", expired: "Tavo PRO prenumerata baigėsi {date}.", resub: "Prenumeruok PRO iš naujo, kad atsisiųstum be vandens ženklo." },
  lv: { trialStatus: "Tu pašlaik izmanto bezmaksas izmēģinājumu, tāpēc taviem attēliem ir Diress ūdenszīme.", trialBenefit: "Pārej uz PRO, lai lejupielādētu katru attēlu pilnā kvalitātē un bez ūdenszīmes.", notice: "MI PAZIŅOJUMS: Šī ir autortiesību ūdenszīme. Tās noņemšana, apgriešana vai izdzēšana pārkāpj 17 U.S.C. §1202 (DMCA) un FSEK 71. p.", credits: "Kredītu esamība nepadara tevi par PRO abonentu.", expired: "Tavs PRO abonements beidzās {date}.", resub: "Abonē PRO vēlreiz, lai lejupielādētu bez ūdenszīmes." },
  mk: { trialStatus: "Моментално си на бесплатен пробен период, затоа твоите слики го носат воденото жигче на Diress.", trialBenefit: "Премини на PRO за да ја преземеш секоја слика во целосен квалитет и без водено жигче.", notice: "ИЗВЕСТУВАЊЕ ЗА ВИ: Ова е воден жиг за авторски права. Негово отстранување, сечење или бришење прекршува 17 U.S.C. §1202 (DMCA) и FSEK чл. 71.", credits: "Тоа што имаш кредити не те прави PRO претплатник.", expired: "Твојата PRO претплата истече на {date}.", resub: "Претплати се повторно на PRO за преземање без воден жиг." },
  ml: { trialStatus: "നിങ്ങൾ ഇപ്പോൾ സൗജന്യ ട്രയലിലാണ്, അതിനാൽ നിങ്ങളുടെ ചിത്രങ്ങളിൽ Diress വാട്ടർമാർക്ക് ഉണ്ടാകും.", trialBenefit: "എല്ലാ ചിത്രങ്ങളും വാട്ടർമാർക്കില്ലാതെ പൂർണ ഗുണനിലവാരത്തിൽ ഡൗൺലോഡ് ചെയ്യാൻ PRO-യിലേക്ക് മാറുക.", notice: "AI അറിയിപ്പ്: ഇത് ഒരു പകർപ്പവകാശ വാട്ടർമാർക്കാണ്. ഇത് നീക്കം ചെയ്യുന്നതോ മുറിക്കുന്നതോ മായ്ക്കുന്നതോ 17 U.S.C. §1202 (DMCA), FSEK വകുപ്പ് 71 എന്നിവയുടെ ലംഘനമാണ്.", credits: "ക്രെഡിറ്റ് ഉണ്ടെന്നത് നിങ്ങളെ PRO വരിക്കാരനാക്കുന്നില്ല.", expired: "നിങ്ങളുടെ PRO സബ്‌സ്‌ക്രിപ്ഷൻ {date}ന് അവസാനിച്ചു.", resub: "വാട്ടർമാർക്ക് ഇല്ലാതെ ഡൗൺലോഡ് ചെയ്യാൻ വീണ്ടും PRO സബ്‌സ്‌ക്രൈബ് ചെയ്യുക." },
  mn: { trialStatus: "Та одоо үнэгүй туршилтын хугацаанд байгаа тул зурган дээр Diress усан тэмдэг гарч байна.", trialBenefit: "Бүх зургаа усан тэмдэггүй, бүрэн чанартай татахын тулд PRO хувилбар руу шилжинэ үү.", notice: "ХИ МЭДЭГДЭЛ: Энэ бол зохиогчийн эрхийн усан тэмдэг. Үүнийг устгах, тайрах эсвэл арилгах нь 17 U.S.C. §1202 (DMCA) болон FSEK 71-р зүйлийг зөрчинө.", credits: "Кредиттэй байх нь таныг PRO захиалагч болгохгүй.", expired: "Таны PRO захиалга {date}-нд дууссан.", resub: "Усан тэмдэггүй татахын тулд PRO-д дахин бүртгүүлнэ үү." },
  mr: { trialStatus: "तुम्ही सध्या मोफत ट्रायलवर आहात, म्हणून तुमच्या प्रतिमांवर Diress वॉटरमार्क असतो.", trialBenefit: "प्रत्येक प्रतिमा वॉटरमार्कशिवाय पूर्ण गुणवत्तेत डाउनलोड करण्यासाठी PRO वर जा.", notice: "एआय सूचना: हा कॉपीराइट वॉटरमार्क आहे. तो काढणे, कापणे किंवा पुसणे 17 U.S.C. §1202 (DMCA) आणि FSEK कलम 71 चे उल्लंघन आहे.", credits: "क्रेडिट्स असल्याने तुम्ही PRO सदस्य होत नाही.", expired: "तुमची PRO सदस्यता {date} रोजी संपली.", resub: "वॉटरमार्कशिवाय डाउनलोड करण्यासाठी पुन्हा PRO सदस्यता घ्या." },
  ms: { trialStatus: "Anda sedang menggunakan percubaan percuma, jadi imej anda membawa tera air Diress.", trialBenefit: "Tukar kepada PRO untuk memuat turun setiap imej dalam kualiti penuh tanpa tera air.", notice: "NOTIS AI: Ini ialah tera air hak cipta. Membuang, memotong atau memadamkannya melanggar 17 U.S.C. §1202 (DMCA) dan FSEK per. 71.", credits: "Memiliki kredit tidak menjadikan anda pelanggan PRO.", expired: "Langganan PRO anda tamat pada {date}.", resub: "Langgan PRO semula untuk memuat turun tanpa tera air." },
  ne: { trialStatus: "तपाईं अहिले निःशुल्क ट्रायलमा हुनुहुन्छ, त्यसैले तपाईंका तस्बिरहरूमा Diress वाटरमार्क रहन्छ।", trialBenefit: "हरेक तस्बिर वाटरमार्कविना पूर्ण गुणस्तरमा डाउनलोड गर्न PRO मा जानुहोस्।", notice: "एआई सूचना: यो प्रतिलिपि अधिकार वाटरमार्क हो। यसलाई हटाउनु, काट्नु वा मेटाउनु 17 U.S.C. §1202 (DMCA) र FSEK धारा 71 को उल्लङ्घन हो।", credits: "क्रेडिट हुनुले तपाईंलाई PRO ग्राहक बनाउँदैन।", expired: "तपाईंको PRO सदस्यता {date} मा समाप्त भयो।", resub: "वाटरमार्कबिना डाउनलोड गर्न फेरि PRO सदस्यता लिनुहोस्।" },
  pa: { trialStatus: "ਤੁਸੀਂ ਇਸ ਵੇਲੇ ਮੁਫ਼ਤ ਟ੍ਰਾਇਲ 'ਤੇ ਹੋ, ਇਸ ਲਈ ਤੁਹਾਡੀਆਂ ਤਸਵੀਰਾਂ 'ਤੇ Diress ਵਾਟਰਮਾਰਕ ਹੁੰਦਾ ਹੈ।", trialBenefit: "ਹਰ ਤਸਵੀਰ ਨੂੰ ਵਾਟਰਮਾਰਕ ਤੋਂ ਬਿਨਾਂ ਪੂਰੀ ਗੁਣਵੱਤਾ ਵਿੱਚ ਡਾਊਨਲੋਡ ਕਰਨ ਲਈ PRO 'ਤੇ ਜਾਓ।", notice: "AI ਸੂਚਨਾ: ਇਹ ਇੱਕ ਕਾਪੀਰਾਈਟ ਵਾਟਰਮਾਰਕ ਹੈ। ਇਸਨੂੰ ਹਟਾਉਣਾ, ਕੱਟਣਾ ਜਾਂ ਮਿਟਾਉਣਾ 17 U.S.C. §1202 (DMCA) ਅਤੇ FSEK ਧਾਰਾ 71 ਦੀ ਉਲੰਘਣਾ ਹੈ।", credits: "ਕ੍ਰੈਡਿਟ ਹੋਣ ਨਾਲ ਤੁਸੀਂ PRO ਗਾਹਕ ਨਹੀਂ ਬਣ ਜਾਂਦੇ।", expired: "ਤੁਹਾਡੀ PRO ਸਬਸਕ੍ਰਿਪਸ਼ਨ {date} ਨੂੰ ਖਤਮ ਹੋ ਗਈ।", resub: "ਵਾਟਰਮਾਰਕ ਤੋਂ ਬਿਨਾਂ ਡਾਊਨਲੋਡ ਕਰਨ ਲਈ ਮੁੜ PRO ਸਬਸਕ੍ਰਾਈਬ ਕਰੋ।" },
  rm: { trialStatus: "Ti es actualmain en la prova gratuita, perquai portan tias maletgs il segn d'aua da Diress.", trialBenefit: "Chomma a PRO per telechargiar mintga maletg en plaina qualitad e senza segn d'aua.", notice: "AVIS IA: Quai è ina marca d'aua da dretgs d'autur. La allontanar, tagliar u stizzar violescha 17 U.S.C. §1202 (DMCA) e FSEK art. 71.", credits: "Avair credits na fa betg da tai in abunent PRO.", expired: "Tes abunament PRO è ì a fin ils {date}.", resub: "Abunescha danovamain PRO per telechargiar senza marca d'aua." },
  si: { trialStatus: "ඔබ දැන් නොමිලේ අත්හදා බැලීමේ කාලය තුළ සිටින නිසා ඔබේ රූපවල Diress ජල සලකුණ තිබේ.", trialBenefit: "සෑම රූපයක්ම ජල සලකුණක් නොමැතිව පූර්ණ ගුණාත්මකභාවයෙන් බාගත කිරීමට PRO වෙත මාරු වන්න.", notice: "AI දැනුම්දීම: මෙය ප්‍රකාශන හිමිකම් දිය සලකුණකි. එය ඉවත් කිරීම, කැපීම හෝ මැකීම 17 U.S.C. §1202 (DMCA) සහ FSEK වගන්තිය 71 උල්ලංඝනය කරයි.", credits: "ක්‍රෙඩිට් තිබීම ඔබව PRO දායකයෙකු නොකරයි.", expired: "ඔබේ PRO දායකත්වය {date} දින අවසන් විය.", resub: "දිය සලකුණකින් තොරව බාගැනීමට නැවත PRO දායක වන්න." },
  sk: { trialStatus: "Práve máš bezplatnú skúšobnú verziu, a preto tvoje obrázky nesú vodoznak Diress.", trialBenefit: "Prejdi na PRO a sťahuj každý obrázok v plnej kvalite a bez vodoznaku.", notice: "AI UPOZORNENIE: Toto je autorskoprávny vodoznak. Jeho odstránenie, orezanie alebo zamaľovanie porušuje 17 U.S.C. §1202 (DMCA) a FSEK čl. 71.", credits: "Mať kredity z teba nerobí predplatiteľa PRO.", expired: "Tvoje predplatné PRO sa skončilo {date}.", resub: "Predplať si PRO znova a sťahuj bez vodoznaku." },
  sl: { trialStatus: "Trenutno si na brezplačnem preizkusu, zato tvoje slike nosijo vodni žig Diress.", trialBenefit: "Preklopi na PRO in prenašaj vsako sliko v polni kakovosti ter brez vodnega žiga.", notice: "AI OBVESTILO: To je avtorskopravni vodni žig. Odstranjevanje, obrezovanje ali brisanje krši 17 U.S.C. §1202 (DMCA) in FSEK čl. 71.", credits: "Imeti kredite te ne naredi PRO naročnika.", expired: "Tvoja PRO naročnina se je iztekla {date}.", resub: "Ponovno se naroči na PRO za prenos brez vodnega žiga." },
  sr: { trialStatus: "Тренутно си на бесплатном пробном периоду, зато твоје слике носе Diress водени жиг.", trialBenefit: "Пређи на PRO да сваку слику преузимаш у пуном квалитету и без воденог жига.", notice: "АИ ОБАВЕШТЕЊЕ: Ово је водени жиг ауторских права. Његово уклањање, сечење или брисање крши 17 U.S.C. §1202 (DMCA) и FSEK чл. 71.", credits: "Поседовање кредита те не чини PRO претплатником.", expired: "Твоја PRO претплата је истекла {date}.", resub: "Претплати се поново на PRO за преузимање без воденог жига." },
  sw: { trialStatus: "Kwa sasa uko kwenye jaribio lako la bure, ndiyo maana picha zako zina alama ya maji ya Diress.", trialBenefit: "Badilisha hadi PRO ili upakue kila picha kwa ubora kamili, bila alama ya maji.", notice: "TAARIFA YA AI: Hii ni alama ya maji ya hakimiliki. Kuiondoa, kuikata au kuifuta kunakiuka 17 U.S.C. §1202 (DMCA) na FSEK kif. 71.", credits: "Kuwa na krediti hakukufanyi kuwa mteja wa PRO.", expired: "Usajili wako wa PRO uliisha tarehe {date}.", resub: "Jisajili tena kwa PRO ili kupakua bila alama ya maji." },
  ta: { trialStatus: "நீங்கள் இப்போது இலவச சோதனைக் காலத்தில் இருப்பதால் உங்கள் படங்களில் Diress வாட்டர்மார்க் இருக்கும்.", trialBenefit: "ஒவ்வொரு படத்தையும் வாட்டர்மார்க் இல்லாமல் முழு தரத்தில் பதிவிறக்க PRO-க்கு மாறுங்கள்.", notice: "AI அறிவிப்பு: இது பதிப்புரிமை வாட்டர்மார்க். இதை நீக்குவது, வெட்டுவது அல்லது அழிப்பது 17 U.S.C. §1202 (DMCA) மற்றும் FSEK பிரிவு 71ஐ மீறுகிறது.", credits: "கிரெடிட் இருப்பதால் நீங்கள் PRO சந்தாதாரர் ஆகமாட்டீர்கள்.", expired: "உங்கள் PRO சந்தா {date} அன்று முடிந்தது.", resub: "வாட்டர்மார்க் இல்லாமல் பதிவிறக்க மீண்டும் PRO சந்தா செய்யுங்கள்." },
  te: { trialStatus: "మీరు ప్రస్తుతం ఉచిత ట్రయల్‌లో ఉన్నారు, అందుకే మీ చిత్రాలపై Diress వాటర్‌మార్క్ ఉంటుంది.", trialBenefit: "ప్రతి చిత్రాన్ని వాటర్‌మార్క్ లేకుండా పూర్తి నాణ్యతతో డౌన్‌లోడ్ చేయడానికి PRO కు మారండి.", notice: "AI నోటీసు: ఇది కాపీరైట్ వాటర్‌మార్క్. దీన్ని తొలగించడం, కత్తిరించడం లేదా చెరిపేయడం 17 U.S.C. §1202 (DMCA) మరియు FSEK సెక్షన్ 71 ఉల్లంఘన.", credits: "క్రెడిట్లు ఉన్నంత మాత్రాన మీరు PRO సభ్యులు కారు.", expired: "మీ PRO సభ్యత్వం {date}న ముగిసింది.", resub: "వాటర్‌మార్క్ లేకుండా డౌన్‌లోడ్ చేయడానికి మళ్లీ PRO సభ్యత్వం తీసుకోండి." },
  ur: { trialStatus: "آپ اس وقت مفت ٹرائل پر ہیں، اسی لیے آپ کی تصاویر پر Diress واٹرمارک ہوتا ہے۔", trialBenefit: "ہر تصویر کو واٹرمارک کے بغیر مکمل کوالٹی میں ڈاؤن لوڈ کرنے کے لیے PRO پر جائیں۔", notice: "اے آئی نوٹس: یہ کاپی رائٹ واٹرمارک ہے۔ اسے ہٹانا، کاٹنا یا مٹانا 17 U.S.C. §1202 (DMCA) اور FSEK دفعہ 71 کی خلاف ورزی ہے۔", credits: "کریڈٹ ہونے سے آپ PRO سبسکرائبر نہیں بن جاتے۔", expired: "آپ کی PRO سبسکرپشن {date} کو ختم ہو گئی۔", resub: "واٹرمارک کے بغیر ڈاؤن لوڈ کرنے کے لیے دوبارہ PRO سبسکرائب کریں۔" },
  uz: { trialStatus: "Hozir bepul sinov muddatidasiz, shu sababli rasmlaringizda Diress suv belgisi bo'ladi.", trialBenefit: "Barcha rasmlarni suv belgisisiz va to'liq sifatda yuklab olish uchun PRO versiyaga o'ting.", notice: "SI BILDIRISHNOMASI: Bu mualliflik huquqi suv belgisi. Uni olib tashlash, kesish yoki o'chirish 17 U.S.C. §1202 (DMCA) va FSEK 71-moddasini buzadi.", credits: "Kreditlarga ega bo'lish sizni PRO obunachiga aylantirmaydi.", expired: "PRO obunangiz {date} kuni tugagan.", resub: "Suv belgisisiz yuklab olish uchun PRO'ga qayta obuna bo'ling." },
  zu: { trialStatus: "Okwamanje usesikhathini sokuzama samahhala, yingakho izithombe zakho zinophawu lwamanzi lwe-Diress.", trialBenefit: "Shintshela ku-PRO ukuze ulande zonke izithombe ngekhwalithi egcwele, ngaphandle kophawu lwamanzi.", notice: "ISAZISO SE-AI: Lolu uphawu lwamanzi lwelungelo lokushicilela. Ukululususa, ukulusika noma ukulusula kwephula i-17 U.S.C. §1202 (DMCA) ne-FSEK isig. 71.", credits: "Ukuba namakhredithi akukwenzi umbhalisi we-PRO.", expired: "Ukubhalisa kwakho kwe-PRO kwaphela ngo-{date}.", resub: "Bhalisa ku-PRO futhi ukuze ulande ngaphandle kophawu lwamanzi." },
};

// Filigranın kullanıcıya dönük PRO metinleri. Yasal uyarı sözlüğünden ayrı
// tutulur: böylece samimi dil güncellemeleri telif metnini etkilemez.
const WATERMARK_FRIENDLY_I18N = {
  "en": {"cta":"UPGRADE TO PRO","credits":"You can keep using your credits; watermark-free downloads are included with a PRO membership.","period":"Your latest PRO membership, which you started on {startDate}, ended on {endDate}. That’s why this image is being downloaded with a watermark.","resub":"If you'd like, you can switch to PRO and download your images without a watermark."},
  "tr": {"cta":"PRO'YA GEÇ","credits":"Kredilerini kullanmaya devam edebilirsin; filigransız indirme PRO üyeliğine dahildir.","period":"{startDate} tarihinde başlattığın son PRO üyeliğin {endDate} tarihinde sona erdi. Bu nedenle bu görsel filigranlı olarak indiriliyor.","resub":"Dilersen PRO'ya geçerek görsellerini filigransız indirebilirsin."},
  "es": {"cta":"Pásate a PRO","credits":"Puedes seguir usando tus créditos. Las descargas sin marca de agua están incluidas con tu membresía PRO.","period":"Tu última suscripción PRO, que comenzó el {startDate}, finalizó el {endDate}. Por eso esta imagen se descarga con marca de agua.","resub":"Si quieres, puedes pasarte a PRO para descargar tus imágenes limpias y sin marcas de agua."},
  "pt": {"cta":"Mudar para o PRO","credits":"Pode continuar a usar os seus créditos; as transferências sem marca de água estão incluídas no plano PRO.","period":"A sua última subscrição PRO, iniciada a {startDate}, terminou a {endDate}. É por isso que esta imagem inclui uma marca de água.","resub":"Se quiser, pode aderir ao PRO para descarregar as suas imagens sem qualquer marca de água."},
  "de": {"cta":"Auf PRO upgraden","credits":"Du kannst deine Credits weiterhin nutzen – Downloads ohne Wasserzeichen sind in der PRO-Mitgliedschaft inklusive.","period":"Deine letzte PRO-Mitgliedschaft vom {startDate} ist am {endDate} abgelaufen. Deshalb enthält dieses Bild ein Wasserzeichen.","resub":"Wechsle einfach zu PRO, wenn du deine Bilder ohne Wasserzeichen herunterladen möchtest."},
  "fr": {"cta":"Passer à PRO","credits":"Vous pouvez continuer à utiliser vos crédits ; les téléchargements sans filigrane sont inclus avec l'abonnement PRO.","period":"Votre dernier abonnement PRO, commencé le {startDate}, a pris fin le {endDate}. C'est pourquoi cette image comporte un filigrane.","resub":"Si vous le souhaitez, passez à PRO pour télécharger vos images sans aucun filigrane."},
  "it": {"cta":"Passa a PRO","credits":"Puoi continuare a usare i tuoi crediti; i download senza filigrana sono inclusi con il piano PRO.","period":"Il tuo ultimo abbonamento PRO, iniziato il {startDate}, è terminato il {endDate}. Ecco perché questa immagine include una filigrana.","resub":"Se vuoi, puoi passare a PRO e scaricare tutte le tue immagini senza filigrana."},
  "id": {"cta":"Upgrade ke PRO","credits":"Kamu tetap bisa pakai kreditmu; unduhan tanpa watermark sudah termasuk dalam paket PRO.","period":"Langganan PRO terakhirmu yang dimulai pada {startDate} telah berakhir pada {endDate}. Karena itu, gambar ini diunduh dengan watermark.","resub":"Yuk, beralih ke PRO kapan saja untuk mengunduh gambar bebas watermark."},
  "nl": {"cta":"Upgraden naar PRO","credits":"Je kunt je credits gewoon blijven gebruiken; downloads zonder watermerk zijn inbegrepen bij PRO.","period":"Je laatste PRO-lidmaatschap liep van {startDate} tot {endDate}. Daarom heeft deze afbeelding een watermerk.","resub":"Als je wilt, kun je overstappen naar PRO om je afbeeldingen zonder watermerk te downloaden."},
  "pl": {"cta":"Przejdź na PRO","credits":"Możesz dalej korzystać ze swoich kredytów — pobieranie bez znaku wodnego jest dostępne w pakiecie PRO.","period":"Twoja ostatnia subskrypcja PRO, rozpoczęta {startDate}, zakończyła się {endDate}. Dlatego ten obraz został pobrany ze znakiem wodnym.","resub":"W każdej chwili możesz przejść na PRO i pobierać obrazy bez znaku wodnego."},
  "ro": {"cta":"Treci la PRO","credits":"Poți folosi în continuare creditele tale; descărcările fără filigran sunt incluse în abonamentul PRO.","period":"Ultimul tău abonament PRO, început pe {startDate}, s-a încheiat pe {endDate}. De aceea, această imagine are un filigran.","resub":"Dacă dorești, poți trece la PRO pentru a descărca imaginile fără niciun filigran."},
  "cs": {"cta":"Přejít na PRO","credits":"Své kredity můžete dál využívat; stahování bez vodoznaku je součástí členství PRO.","period":"Vaše poslední členství PRO, které začalo {startDate}, skončilo {endDate}. Proto je tento obrázek stažen s vodoznakem.","resub":"Kdykoliv můžete přejít na PRO a stahovat své obrázky zcela bez vodoznaku."},
  "hu": {"cta":"Váltás PRO-ra","credits":"Nyugodtan felhasználhatod a kreditjeidet; a vízjel nélküli letöltést a PRO tagság tartalmazza.","period":"A legutóbbi PRO tagságod, amely {startDate} napon indult, {endDate} napon véget ért. Ezért szerepel vízjel ezen a képen.","resub":"Bármikor átválthatsz PRO csomagra, ha vízjel nélkül szeretnéd letölteni a képeidet."},
  "sv": {"cta":"Uppgradera till PRO","credits":"Du kan fortsätta använda dina krediter – nedladdningar utan vattenstämpel ingår i PRO.","period":"Ditt senaste PRO-medlemskap, som startade {startDate}, avslutades {endDate}. Därför laddas den här bilden ned med vattenstämpel.","resub":"Uppgradera gärna till PRO om du vill ladda ned dina bilder helt utan vattenstämpel."},
  "da": {"cta":"Opgrader til PRO","credits":"Du kan sagtens bruge dine credits; downloads uden vandmærke er inkluderet i PRO-medlemskabet.","period":"Dit seneste PRO-medlemskab fra {startDate} udløb den {endDate}. Derfor downloades dette billede med vandmærke.","resub":"Du kan altid skifte til PRO for at downloade dine billeder helt uden vandmærke."},
  "no": {"cta":"Oppgrader til PRO","credits":"Du kan fint fortsette å bruke kreditrene dine; nedlastinger uten vannmerke er inkludert i PRO.","period":"Ditt forrige PRO-medlemskap, som startet {startDate}, utløp {endDate}. Derfor har dette bildet et vannmerke.","resub":"Oppgrader gjerne til PRO hvis du vil laste ned bildene dine helt uten vannmerke."},
  "fi": {"cta":"Päivitä PRO-versioon","credits":"Voit käyttää krediittejäsi normaalisti; vesileimattomat lataukset sisältyvät PRO-jäsenyyteen.","period":"Viimeisin PRO-jäsenyytesi alkoi {startDate} ja päättyi {endDate}. Siksi tämä kuva latautuu vesileimalla.","resub":"Voit milloin vain siirtyä PRO-tilaukseen ja ladata kuvasi ilman vesileimaa."},
  "az": {"cta":"PRO-ya yüksəldin","credits":"Kreditlərinizdən istifadə etməyə davam edə bilərsiniz; su nişansız yükləmələr PRO abunəliyinə daxildir.","period":"{startDate} tarixində başlayan son PRO abunəliyiniz {endDate} tarixində başa çatdı. Buna görə də bu şəkil su nişanı ilə endirilir.","resub":"İstədiyiniz vaxt PRO-ya keçərək şəkillərinizi su nişanı olmadan endirə bilərsiniz."},
  "ru": {"cta":"Перейти на PRO","credits":"Вы можете продолжать тратить кредиты, а скачивание без водяных знаков доступно с подпиской PRO.","period":"Ваша прошлая подписка PRO действовала с {startDate} по {endDate}. Поэтому изображение скачивается с водяным знаком.","resub":"При желании вы можете перейти на PRO и скачивать любые изображения без водяных знаков."},
  "uk": {"cta":"Перейти на PRO","credits":"Ви можете й надалі користуватися кредитами; завантаження без водяного знака доступні з підпискою PRO.","period":"Ваша остання підписка PRO тривала з {startDate} до {endDate}. Саме тому це зображення завантажується з водяним знаком.","resub":"За бажанням переходьте на PRO, щоб зберігати зображення без водяних знаків."},
  "bg": {"cta":"Надграждане до PRO","credits":"Можете да продължите да използвате кредитите си; изтеглянията без воден знак са включени в PRO членството.","period":"Последният ви PRO абонамент, активен от {startDate}, приключи на {endDate}. Затова това изображение съдържа воден знак.","resub":"Ако желаете, можете да преминете към PRO и да изтегляте изображенията си без воден знак."},
  "el": {"cta":"Αναβάθμιση σε PRO","credits":"Μπορείτε να συνεχίσετε να χρησιμοποιείτε τα credits σας. Οι λήψεις χωρίς υδατογράφημα περιλαμβάνονται στο πλάνο PRO.","period":"Η τελευταία σας συνδρομή PRO, που ξεκίνησε στις {startDate}, έληξε στις {endDate}. Γι' αυτό η εικόνα περιέχει υδατογράφημα.","resub":"Αν θέλετε, μπορείτε να μεταβείτε σε PRO για να κατεβάζετε τις εικόνες σας χωρίς υδατογράφημα."},
  "vi": {"cta":"Nâng cấp lên PRO","credits":"Bạn vẫn có thể dùng số credit của mình; tải ảnh không có watermark là quyền lợi dành riêng cho gói PRO.","period":"Gói PRO gần nhất của bạn bắt đầu từ {startDate} đã kết thúc vào {endDate}. Vì vậy ảnh này sẽ có watermark.","resub":"Bạn có thể nâng cấp lên PRO bất cứ lúc nào để tải ảnh về hoàn toàn không có watermark."},
  "ar": {"cta":"الترقية إلى PRO","credits":"يمكنك الاستمرار في استخدام رصيدك؛ التنزيل بدون علامة مائية متاح دائماً مع اشتراك PRO.","period":"انتهى اشتراكك الأخير في PRO، الذي بدأ في {startDate}، بتاريخ {endDate}. لهذا السبب تم تنزيل هذه الصورة بعلامة مائية.","resub":"إذا أردت، يمكنك الترقية إلى PRO لتنزيل جميع صورك بدون أي علامة مائية."},
  "fa": {"cta":"ارتقا به PRO","credits":"می‌توانید همچنان از اعتبارتان استفاده کنید؛ دانلود بدون واترمارک با اشتراک PRO در دسترس است.","period":"آخرین اشتراک PRO شما که در تاریخ {startDate} شروع شده بود، در {endDate} به پایان رسید. به همین دلیل این تصویر با واترمارک دانلود می‌شود.","resub":"در صورت تمایل می‌توانید به PRO ارتقا دهید و تصاویرتان را بدون واترمارک دانلود کنید."},
  "he": {"cta":"שדרוג ל-PRO","credits":"אפשר להמשיך להשתמש בקרדיטים שלך; הורדות ללא סימן מים כלולות במינוי PRO.","period":"מינוי ה-PRO האחרון שלך, שהתחיל ב-{startDate}, הסתיים ב-{endDate}. זו הסיבה שהתמונה הזו יורדת עם סימן מים.","resub":"אם תרצה, תמיד אפשר לעבור ל-PRO ולהוריד תמונות נקיות מסימני מים."},
  "hi": {"cta":"PRO में अपग्रेड करें","credits":"आप अपने क्रेडिट्स का इस्तेमाल जारी रख सकते हैं; बिना वॉटरमार्क डाउनलोड की सुविधा PRO मेंबरशिप में शामिल है।","period":"आपकी पिछली PRO मेंबरशिप {startDate} को शुरू होकर {endDate} को समाप्त हो गई थी। इसीलिए यह इमेज वॉटरमार्क के साथ डाउनलोड हो रही है।","resub":"अगर आप चाहें, तो बिना वॉटरमार्क इमेज डाउनलोड करने के लिए PRO पर स्विच कर सकते हैं।"},
  "th": {"cta":"อัปเกรดเป็น PRO","credits":"คุณยังคงใช้เครดิตที่มีอยู่ได้ตามปกติ โดยการดาวน์โหลดแบบไม่มีลายน้ำจะรวมอยู่ในแพ็กเกจ PRO","period":"สมาชิก PRO ล่าสุดของคุณที่เริ่มเมื่อ {startDate} ได้สิ้นสุดลงแล้วเมื่อ {endDate} ภาพนี้จึงมีลายน้ำติดไปด้วย","resub":"หากต้องการ คุณสามารถเปลี่ยนมาใช้ PRO เพื่อดาวน์โหลดภาพแบบไม่มีลายน้ำได้เลย"},
  "ja": {"cta":"PROにアップグレード","credits":"クレジットは引き続きご利用いただけます。透かし（ウォーターマーク）なしでのダウンロードはPROプランに含まれています。","period":"{startDate}に開始された前回のPROプランは{endDate}に終了しました。そのため、この画像には透かしが入っています。","resub":"PROプランにアップグレードすると、いつでも透かしなしで画像をダウンロードできます。"},
  "ko": {"cta":"PRO로 업그레이드","credits":"보유한 크레딧은 계속 사용하실 수 있으며, 워터마크 없는 다운로드는 PRO 멤버십에서 제공됩니다.","period":"{startDate}에 시작된 최근 PRO 멤버십이 {endDate}에 만료되었습니다. 따라서 이 이미지는 워터마크가 포함되어 다운로드됩니다.","resub":"원하실 때 언제든 PRO로 전환하여 워터마크 없이 깔끔하게 다운로드해 보세요."},
  "zh": {"cta":"升级至 PRO","credits":"您可以继续使用剩余的点数；无水印下载为 PRO 会员专享权益。","period":"您于 {startDate} 开始的最近一次 PRO 会员已于 {endDate} 到期，因此本次下载的图片带有水印。","resub":"如有需要，您可以随时升级至 PRO，享受无水印高清下载。"},
  "zh_tw": {"cta":"升級至 PRO","credits":"您可以繼續使用剩餘的點數；無浮水印下載為 PRO 會員專屬權益。","period":"您於 {startDate} 開始的 PRO 會員已於 {endDate} 到期，因此此圖片帶有浮水印。","resub":"隨時升級至 PRO，即可享受無浮水印的圖片下載體驗。"},
  "af": {"cta":"Gradeer op na PRO","credits":"Jy kan voortgaan om jou krediete te gebruik; aflaaie sonder watermerke is ingesluit by 'n PRO-lidmaatskap.","period":"Jou vorige PRO-lidmaatskap wat op {startDate} begin het, het op {endDate} geëindig. Daarom het hierdie prent 'n watermerk.","resub":"As jy wil, kan jy oorskakel na PRO om jou prente sonder watermerke af te laai."},
  "am": {"cta":"ወደ PRO ያሳድጉ","credits":"ክሬዲትዎን መጠቀም መቀጠል ይችላሉ፤ ያለ የውሃ ምልክት ማውረድ ከPRO አባልነት ጋር የተካተተ ነው።","period":"በ{startDate} የጀመረው የመጨረሻው የPRO አባልነትዎ በ{endDate} አብቅቷል። ስለዚህ ይህ ምስል በውሃ ምልክት እየወረደ ነው።","resub":"ከፈለጉ ምስሎችዎን ያለ ምንም የውሃ ምልክት ለማውረድ ወደ PRO መቀየር ይችላሉ።"},
  "be": {"cta":"Перайсці на PRO","credits":"Вы можаце працягваць выкарыстоўваць свае крэдыты; спампоўка без вадзяных знакаў даступная з падпіскай PRO.","period":"Ваша апошняя падпіска PRO, распачатая {startDate}, скончылася {endDate}. Таму гэты відарыс спампоўваецца з вадзяным знакам.","resub":"Пры жаданні вы можаце перайсці на PRO і спампоўваць выявы без вадзяных знакаў."},
  "bn": {"cta":"PRO-তে আপগ্রেড করুন","credits":"আপনি আপনার ক্রেডিট ব্যবহার চালিয়ে যেতে পারেন; ওয়াটারমার্ক ছাড়া ডাউনলোড PRO মেম্বারশিপের অন্তর্ভুক্ত।","period":"{startDate}-এ শুরু হওয়া আপনার সর্বশেষ PRO মেম্বারশিপটি {endDate}-এ শেষ হয়েছে। তাই এই ছবিটি ওয়াটারমার্কসহ ডাউনলোড হচ্ছে।","resub":"আপনি চাইলে যেকোনো সময় PRO-তে আপগ্রেড করে ওয়াটারমার্ক ছাড়াই ছবি ডাউনলোড করতে পারেন।"},
  "ca": {"cta":"Passa a PRO","credits":"Pots continuar utilitzant els teus crèdits; les descàrregues sense marca d'aigua estan incloses amb la subscripció PRO.","period":"La teva darrera subscripció PRO, iniciada el {startDate}, va finalitzar el {endDate}. Per això aquesta imatge es descarrega amb marca d'aigua.","resub":"Si vols, pots passar a PRO per descarregar les teves imatges sense cap marca d'aigua."},
  "et": {"cta":"Uuenda PRO-ks","credits":"Saad oma krediite edasi kasutada; vesimärgita allalaadimised sisalduvad PRO-paketis.","period":"Sinu viimane PRO-tellimus, mis algas {startDate}, lõppes {endDate}. Seetõttu laaditakse see pilt alla vesimärgiga.","resub":"Soovi korral saad minna üle PRO-paketile ning laadida pilte alla ilma vesimärgita."},
  "eu": {"cta":"Berritu PROra","credits":"Zure kredituak erabiltzen jarrai dezakezu; ur-markarik gabeko deskargak PRO kidetzan sartuta daude.","period":"{startDate}(e)an hasitako zure azken PRO kidetza {endDate}(e)an amaitu zen. Horregatik deskargatzen da irudi hau ur-markarekin.","resub":"Nahi baduzu, PROra alda zaitezke zure irudiak ur-markarik gabe deskargatzeko."},
  "fil": {"cta":"Mag-upgrade sa PRO","credits":"Maaari mo pa ring gamitin ang iyong credits; kasama sa PRO membership ang downloads na walang watermark.","period":"Ang huling PRO membership mo na nagsimula noong {startDate} ay nagtapos noong {endDate}. Kaya may watermark ang na-download na larawang ito.","resub":"Kung gusto mo, puwede kang lumipat sa PRO para mag-download nang walang watermark."},
  "gl": {"cta":"Pásate a PRO","credits":"Podes seguir usando os teus créditos; as descargas sen marca de auga están incluídas na subscrición PRO.","period":"A túa última subscrición PRO, que comezou o {startDate}, rematou o {endDate}. Por iso esta imaxe inclúe marca de auga.","resub":"Se queres, podes cambiarte a PRO e descargar as túas imaxes sen marcas de auga."},
  "gu": {"cta":"PRO પર અપગ્રેડ કરો","credits":"તમે તમારા ક્રેડિટ્સ વાપરવાનું ચાલુ રાખી શકો છો; વૉટરમાર્ક વગર ડાઉનલોડ PRO મેમ્બરશિપમાં સામેલ છે.","period":"તમારી છેલ્લી PRO મેમ્બરશિપ જે {startDate} ના રોજ શરૂ થઈ હતી, તે {endDate} ના રોજ પૂરી થઈ ગઈ છે. તેથી આ ઇમેજ વૉટરમાર્ક સાથે ડાઉનલોડ થઈ રહી છે.","resub":"જો તમે ઇચ્છો તો વૉટરમાર્ક વગર ઇમેજ ડાઉનલોડ કરવા માટે PRO પર સ્વિચ કરી શકો છો."},
  "hr": {"cta":"Nadogradi na PRO","credits":"Možeš i dalje koristiti svoje kredite; preuzimanja bez vodenog žiga uključena su u PRO članstvo.","period":"Tvoja posljednja PRO pretplata, započeta {startDate}, završila je {endDate}. Zato se ova slika preuzima s vodenim žigom.","resub":"Ako želiš, možeš prijeći na PRO i preuzimati svoje slike bez vodenog žiga."},
  "hy": {"cta":"Անցնել PRO-ի","credits":"Կարող եք շարունակել օգտագործել ձեր կրեդիտները. առանց ջրանիշի ներբեռնումները ներառված են PRO փաթեթում:","period":"Ձեր վերջին PRO անդամակցությունը, որը սկսվել էր {startDate}-ին, ավարտվել է {endDate}-ին: Այդ պատճառով այս պատկերը ներբեռնվում է ջրանիշով:","resub":"Ցանկության դեպքում կարող եք անցնել PRO-ի և ներբեռնել պատկերներն առանց ջրանիշի:"},
  "is": {"cta":"Uppfæra í PRO","credits":"Þú getur haldið áfram að nota inneignina þína; niðurhal án vatnsmerkis er innifalið í PRO-áskrift.","period":"Síðasta PRO-áskriftin þín, sem hófst {startDate}, rann út {endDate}. Þess vegna er þessi mynd með vatnsmerki.","resub":"Þú getur hvenær sem er uppfært í PRO til að sækja myndirnar þínar án vatnsmerkis."},
  "ka": {"cta":"გადასვლა PRO-ზე","credits":"შეგიძლიათ გააგრძელოთ თქვენი კრედიტების გამოყენება; ჩამოტვირთვა წყლის ნიშნის გარეშე ხელმისაწვდომია PRO წევრობით.","period":"თქვენი ბოლო PRO წევრობა, რომელიც დაიწყო {startDate}-ზე, დასრულდა {endDate}-ზე. სწორედ ამიტომ ეს სურათი ჩამოიტვირთა წყლის ნიშნით.","resub":"თუ გსურთ, შეგიძლიათ გადახვიდეთ PRO-ზე და ჩამოტვირთოთ სურათები წყლის ნიშნის გარეშე."},
  "kk": {"cta":"PRO тарифке өту","credits":"Кредиттеріңізді әрі қарай қолдана аласыз; сутаңбасыз жүктеп алу PRO жазылымына кіреді.","period":"{startDate} күні басталған соңғы PRO жазылымыңыз {endDate} күні аяқталды. Сондықтан бұл кескін сутаңбамен жүктелуде.","resub":"Қаласаңыз, суреттерді сутаңбасыз жүктеп алу үшін PRO тарифіне ауыса аласыз."},
  "km": {"cta":"ដំឡើងទៅ PRO","credits":"អ្នកអាចបន្តប្រើក្រេឌីតរបស់អ្នកបាន។ ការទាញយកដោយគ្មាន watermark គឺមាននៅក្នុងគម្រោង PRO។","period":"សមាជិកភាព PRO ចុងក្រោយរបស់អ្នកដែលបានចាប់ផ្តើមនៅ {startDate} បានផុតកំណត់នៅ {endDate}។ ដូច្នេះហើយទើបរូបភាពនេះមានជាប់ watermark។","resub":"ប្រសិនបើចង់បាន អ្នកអាចប្តូរទៅ PRO ដើម្បីទាញយករូបភាពរបស់អ្នកដោយគ្មាន watermark។"},
  "kn": {"cta":"PRO ಗೆ ಅಪ್‌ಗ್ರೇಡ್ ಮಾಡಿ","credits":"ನಿಮ್ಮ ಕ್ರೆಡಿಟ್‌ಗಳನ್ನು ನೀವು ಬಳಸುವುದನ್ನು ಮುಂದುವರಿಸಬಹುದು; ವಾಟರ್‌ಮಾರ್ಕ್ ಇಲ್ಲದ ಡೌನ್‌ಲೋಡ್‌ಗಳು PRO ಸದಸ್ಯತ್ವದಲ್ಲಿ ಲಭ್ಯವಿದೆ.","period":"{startDate} ರಂದು ಪ್ರಾರಂಭವಾದ ನಿಮ್ಮ ಇತ್ತೀಚಿನ PRO ಸದಸ್ಯತ್ವವು {endDate} ರಂದು ಕೊನೆಗೊಂಡಿದೆ. ಆದ್ದರಿಂದ ಈ ಚಿತ್ರವನ್ನು ವಾಟರ್‌ಮಾರ್ಕ್‌ನೊಂದಿಗೆ ಡೌನ್‌ಲೋಡ್ ಮಾಡಲಾಗುತ್ತಿದೆ.","resub":"ನೀವು ಬಯಸಿದರೆ, ವಾಟರ್‌ಮಾರ್ಕ್ ಇಲ್ಲದೆ ಚಿತ್ರಗಳನ್ನು ಡೌನ್‌ಲೋಡ್ ಮಾಡಲು PRO ಗೆ ಬದಲಾಯಿಸಬಹುದು."},
  "ky": {"cta":"PRO'го өтүү","credits":"Кредиттериңизди колдоно берсеңиз болот; суу белгиси жок жүктөөлөр PRO мүчөлүгүнө камтылган.","period":"{startDate} күнү башталган акыркы PRO мүчөлүгүңүз {endDate} күнү аяктаган. Ошондуктан бул сүрөт суу белгиси менен жүктөлүп жатат.","resub":"Кааласаңыз, сүрөттөрүңүздү суу белгиси жок жүктөп алуу үчүн PRO'го өтсөңүз болот."},
  "lo": {"cta":"ອັບເກຣດເປັນ PRO","credits":"ທ່ານຍັງສາມາດໃຊ້ເຄຣດິດຂອງທ່ານຕໍ່ໄປໄດ້; ການດາວໂຫຼດແບບບໍ່ມີ watermark ແມ່ນລວມຢູ່ໃນສະມາຊິກ PRO.","period":"ສະມາຊິກ PRO ຫຼ້າສຸດຂອງທ່ານທີ່ເລີ່ມເມື່ອ {startDate} ໄດ້ສິ້ນສຸດລົງໃນ {endDate}. ດັ່ງນັ້ນຮູບນີ້ຈຶ່ງຖືກດາວໂຫຼດພ້ອມກັບ watermark.","resub":"ຖ້າທ່ານຕ້ອງການ, ທ່ານສາມາດປ່ຽນເປັນ PRO ເພື່ອດາວໂຫຼດຮູບພາບຂອງທ່ານໂດຍບໍ່ມີ watermark ໄດ້."},
  "lt": {"cta":"Pereiti prie PRO","credits":"Galite ir toliau naudoti savo kreditus; atsisiuntimai be vandenženklio yra įtraukti į PRO narystę.","period":"Paskutinė jūsų PRO narystė, prasidėjusi {startDate}, baigėsi {endDate}. Todėl šis vaizdas atsisiunčiamas su vandenženkliu.","resub":"Jei norite, galite pereiti prie PRO ir atsisiųsti vaizdus be jokio vandenženklio."},
  "lv": {"cta":"Uzlabot uz PRO","credits":"Varat turpināt izmantot savus kredītus; lejupielādes bez ūdenszīmes ir iekļautas PRO plānā.","period":"Tavs pēdējais PRO abonements, kas sākās {startDate}, beidzās {endDate}. Tāpēc šis attēls tiek lejupielādēts ar ūdenszīmi.","resub":"Ja vēlies, vari pāriet uz PRO, lai lejupielādētu attēlus bez ūdenszīmes."},
  "mk": {"cta":"Надгради на PRO","credits":"Можеш да продолжиш да ги користиш твоите кредити; преземањата без воден жиг се вклучени во PRO членството.","period":"Твојата последна PRO претплата, започната на {startDate}, заврши на {endDate}. Затоа оваа слика се презема со воден жиг.","resub":"Ако сакаш, можеш да се префрлиш на PRO и да ги преземаш твоите слики без воден жиг."},
  "ml": {"cta":"PRO-ലേക്ക് അപ്‌ഗ്രേഡ് ചെയ്യുക","credits":"നിങ്ങൾക്ക് ക്രെഡിറ്റുകൾ തുടർന്നും ഉപയോഗിക്കാം; വാട്ടർമാർക്കില്ലാത്ത ഡൗൺലോഡുകൾ PRO മെമ്പർഷിപ്പിൽ ലഭ്യമാണ്.","period":"{startDate}-ൽ ആരംഭിച്ച നിങ്ങളുടെ ഏറ്റവും പുതിയ PRO മെമ്പർഷിപ്പ് {endDate}-ൽ അവസാനിച്ചു. അതുകൊണ്ടാണ് ഈ ചിത്രം വാട്ടർമാർക്കോടെ ഡൗൺലോഡ് ചെയ്യുന്നത്.","resub":"വാട്ടർമാർക്കില്ലാതെ ചിത്രങ്ങൾ ഡൗൺലോഡ് ചെയ്യാൻ താൽപ്പര്യമുണ്ടെങ്കിൽ നിങ്ങൾക്ക് PRO-ലേക്ക് മാറാം."},
  "mn": {"cta":"PRO болгох","credits":"Та кредитээ үргэлжлүүлэн ашиглах боломжтой ба усан хээгүй татах эрх нь PRO гишүүнчлэлд багтдаг.","period":"{startDate}-нд эхэлсэн таны сүүлийн PRO гишүүнчлэл {endDate}-нд дууссан байна. Тиймээс энэ зураг усан хээтэй татагдаж байна.","resub":"Хэрэв хүсвэл та PRO багц руу шилжин зургуудаа усан хээгүйгээр татаж аваарай."},
  "mr": {"cta":"PRO वर अपग्रेड करा","credits":"तुम्ही तुमचे क्रेडिट्स वापरणे सुरू ठेवू शकता; वॉटरमार्कशिवाय डाउनलोड्स PRO सदस्यतेमध्ये समाविष्ट आहेत.","period":"{startDate} रोजी सुरू झालेली तुमची मागील PRO सदस्यता {endDate} रोजी संपली आहे. म्हणूनच ही इमेज वॉटरमार्कसह डाउनलोड होत आहे.","resub":"तुम्हाला हवे असल्यास, वॉटरमार्कशिवाय इमेजेस डाउनलोड करण्यासाठी तुम्ही PRO वर स्विच करू शकता."},
  "ms": {"cta":"Naik taraf ke PRO","credits":"Anda boleh terus menggunakan kredit anda; muat turun tanpa tera air disertakan dengan keahlian PRO.","period":"Langganan PRO terakhir anda yang bermula pada {startDate} telah tamat pada {endDate}. Sebab itulah imej ini dimuat turun dengan tera air.","resub":"Jika mahu, anda boleh bertukar ke PRO untuk memuat turun imej tanpa tera air."},
  "ne": {"cta":"PRO मा अपग्रेड गर्नुहोस्","credits":"तपाईं आफ्ना क्रेडिटहरू प्रयोग गर्न जारी राख्न सक्नुहुन्छ; वाटरमार्क बिना डाउनलोड गर्ने सुविधा PRO सदस्यतामा समावेश छ।","period":"{startDate} मा सुरु भएको तपाईंको पछिल्लो PRO सदस्यता {endDate} मा समाप्त भयो। त्यसैले यो तस्बिर वाटरमार्कसहित डाउनलोड भइरहेको छ।","resub":"यदि तपाईं चाहनुहुन्छ भने, वाटरमार्क बिना तस्बिरहरू डाउनलोड गर्न PRO मा स्विच गर्न सक्नुहुन्छ।"},
  "pa": {"cta":"PRO ਵਿੱਚ ਅੱਪਗ੍ਰੇਡ ਕਰੋ","credits":"ਤੁਸੀਂ ਆਪਣੇ ਕ੍ਰੈਡਿਟ ਵਰਤਣਾ ਜਾਰੀ ਰੱਖ ਸਕਦੇ ਹੋ; ਵਾਟਰਮਾਰਕ ਤੋਂ ਬਿਨਾਂ ਡਾਊਨਲੋਡ PRO ਮੈਂਬਰਸ਼ਿਪ ਵਿੱਚ ਸ਼ਾਮਲ ਹਨ।","period":"{startDate} ਨੂੰ ਸ਼ੁਰੂ ਹੋਈ ਤੁਹਾਡੀ ਪਿਛਲੀ PRO ਮੈਂਬਰਸ਼ਿਪ {endDate} ਨੂੰ ਖ਼ਤਮ ਹੋ ਗਈ ਹੈ। ਇਸ ਲਈ ਇਹ ਤਸਵੀਰ ਵਾਟਰਮਾਰਕ ਨਾਲ ਡਾਊਨਲੋਡ ਹੋ ਰਹੀ ਹੈ।","resub":"ਜੇਕਰ ਤੁਸੀਂ ਚਾਹੋ, ਤਾਂ ਵਾਟਰਮਾਰਕ ਤੋਂ ਬਿਨਾਂ ਤਸਵੀਰਾਂ ਡਾਊਨਲੋਡ ਕਰਨ ਲਈ PRO 'ਤੇ ਸਵਿੱਚ ਕਰ ਸਕਦੇ ਹੋ।"},
  "rm": {"cta":"Upgradar sin PRO","credits":"Ti pos cuntinuar dad utilisar tes credits; telechargiadas senza filigrana èn inclusas en il commembranza da PRO.","period":"Tia davosa commembranza da PRO, cumenzada ils {startDate}, è ida a fin ils {endDate}. Perquai vegn quest maletg telechargià cun ina filigrana.","resub":"Sche ti vuls, pos ti midar sin PRO per telechargiar tes maletgs senza filigrana."},
  "si": {"cta":"PRO වෙත උසස් කරන්න","credits":"ඔබට ඔබගේ ක්‍රෙඩිට් දිගටම භාවිත කළ හැක; දිය සලකුණු (watermark) රහිත බාගැනීම් PRO සාමාජිකත්වයට ඇතුළත් වේ.","period":"{startDate} දින ආරම්භ වූ ඔබේ අවසාන PRO සාමාජිකත්වය {endDate} දිනෙන් අවසන් විය. මෙම ඡායාරූපය දිය සලකුණක් සහිතව බාගත වන්නේ එබැවිනි.","resub":"ඔබට අවශ්‍ය නම්, දිය සලකුණු නොමැතිව ඡායාරූප බාගත කිරීමට PRO වෙත මාරු විය හැක."},
  "sk": {"cta":"Prejsť na PRO","credits":"Svoje kredity môžete využívať aj naďalej; sťahovanie bez vodoznaku je súčasťou členstva PRO.","period":"Vaše posledné členstvo PRO, ktoré sa začalo {startDate}, skončilo {endDate}. Preto sa tento obrázok sťahuje s vodoznakom.","resub":"Kedykoľvek môžete prejsť na PRO a sťahovať obrázky úplne bez vodoznaku."},
  "sl": {"cta":"Nadgradi na PRO","credits":"Svoje dobroimetje lahko še naprej uporabljaš; prenosi brez vodnega žiga so vključeni v članstvo PRO.","period":"Tvoje zadnje članstvo PRO, ki se je začelo {startDate}, se je zaključilo {endDate}. Zato se ta slika prenaša z vodnim žigom.","resub":"Če želiš, lahko preklopiš na PRO in prenašaš svoje slike brez vodnega žiga."},
  "sr": {"cta":"Pređi na PRO","credits":"Možeš i dalje da koristiš svoje kredite; preuzimanja bez vodenog žiga su uključena u PRO članstvo.","period":"Tvoja poslednja PRO pretplata, započeta {startDate}, istekla je {endDate}. Zato se ova slika preuzima sa vodenim žigom.","resub":"Ako želiš, možeš da pređeš na PRO i preuzimaš slike bez vodenog žiga."},
  "sw": {"cta":"Pata PRO","credits":"Unaweza kuendelea kutumia salio lako; kupakua bila watermark kumejumuishwa kwenye uanachama wa PRO.","period":"Uanachama wako wa mwisho wa PRO ulioanza tarehe {startDate} uliisha tarehe {endDate}. Ndiyo maana picha hii inapakuliwa ikiwa na watermark.","resub":"Ukipenda, unaweza kujiunga na PRO ili kupakua picha zako bila watermark yoyote."},
  "ta": {"cta":"PRO-விற்கு மேம்படுத்தவும்","credits":"உங்கள் கிரெடிட்களைத் தொடர்ந்து பயன்படுத்தலாம்; வாட்டர்மார்க் இல்லாத பதிவிறக்கங்கள் PRO சந்தாவில் அடங்கும்.","period":"{startDate} அன்று தொடங்கிய உங்கள் சமீபத்திய PRO சந்தா {endDate} அன்று முடிவடைந்தது. அதனால்தான் இந்தப் படம் வாட்டர்மார்க்குடன் பதிவிறக்கப்படுகிறது.","resub":"விருப்பமிருந்தால், வாட்டர்மார்க் இல்லாமல் படங்களைப் பதிவிறக்க நீங்கள் PRO-விற்கு மாறலாம்."},
  "te": {"cta":"PRO కి అప్‌గ్రేడ్ అవ్వండి","credits":"మీరు మీ క్రెడిట్‌లను వాడుకోవచ్చు; వాటర్‌మార్క్ లేని డౌన్‌లోడ్‌లు PRO మెంబర్‌షిప్‌తో లభిస్తాయి.","period":"{startDate}న ప్రారంభమైన మీ తాజా PRO మెంబర్‌షిప్ {endDate}తో ముగిసింది. అందుకే ఈ ఇమేజ్ వాటర్‌మార్క్‌తో డౌన్‌లోడ్ అవుతోంది.","resub":"మీకు నచ్చితే, వాటర్‌మార్క్ లేకుండా ఇమేజ్‌లను డౌన్‌లోడ్ చేసుకోవడానికి PRO కి మారవచ్చు."},
  "ur": {"cta":"PRO پر اپگریڈ کریں","credits":"آپ اپنے کریڈٹس کا استعمال جاری رکھ سکتے ہیں؛ واٹر مارک کے بغیر ڈاؤن لوڈز PRO ممبرشپ میں شامل ہیں۔","period":"آپ کی آخری PRO ممبرشپ جو {startDate} کو شروع ہوئی تھی، {endDate} کو ختم ہو گئی۔ اسی لیے یہ تصویر واٹر مارک کے ساتھ ڈاؤن لوڈ ہو رہی ہے۔","resub":"اگر آپ چاہیں تو واٹر مارک کے بغیر تصاویر ڈاؤن لوڈ کرنے کے لیے PRO پر سوئچ کر سکتے ہیں۔"},
  "uz": {"cta":"PRO-ga o‘tish","credits":"Kreditlaringizdan foydalanishda davom etishingiz mumkin; suv belgisiz yuklab olish PRO a'zoligiga kiritilgan.","period":"{startDate} sanasida boshlangan oxirgi PRO a'zoligingiz {endDate} sanasida yakunlandi. Shuning uchun ushbu rasm suv belgisi bilan yuklab olinmoqda.","resub":"Xohlasangiz, rasmlaringizni suv belgisiz yuklab olish uchun PRO tarifiga o‘tishingiz mumkin."},
  "zu": {"cta":"Thuthukela ku-PRO","credits":"Ungaqhubeka nokusebenzisa amakhredithi akho; ukulanda ngaphandle kwe-watermark kufakiwe kubulungu be-PRO.","period":"Ubulungu bakho bamuva be-PRO obuqale ngomhlaka-{startDate} buphele ngomhlaka-{endDate}. Yingakho lesi sithombe silandwa sine-watermark.","resub":"Uma uthanda, ungashintshela ku-PRO ukuze ulande izithombe zakho ngaphandle kwe-watermark."},
};

// Intl.DateTimeFormat için sözlük anahtarı → gerçek locale eşlemesi
const WATERMARK_INTL_LOCALE = { zh_tw: "zh-TW" };

function resolveWatermarkLanguage(rawLang) {
  const raw = String(rawLang || "").trim().toLowerCase();
  // Çince bölgesel ayrımı: Geleneksel (TW/HK/Hant) ayrı sözlük + ayrı font
  if (/^zh([-_](tw|hk|hant))/.test(raw)) return "zh_tw";
  const code = raw.split(/[-_]/)[0];
  if (!WATERMARK_I18N[code]) return "en";
  // Dilin fontu yüklenemediyse tofu basma — İngilizce'ye düş
  const requiredFont = WATERMARK_FONT_BY_LANG[code];
  if (requiredFont && !loadedWatermarkFonts.has(requiredFont)) return "en";
  return code;
}

// Kullanıcının SON abonelik dönemi — RevenueCat EXPIRATION kaydındaki
// purchased_at o dönemin başlangıcını taşır. Yeni kayıtlarda event_timestamp_ms
// bitiştir; eski webhook kayıtlarında bu kolon boş olduğundan EXPIRATION'ın
// sisteme ulaştığı created_at güvenli fallback olarak kullanılır. Kredi paketleri
// (NON_RENEWING) EXPIRATION üretmez. Kayıt yoksa dönem satırı gösterilmez.
async function getLastSubscriptionPeriod(userId) {
  try {
    if (!userId || userId === "anonymous_user") return null;
    // ⚠️ purchase_history.user_id TEXT tipinde (users.id uuid değil) — String'e çevir.
    const { data, error } = await supabase
      .from("purchase_history")
      .select("event_timestamp_ms, purchased_at, created_at")
      .eq("user_id", String(userId))
      .eq("event_type", "EXPIRATION")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const endMs = Number(data.event_timestamp_ms);
    const end = Number.isFinite(endMs) && endMs > 0
      ? new Date(endMs)
      : new Date(data.created_at);
    const start = data.purchased_at ? new Date(data.purchased_at) : null;
    if (Number.isNaN(end.getTime())) return null;
    return {
      start: start && !Number.isNaN(start.getTime()) ? start : null,
      end,
    };
  } catch (e) {
    console.warn("⚠️ [DOWNLOAD API] Abonelik bitişi okunamadı:", e?.message);
    return null;
  }
}

function formatWatermarkDate(date, lang) {
  try {
    return new Intl.DateTimeFormat(WATERMARK_INTL_LOCALE[lang] || lang, {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
  } catch (e) {
    return date.toISOString().slice(0, 10);
  }
}

// Metni ölçüp maxWidth'e sığan satırlara böler (kelime bazlı).
// ⚠️ Boşluksuz yazılan diller (ja/zh/th/km/lo) tek dev "kelime" üretir —
// kelime tek başına sığmıyorsa karakter bazlı bölünür (tofu değil taşma çözümü).
function wrapCanvasText(ctx, text, maxWidth) {
  const breakOversized = (word) => {
    if (ctx.measureText(word).width <= maxWidth) return [word];
    const chunks = [];
    let chunk = "";
    for (const ch of Array.from(word)) {
      if (chunk && ctx.measureText(chunk + ch).width > maxWidth) {
        chunks.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    if (chunk) chunks.push(chunk);
    return chunks;
  };

  const words = String(text)
    .split(/\s+/)
    .filter(Boolean)
    .flatMap(breakOversized);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Resme watermark ekleme fonksiyonu - Canvas ile
// localization: { lang, lastSubPeriod } — metinler kullanıcının dilinde basılır
async function addWatermarkToImage(imageSource, localization = {}) {
  try {
    const wmLang = resolveWatermarkLanguage(localization.lang);
    const wmTexts = {
      ...WATERMARK_I18N[wmLang],
      ...WATERMARK_FRIENDLY_I18N[wmLang],
    };
    // Latin dışı diller kendi Noto ailesiyle yazılır; DIRESS döşemesi ve kısa
    // PRO CTA'sı marka görünümü için Archivo Black ile basılır.
    const wmFontStack = watermarkFontStackFor(wmLang);
    const lastSubPeriod = localization.lastSubPeriod || null;
    // 🎁 Deneme sürecindeki kullanıcı da filigran alıyor (canDownloadOriginal =
    // is_pro && !is_in_trial) ama sebebi farklı: aboneliği bitmedi, HENÜZ
    // başlamadı. Ona "kredin seni PRO yapmaz / tekrar abone ol" demek yanlış.
    // 27 Ağu 2026, kullanıcı isteği.
    const isTrialWatermark = localization.isInTrial === true;
    console.log(
      `🎨 [DOWNLOAD API] Watermark ekleniyor (dil: ${wmLang}${lastSubPeriod?.end ? ", son abonelik: " + lastSubPeriod.end.toISOString().slice(0, 10) : ", abonelik geçmişi yok"}):`,
      Buffer.isBuffer(imageSource)
        ? `[işlenmiş buffer: ${imageSource.length} byte]`
        : imageSource,
    );

    // Normal indirmede URL, Refiner gibi önce format işleyen akışlarda
    // doğrudan Buffer kabul edilir. Böylece Refiner'ın çıktısına da aynı
    // merkezi filigran tasarımı ikinci bir geçici dosya oluşturmadan basılır.
    let imageBuffer;
    if (Buffer.isBuffer(imageSource)) {
      imageBuffer = imageSource;
    } else {
      const imageResponse = await axios.get(imageSource, {
        responseType: "arraybuffer",
        timeout: 30000,
      });
      imageBuffer = Buffer.from(imageResponse.data);
    }

    // Canvas ile resmi yükle
    const originalImage = await loadImage(imageBuffer);
    const imageWidth = originalImage.width;
    const imageHeight = originalImage.height;

    console.log(`🖼️ [DOWNLOAD API] Resim boyutu: ${imageWidth}x${imageHeight}`);

    // Canvas oluştur
    const canvas = createCanvas(imageWidth, imageHeight);
    const ctx = canvas.getContext("2d");

    // Anti-aliasing ayarları
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Orijinal resmi canvas'e çiz
    ctx.drawImage(originalImage, 0, 0, imageWidth, imageHeight);

    // Filigran ayarları
    const watermarkText = "DIRESS";
    const fontSize = Math.max(imageWidth * 0.032, 18);

    ctx.font = `${fontSize}px "${WATERMARK_FONT_FAMILY}"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const textWidth = ctx.measureText(watermarkText).width;

    // Yoğun döşeme: sabit 16 nokta yerine tüm yüzeyi kaplayan diagonal ızgara.
    // Kaymalı (staggered) satırlar sayesinde desen tekrar etmiyor gibi duruyor.
    const stepX = textWidth * 1.5;
    const stepY = fontSize * 2.6;
    // 45° dönüş sonrası köşelerin boş kalmaması için tuvali taşıracak kadar geniş tara
    const diagonal = Math.sqrt(imageWidth ** 2 + imageHeight ** 2);
    const startX = (imageWidth - diagonal) / 2;
    const startY = (imageHeight - diagonal) / 2;

    ctx.save();
    // Tüm ızgarayı tek seferde döndür — her yazı için ayrı rotate/restore yapmaktan hızlı
    ctx.translate(imageWidth / 2, imageHeight / 2);
    ctx.rotate(-Math.PI / 4);
    ctx.translate(-imageWidth / 2, -imageHeight / 2);

    ctx.shadowColor = "rgba(0, 0, 0, 0.22)";
    ctx.shadowBlur = 3;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = "#FFFFFF";
    ctx.globalAlpha = 0.16;

    let rowIndex = 0;
    let stamps = 0;
    for (let y = startY; y < startY + diagonal; y += stepY) {
      // Tek satırlar yarım adım kaydırılır → şaşırtmalı (tuğla) düzen
      const offsetX = rowIndex % 2 === 0 ? 0 : stepX / 2;
      for (let x = startX + offsetX; x < startX + diagonal; x += stepX) {
        ctx.fillText(watermarkText, x, y);
        stamps++;
      }
      rowIndex++;
    }
    ctx.restore();

    console.log(`🎨 [DOWNLOAD API] ${stamps} filigran basıldı (font ${Math.round(fontSize)}px)`);

    // 14 duraklı kosinüs-ease alfa — düz iki duraklı fade bant kenarında çizgi bırakıyor
    const FADE_STOPS = [
      [0.0, 0.0], [0.077, 0.015], [0.154, 0.057], [0.231, 0.126],
      [0.308, 0.216], [0.385, 0.323], [0.462, 0.44], [0.538, 0.56],
      [0.615, 0.677], [0.692, 0.784], [0.769, 0.874], [0.846, 0.943],
      [0.923, 0.985], [1.0, 1.0],
    ];

    // Telif + yapay zeka uyarısı — kaldırmanın hem yasak hem suç olduğunu
    // hem insana hem AI düzenleyicilere bildirir (DMCA §1202 / FSEK 71).
    // 🌍 Metin kullanıcının dilinde; genişliğe göre dinamik sarılır (sabit iki
    // satır değil — çeviri uzunlukları dile göre değişiyor).
    const noticeFontSize = Math.max(imageWidth * 0.019, 11);
    const noticeLineHeight = noticeFontSize * 1.42;
    const noticeTop = Math.round(
      Math.max(imageHeight * 0.028, noticeFontSize * 1.6)
    );
    ctx.font = `${noticeFontSize}px ${wmFontStack}`;
    const noticeLines = [
      "© Diress · diress.ai",
      ...wrapCanvasText(ctx, wmTexts.notice, imageWidth * 0.92),
    ];

    // ÜST bant: siyahtan şeffafa (aşağı doğru açılır) — satır sayısına göre
    // yükseklik büyür ki uzun çeviriler bandın dışına sarkmasın
    const topBandHeight = Math.round(
      Math.max(
        imageHeight * 0.14,
        noticeTop + noticeLines.length * noticeLineHeight + noticeLineHeight * 1.6,
      )
    );
    const topGradient = ctx.createLinearGradient(0, 0, 0, topBandHeight);
    FADE_STOPS.forEach(([stop, alpha]) => {
      // Ters çevrilir: tepede opak, aşağı inerken şeffaflaşır
      topGradient.addColorStop(stop, `rgba(0,0,0,${((1 - alpha) * 0.85).toFixed(3)})`);
    });
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = topGradient;
    ctx.fillRect(0, 0, imageWidth, topBandHeight);
    ctx.restore();

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
    noticeLines.forEach((line, index) => {
      // İlk satır marka: biraz daha büyük ve tam opak; uyarı satırları hafif soluk
      const isBrand = index === 0;
      ctx.font = isBrand
        ? `${noticeFontSize * 1.12}px "${WATERMARK_FONT_FAMILY}"`
        : `${noticeFontSize}px ${wmFontStack}`;
      ctx.globalAlpha = isBrand ? 0.95 : 0.8;
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(
        line,
        imageWidth / 2,
        noticeTop + index * noticeLineHeight + (isBrand ? 0 : noticeLineHeight * 0.12)
      );
    });
    ctx.restore();

    // ALT bant: şeffaftan siyaha gradient + app ikonu + PRO çağrısı
    const shortEdge = Math.min(imageWidth, imageHeight);
    const iconSize = Math.round(shortEdge * 0.135);
    const ctaGap = Math.round(shortEdge * 0.022); // ikon ile yazı arası
    const bottomGap = Math.round(shortEdge * 0.045); // yazının altındaki pay

    // CTA yazısı: çevirisi bulunan dilde gösterilir; diğer diller mevcut
    // İngilizce fallback'i kullanır. Tek satırdır, sığmazsa punto küçülür.
    const ctaText = wmTexts.cta || "UPGRADE TO PRO";
    let ctaFontSize = Math.round(shortEdge * 0.045);
    ctx.font = `${ctaFontSize}px "${WATERMARK_FONT_FAMILY}"`;
    const maxCtaWidth = imageWidth * 0.82;
    if (ctx.measureText(ctaText).width > maxCtaWidth) {
      ctaFontSize = Math.floor(
        ctaFontSize * (maxCtaWidth / ctx.measureText(ctaText).width)
      );
      ctx.font = `${ctaFontSize}px "${WATERMARK_FONT_FAMILY}"`;
    }

    // 🌍 CTA altı açıklama (13 Ağu 2026, kullanıcı isteği): kredi ≠ PRO aboneliği,
    // varsa son abonelik döneminin başlangıç/bitiş tarihi ve yeniden abonelik çağrısı —
    // kullanıcının dilinde, genişliğe göre sarılmış küçük satırlar.
    const infoFontSize = Math.max(Math.round(ctaFontSize * 0.44), 11);
    const infoLineHeight = infoFontSize * 1.45;
    const infoGap = Math.round(ctaGap * 0.9); // CTA ile açıklama arası
    // Denemedeki kullanıcıya iki satır: neredesin + PRO'da ne kazanırsın.
    // Abonelik geçmişi satırları (expired/period/resub) burada BASILMAZ —
    // denemede henüz sona ermiş bir abonelik yok.
    const infoSourceLines = isTrialWatermark
      ? [
          wmTexts.trialStatus || WATERMARK_I18N.en.trialStatus,
          wmTexts.trialBenefit || WATERMARK_I18N.en.trialBenefit,
        ]
      : [wmTexts.credits];
    if (!isTrialWatermark) {
      if (lastSubPeriod?.end) {
        if (lastSubPeriod.start && wmTexts.period) {
          infoSourceLines.push(
            wmTexts.period
              .replace(
                "{startDate}",
                formatWatermarkDate(lastSubPeriod.start, wmLang),
              )
              .replace(
                "{endDate}",
                formatWatermarkDate(lastSubPeriod.end, wmLang),
              ),
          );
        } else {
          infoSourceLines.push(
            wmTexts.expired.replace(
              "{date}",
              formatWatermarkDate(lastSubPeriod.end, wmLang),
            ),
          );
        }
      }
      infoSourceLines.push(wmTexts.resub);
    }
    ctx.font = `${infoFontSize}px ${wmFontStack}`;
    const infoLines = infoSourceLines.flatMap((line) =>
      wrapCanvasText(ctx, line, imageWidth * 0.88),
    );
    const infoBlockHeight = infoGap + infoLines.length * infoLineHeight;

    const blockHeight = iconSize + ctaGap + ctaFontSize + infoBlockHeight;
    // Bant, içeriği rahat sarmalayacak kadar yüksek olsun
    const bandHeight = Math.round(
      Math.max(imageHeight * 0.16, blockHeight + bottomGap * 2.4)
    );
    const bandTop = imageHeight - bandHeight;
    const bandGradient = ctx.createLinearGradient(0, bandTop, 0, imageHeight);
    FADE_STOPS.forEach(([stop, alpha]) => {
      bandGradient.addColorStop(stop, `rgba(0,0,0,${(alpha * 0.85).toFixed(3)})`);
    });
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = bandGradient;
    ctx.fillRect(0, bandTop, imageWidth, bandHeight);
    ctx.restore();

    const blockTop = imageHeight - bottomGap - blockHeight;

    // App ikonu — iOS köşe yuvarlaklığında
    if (appIconImage) {
      const iconX = Math.round((imageWidth - iconSize) / 2);
      const iconY = blockTop;
      const radius = iconSize * 0.225; // iOS squircle'a yakın oran

      ctx.save();
      ctx.beginPath();
      // Yuvarlatılmış dikdörtgen yolu (roundRect eski canvas sürümlerinde yok)
      ctx.moveTo(iconX + radius, iconY);
      ctx.lineTo(iconX + iconSize - radius, iconY);
      ctx.quadraticCurveTo(iconX + iconSize, iconY, iconX + iconSize, iconY + radius);
      ctx.lineTo(iconX + iconSize, iconY + iconSize - radius);
      ctx.quadraticCurveTo(iconX + iconSize, iconY + iconSize, iconX + iconSize - radius, iconY + iconSize);
      ctx.lineTo(iconX + radius, iconY + iconSize);
      ctx.quadraticCurveTo(iconX, iconY + iconSize, iconX, iconY + iconSize - radius);
      ctx.lineTo(iconX, iconY + radius);
      ctx.quadraticCurveTo(iconX, iconY, iconX + radius, iconY);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(appIconImage, iconX, iconY, iconSize, iconSize);
      ctx.restore();
    }

    // PRO çağrısı — ikonun altında
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = `${ctaFontSize}px "${WATERMARK_FONT_FAMILY}"`;
    ctx.globalAlpha = 1;
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(ctaText, imageWidth / 2, blockTop + iconSize + ctaGap);

    // 🌍 Açıklama satırları — CTA'nın hemen altında, daha küçük ve hafif soluk
    ctx.font = `${infoFontSize}px ${wmFontStack}`;
    ctx.globalAlpha = 0.85;
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
    const infoTop = blockTop + iconSize + ctaGap + ctaFontSize + infoGap;
    infoLines.forEach((line, index) => {
      ctx.fillText(line, imageWidth / 2, infoTop + index * infoLineHeight);
    });
    ctx.restore();

    // Canvas'ı buffer'a çevir
    const watermarkedBuffer = canvas.toBuffer("image/png");
    console.log("✅ [DOWNLOAD API] Watermark eklendi, buffer boyutu:", watermarkedBuffer.length);

    return watermarkedBuffer;

  } catch (error) {
    console.error("❌ [DOWNLOAD API] Watermark ekleme hatası:", error);
    throw error;
  }
}

const DOWNLOAD_FORMATS = new Set(["jpg", "jpeg", "png", "webp", "pdf"]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeSvgText(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeAiBadgeLabel(value) {
  const normalized = String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 36);
  return normalized || "AI GENERATED";
}

function normalizeAiBadgeStyle(value) {
  return String(value || "").toLowerCase() === "background"
    ? "background"
    : "minimal";
}

function createAiGeneratedBadgeSvg(width, height, requestedLabel, requestedStyle) {
  const shortEdge = Math.min(width, height);
  const margin = Math.round(clamp(shortEdge * 0.024, 12, 42));
  const badgeHeight = Math.round(clamp(shortEdge * 0.058, 38, 88));
  const label = normalizeAiBadgeLabel(requestedLabel);
  const labelFontSize = Math.round(badgeHeight * 0.28);
  const estimatedLabelWidth = label.length * labelFontSize * 0.61;
  const badgeWidth = Math.round(
    Math.min(
      width - margin * 2,
      clamp(badgeHeight * 1.25 + estimatedLabelWidth, 146, 430)
    )
  );
  const x = Math.max(margin, width - margin - badgeWidth);
  const y = Math.max(margin, height - margin - badgeHeight);
  const radius = Math.round(badgeHeight * 0.24);
  const iconSize = Math.round(badgeHeight * 0.68);
  const iconX = Math.round(badgeHeight * 0.16);
  const iconY = Math.round((badgeHeight - iconSize) / 2);
  const iconRadius = Math.round(iconSize * 0.24);
  const iconFontSize = Math.round(iconSize * 0.4);
  const labelX = iconX + iconSize + Math.round(badgeHeight * 0.17);
  const labelY = badgeHeight / 2 + labelFontSize * 0.34;
  const badgeStyle = normalizeAiBadgeStyle(requestedStyle);
  const escapedLabel = escapeSvgText(label);
  const badgeBody = badgeStyle === "minimal"
    ? `
      <defs>
        <filter id="textShadow" x="-30%" y="-30%" width="170%" height="170%">
          <feDropShadow dx="1.4" dy="1.4" stdDeviation="1.8" flood-color="#000000" flood-opacity="0.82" />
        </filter>
      </defs>
      <g filter="url(#textShadow)">
        <rect x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" rx="${iconRadius}"
          fill="#FFFFFF" fill-opacity="0.10" stroke="#FFFFFF" stroke-opacity="0.82" stroke-width="1" />
        <text x="${iconX + iconSize / 2}" y="${iconY + iconSize / 2 + iconFontSize * 0.34}"
          text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${iconFontSize}"
          font-weight="800" fill="#FFFFFF">AI</text>
        <text x="${labelX}" y="${labelY}" font-family="Arial, Helvetica, sans-serif"
          font-size="${labelFontSize}" font-weight="700" letter-spacing="${Math.max(0.2, labelFontSize * 0.025)}"
          fill="#FFFFFF">${escapedLabel}</text>
      </g>`
    : `
      <rect x="0.5" y="0.5" width="${badgeWidth - 1}" height="${badgeHeight - 1}" rx="${radius}"
        fill="#111827" fill-opacity="0.56" />
      <rect x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" rx="${iconRadius}"
        fill="#FFFFFF" fill-opacity="0.10" stroke="#FFFFFF" stroke-opacity="0.82" stroke-width="1" />
      <text x="${iconX + iconSize / 2}" y="${iconY + iconSize / 2 + iconFontSize * 0.34}"
        text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${iconFontSize}"
        font-weight="800" fill="#FFFFFF">AI</text>
      <text x="${labelX}" y="${labelY}" font-family="Arial, Helvetica, sans-serif"
        font-size="${labelFontSize}" font-weight="700" letter-spacing="${Math.max(0.2, labelFontSize * 0.025)}"
        fill="#FFFFFF">${escapedLabel}</text>`;

  return {
    input: Buffer.from(`
    <svg width="${badgeWidth}" height="${badgeHeight}" viewBox="0 0 ${badgeWidth} ${badgeHeight}" xmlns="http://www.w3.org/2000/svg">
      ${badgeBody}
    </svg>
  `),
    left: x,
    top: y,
  };
}

async function renderConfiguredDownload({
  imageUrl,
  addSubscriptionWatermark,
  addAiBadge,
  aiLabel,
  aiBadgeStyle,
  format,
  quality,
  watermarkLocalization = {},
}) {
  let imageBuffer;
  if (addSubscriptionWatermark) {
    imageBuffer = await addWatermarkToImage(imageUrl, watermarkLocalization);
  } else {
    const imageResponse = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
    });
    imageBuffer = Buffer.from(imageResponse.data);
  }

  let pipeline = sharp(imageBuffer).rotate();
  const metadata = await pipeline.metadata();

  if (addAiBadge && metadata.width && metadata.height) {
    const aiBadgeSvg = createAiGeneratedBadgeSvg(
      metadata.width,
      metadata.height,
      aiLabel,
      aiBadgeStyle
    );
    pipeline = pipeline.composite([aiBadgeSvg]);
  }

  const normalizedFormat = format === "jpeg" ? "jpg" : format;
  if (normalizedFormat === "pdf") {
    // PDF'e aktarılacak raster katmanı önce seçilen kaliteyle hazırlanır;
    // böylece abonelik filigranı ve AI etiketi PDF'in içinde de korunur.
    const rasterBuffer = await pipeline
      .flatten({ background: "#FFFFFF" })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    const rasterImage = await loadImage(rasterBuffer);
    const pdfWidth = metadata.width || rasterImage.width;
    const pdfHeight = metadata.height || rasterImage.height;
    const pdfCanvas = createCanvas(pdfWidth, pdfHeight, "pdf");
    const pdfContext = pdfCanvas.getContext("2d");
    pdfContext.drawImage(rasterImage, 0, 0, pdfWidth, pdfHeight);

    return {
      buffer: pdfCanvas.toBuffer("application/pdf"),
      format: "pdf",
    };
  } else if (normalizedFormat === "png") {
    pipeline = pipeline.png({ compressionLevel: quality >= 94 ? 7 : 9 });
  } else if (normalizedFormat === "webp") {
    pipeline = pipeline.webp({ quality, effort: 5 });
  } else {
    pipeline = pipeline.jpeg({ quality, mozjpeg: true });
  }

  return {
    buffer: await pipeline.toBuffer(),
    format: normalizedFormat,
  };
}

// Download endpoint - Pro kontrolü ile
router.get("/image", async (req, res) => {
  try {
    const { imageUrl, userId } = req.query;
    const requestedFormatRaw = String(req.query.format || "").toLowerCase();
    const hasFormatOverride = DOWNLOAD_FORMATS.has(requestedFormatRaw);
    const requestedFormat = hasFormatOverride
      ? (requestedFormatRaw === "jpeg" ? "jpg" : requestedFormatRaw)
      : "png";
    const parsedQuality = Number.parseInt(req.query.quality, 10);
    const hasQualityOverride = Number.isFinite(parsedQuality);
    const quality = clamp(hasQualityOverride ? parsedQuality : 96, 60, 100);
    const addAiBadge = String(req.query.aiBadge || "").toLowerCase() === "true";
    const aiLabel = normalizeAiBadgeLabel(req.query.aiLabel);
    const aiBadgeStyle = normalizeAiBadgeStyle(req.query.aiBadgeStyle);

    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        message: "Image URL gereklidir",
      });
    }

    console.log("📥 [DOWNLOAD API] İndirme isteği:", {
      imageUrl: imageUrl.substring(0, 50) + "...",
      userId: userId?.slice(0, 8) || "anonymous",
      format: requestedFormat,
      quality,
      aiBadge: addAiBadge,
    });

    // Paid Pro / trial ayrımını backend DB kaydından doğrula.
    const downloadAccess = await checkUserDownloadAccess(userId);
    console.log("👤 [DOWNLOAD API] User download access:", downloadAccess);

    const needsConfiguredOutput = addAiBadge || hasFormatOverride || hasQualityOverride;

    if (downloadAccess.canDownloadOriginal && !needsConfiguredOutput) {
      // Yalnızca ücretli Pro kullanıcı - orijinal resmi redirect et
      console.log("💎 [DOWNLOAD API] Ücretli Pro kullanıcı - orijinal resim redirect");
      return res.redirect(imageUrl);
    } else {
      // Free/trial abonelik filigranı ile; ücretli Pro ise yalnız seçilen
      // format, kalite ve AI şeffaflık etiketi ile işlenir.
      const addSubscriptionWatermark = !downloadAccess.canDownloadOriginal;
      console.log(
        `🎨 [DOWNLOAD API] İşleniyor: subscriptionWatermark=${addSubscriptionWatermark}, aiBadge=${addAiBadge}, format=${requestedFormat}`
      );

      // 🌍 Filigran dili: istemci ?lang= gönderirse o, yoksa users.preferred_language;
      // son abonelik bitişi yalnız filigran basılacaksa sorgulanır (fazladan sorgu yok).
      let watermarkLocalization = {};
      if (addSubscriptionWatermark) {
        watermarkLocalization = {
          lang: req.query.lang || downloadAccess.preferredLanguage,
          lastSubPeriod: await getLastSubscriptionPeriod(userId),
          // Denemedeki kullanıcı farklı metin görür (bkz. isTrialWatermark)
          isInTrial: downloadAccess.isInTrial === true,
        };
      }

      const configured = await renderConfiguredDownload({
        imageUrl,
        addSubscriptionWatermark,
        addAiBadge,
        aiLabel,
        aiBadgeStyle,
        format: requestedFormat,
        quality,
        watermarkLocalization,
      });
      const contentTypes = {
        jpg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
        pdf: "application/pdf",
      };

      res.setHeader("Content-Type", contentTypes[configured.format] || "image/jpeg");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=diress_image.${configured.format}`
      );
      res.setHeader("Cache-Control", "no-cache");

      console.log("✅ [DOWNLOAD API] Ayarlanmış indirme gönderiliyor");
      return res.send(configured.buffer);
    }

  } catch (error) {
    console.error("❌ [DOWNLOAD API] Download hatası:", error);
    return res.status(500).json({
      success: false,
      message: "Download işlemi sırasında hata oluştu",
      error: error.message,
    });
  }
});

module.exports = router;
// Refiner gibi özel format endpoint'leri de normal indirme kapısıyla aynı
// sunucu-doğrulamalı PRO/trial kararını ve filigran renderer'ını kullanır.
// Router fonksiyonu üzerindeki bu property'ler Express mount davranışını bozmaz.
module.exports.checkUserDownloadAccess = checkUserDownloadAccess;
module.exports.getLastSubscriptionPeriod = getLastSubscriptionPeriod;
module.exports.addWatermarkToImage = addWatermarkToImage;
