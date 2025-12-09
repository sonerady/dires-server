const cron = require("node-cron");
const { supabase } = require("../supabaseClient");
const { Expo } = require("expo-server-sdk");

const expo = new Expo();

// Günlük bildirim içerikleri (Multilingual)
const dailyMessages = {
    1: { // Pazartesi
        tr: { title: "Ürünlerini saniyeler içinde mankene giydir! ⚡️", body: "Tek fotoğraf yüklemen yeterli; Diress gerisini otomatik yapar." },
        en: { title: "Dress your products on a model in seconds! ⚡️", body: "Just upload a single photo; Diress does the rest automatically." },
        de: { title: "Kleiden Sie Ihre Produkte in Sekunden an einem Model! ⚡️", body: "Laden Sie einfach ein Foto hoch; Diress erledigt den Rest automatisch." },
        es: { title: "¡Viste tus productos en un modelo en segundos! ⚡️", body: "Solo sube una foto; Diress hace el resto automáticamente." },
        fr: { title: "Habillez vos produits sur un mannequin en quelques secondes ! ⚡️", body: "Téléchargez juste une photo ; Diress fait le reste automatiquement." },
        it: { title: "Vesti i tuoi prodotti su un modello in pochi secondi! ⚡️", body: "Carica solo una foto; Diress fa il resto automaticamente." },
        ja: { title: "数秒で商品をモデルに着せましょう！⚡️", body: "写真を1枚アップロードするだけ。あとはDiressが自動で行います。" },
        ko: { title: "몇 초 만에 모델에게 제품을 입혀보세요! ⚡️", body: "사진 한 장만 업로드하세요. 나머지는 Diress가 자동으로 처리합니다." },
        pt: { title: "Vista seus produtos em um modelo em segundos! ⚡️", body: "Basta enviar uma foto; o Diress faz o resto automaticamente." },
        ru: { title: "Оденьте свои товары на модель за секунды! ⚡️", body: "Просто загрузите одно фото; Diress сделает остальное автоматически." },
        zh: { title: "几秒钟内将您的产品穿在模特身上！⚡️", body: "只需上传一张照片；Diress 会自动完成剩下的工作。" }
    },
    2: { // Salı
        tr: { title: "Mankensiz çekim mi olur? Olur! 😄", body: "Ürünlerini yükle, saniyeler içinde gerçekçi bir model üzerinde gör." },
        en: { title: "Photoshoot without a model? Yes, it's possible! 😄", body: "Upload your products, see them on a realistic model in seconds." },
        de: { title: "Fotoshooting ohne Model? Ja, das geht! 😄", body: "Laden Sie Ihre Produkte hoch, sehen Sie sie in Sekunden an einem realistischen Model." },
        es: { title: "¿Sesión de fotos sin modelo? ¡Sí, es posible! 😄", body: "Sube tus productos, velos en un modelo realista en segundos." },
        fr: { title: "Shooting sans mannequin ? C'est possible ! 😄", body: "Téléchargez vos produits, voyez-les sur un mannequin réaliste en quelques secondes." },
        it: { title: "Servizio fotografico senza modella? Sì, è possibile! 😄", body: "Carica i tuoi prodotti, vedili su un modello realistico in pochi secondi." },
        ja: { title: "モデルなしの写真撮影？はい、可能です！😄", body: "商品をアップロードして、数秒でリアルなモデルに着せてみましょう。" },
        ko: { title: "모델 없는 화보 촬영? 가능합니다! 😄", body: "제품을 업로드하고 몇 초 만에 현실적인 모델 착용 샷을 확인하세요." },
        pt: { title: "Sessão de fotos sem modelo? Sim, é possível! 😄", body: "Envie seus produtos, veja-os em um modelo realista em segundos." },
        ru: { title: "Фотосессия без модели? Да, это возможно! 😄", body: "Загрузите свои товары, увидите их на реалистичной модели за секунды." },
        zh: { title: "没有模特的拍摄？是的，这可能！😄", body: "上传您的产品，几秒钟内即可在逼真的模特身上看到效果。" }
    },
    3: { // Çarşamba
        tr: { title: "Kıyafetlerini denemeden görmek ister misin? 👗✨", body: "Diress ürününü anında seçtiğin mankene giydirir." },
        en: { title: "Want to see your clothes without trying them on? 👗✨", body: "Diress instantly dresses your product on the model you choose." },
        de: { title: "Möchten Sie Ihre Kleidung sehen, ohne sie anzuprobieren? 👗✨", body: "Diress zieht Ihr Produkt sofort dem von Ihnen gewählten Model an." },
        es: { title: "¿Quieres ver tu ropa sin probártela? 👗✨", body: "Diress viste instantáneamente tu producto en el modelo que elijas." },
        fr: { title: "Vous voulez voir vos vêtements sans les essayer ? 👗✨", body: "Diress habille instantanément votre produit sur le mannequin de votre choix." },
        it: { title: "Vuoi vedere i tuoi vestiti senza provarli? 👗✨", body: "Diress veste istantaneamente il tuo prodotto sul modello che scegli." },
        ja: { title: "試着せずに服を見たいですか？👗✨", body: "Diressは、選んだモデルに商品を即座に着せます。" },
        ko: { title: "입어보지 않고 옷을 확인하고 싶으신가요? 👗✨", body: "Diress는 선택한 모델에게 즉시 제품을 입혀줍니다." },
        pt: { title: "Quer ver suas roupas sem experimentá-las? 👗✨", body: "O Diress veste instantaneamente seu produto no modelo que você escolher." },
        ru: { title: "Хотите увидеть одежду, не примеряя ее? 👗✨", body: "Diress мгновенно наденет ваш товар на выбранную вами модель." },
        zh: { title: "想不试穿就看衣服效果吗？👗✨", body: "Diress 会立即将您的产品穿在您选择的模特身上。" }
    },
    4: { // Perşembe
        tr: { title: "Profesyonel çekime gerek yok! ⚡️", body: "Ürünü yükle, saniyeler içinde katalog kalitesinde model görseli al." },
        en: { title: "No need for a professional shoot! ⚡️", body: "Upload the product, get catalog-quality model images in seconds." },
        de: { title: "Kein professionelles Shooting nötig! ⚡️", body: "Produkt hochladen, in Sekunden Bilder in Katalogqualität erhalten." },
        es: { title: "¡No hace falta una sesión profesional! ⚡️", body: "Sube el producto, obtén imágenes de modelo con calidad de catálogo en segundos." },
        fr: { title: "Pas besoin d'un shooting professionnel ! ⚡️", body: "Téléchargez le produit, obtenez des images de mannequin de qualité catalogue en quelques secondes." },
        it: { title: "Non serve un servizio professionale! ⚡️", body: "Carica il prodotto, ottieni immagini di modelli di qualità catalogo in pochi secondi." },
        ja: { title: "プロの撮影は不要です！⚡️", body: "商品をアップロードするだけで、数秒でカタログ品質のモデル画像を取得できます。" },
        ko: { title: "전문 촬영이 필요 없습니다! ⚡️", body: "제품을 업로드하고 몇 초 만에 카탈로그 품질의 모델 이미지를 얻으세요." },
        pt: { title: "Não precisa de sessão profissional! ⚡️", body: "Envie o produto, obtenha imagens de modelo com qualidade de catálogo em segundos." },
        ru: { title: "Профессиональная съемка не нужна! ⚡️", body: "Загрузите товар, получите изображения модели каталожного качества за секунды." },
        zh: { title: "无需专业拍摄！⚡️", body: "上传产品，几秒钟内获得目录级质量的模特图片。" }
    },
    5: { // Cuma
        tr: { title: "Hafta bitmeden ürünlerini mankende gör! 🧡", body: "Birkaç saniyede gerçekçi pozlar ve mükemmel ışıklandırma seni bekliyor." },
        en: { title: "See your products on a model before the week ends! 🧡", body: "Realistic poses and perfect lighting await you in just a few seconds." },
        de: { title: "Sehen Sie Ihre Produkte noch vor Wochenende am Model! 🧡", body: "Realistische Posen und perfekte Beleuchtung erwarten Sie in wenigen Sekunden." },
        es: { title: "¡Ve tus productos en un modelo antes de que acabe la semana! 🧡", body: "Poses realistas e iluminación perfecta te esperan en unos segundos." },
        fr: { title: "Voyez vos produits sur un mannequin avant la fin de la semaine ! 🧡", body: "Des poses réalistes et un éclairage parfait vous attendent en quelques secondes." },
        it: { title: "Vedi i tuoi prodotti su un modello prima che finisca la settimana! 🧡", body: "Pose realistiche e illuminazione perfetta ti aspettano in pochi secondi." },
        ja: { title: "週末になる前に商品をモデルで確認しましょう！🧡", body: "数秒でリアルなポーズと完璧なライティングがあなたを待っています。" },
        ko: { title: "주말이 오기 전에 모델 착용 샷을 확인하세요! 🧡", body: "몇 초 만에 현실적인 포즈와 완벽한 조명을 만나보세요." },
        pt: { title: "Veja seus produtos em um modelo antes que a semana acabe! 🧡", body: "Poses realistas e iluminação perfeita esperam por você em poucos segundos." },
        ru: { title: "Увидьте свои товары на модели до конца недели! 🧡", body: "Реалистичные позы и идеальное освещение ждут вас всего через несколько секунд." },
        zh: { title: "在周末之前在模特身上看到您的产品！🧡", body: "几秒钟内即可获得逼真的姿势和完美的灯光。" }
    },
    6: { // Cumartesi
        tr: { title: "Bugün ürünlerini mankene giydirip dene! 😊", body: "Yükle–seç–oluştur… Hepsi birkaç saniye içinde tamamlanıyor." },
        en: { title: "Try dressing your products on a model today! 😊", body: "Upload–Select–Create… All completed in a few seconds." },
        de: { title: "Probieren Sie heute aus, Ihre Produkte einem Model anzuziehen! 😊", body: "Hochladen–Auswählen–Erstellen… Alles in wenigen Sekunden erledigt." },
        es: { title: "¡Prueba a vestir tus productos en un modelo hoy! 😊", body: "Subir–Seleccionar–Crear… Todo completado en unos segundos." },
        fr: { title: "Essayez d'habiller vos produits sur un mannequin aujourd'hui ! 😊", body: "Télécharger–Sélectionner–Créer… Tout est terminé en quelques secondes." },
        it: { title: "Prova a vestire i tuoi prodotti su un modello oggi! 😊", body: "Carica–Seleziona–Crea… Tutto completato in pochi secondi." },
        ja: { title: "今日、商品をモデルに着せてみましょう！😊", body: "アップロード–選択–作成… すべて数秒で完了します。" },
        ko: { title: "오늘 제품을 모델에게 입혀보세요! 😊", body: "업로드–선택–생성… 모든 과정이 몇 초 안에 완료됩니다." },
        pt: { title: "Experimente vestir seus produtos em um modelo hoje! 😊", body: "Enviar–Selecionar–Criar… Tudo concluído em poucos segundos." },
        ru: { title: "Попробуйте надеть свои товары на модель сегодня! 😊", body: "Загрузить–Выбрать–Создать… Все готово за несколько секунд." },
        zh: { title: "今天尝试将您的产品穿在模特身上！😊", body: "上传–选择–创建… 全部在几秒钟内完成。" }
    },
    0: { // Pazar
        tr: { title: "Yeni haftaya güçlü başla: Ürünlerini mankende gör! 📸✨", body: "Saniyeler içinde profesyonel görünüm için şimdi oluşturmayı dene." },
        en: { title: "Start the new week strong: See your products on a model! 📸✨", body: "Try creating now for a professional look in seconds." },
        de: { title: "Starten Sie stark in die neue Woche: Sehen Sie Ihre Produkte am Model! 📸✨", body: "Versuchen Sie jetzt, in Sekunden einen professionellen Look zu erstellen." },
        es: { title: "Empieza fuerte la semana: ¡Ve tus productos en un modelo! 📸✨", body: "Prueba a crear ahora para un look profesional en segundos." },
        fr: { title: "Commencez la semaine en force : Voyez vos produits sur un mannequin ! 📸✨", body: "Essayez de créer maintenant pour un look professionnel en quelques secondes." },
        it: { title: "Inizia la nuova settimana alla grande: Vedi i tuoi prodotti su un modello! 📸✨", body: "Prova a creare ora per un look professionale in pochi secondi." },
        ja: { title: "新しい週を力強くスタート：商品をモデルで確認！📸✨", body: "今すぐ作成して、数秒でプロフェッショナルな外観を手に入れましょう。" },
        ko: { title: "새로운 한 주를 힘차게 시작하세요: 모델 착용 샷 확인! 📸✨", body: "지금 생성하여 몇 초 만에 전문적인 룩을 완성해보세요." },
        pt: { title: "Comece a nova semana com força: Veja seus produtos em um modelo! 📸✨", body: "Experimente criar agora para um visual profissional em segundos." },
        ru: { title: "Начните новую неделю мощно: Увидьте свои товары на модели! 📸✨", body: "Попробуйте создать сейчас для профессионального вида за секунды." },
        zh: { title: "强势开启新的一周：在模特身上看到您的产品！📸✨", body: "立即尝试创建，几秒钟内获得专业外观。" }
    }
};

const startScheduler = () => {
    console.log("⏰ [SCHEDULER] Günlük bildirim zamanlayıcısı başlatıldı (Her gün 15:00 UTC / 18:00 TRT)");

    // Her gün saat 15:00 UTC'de çalış (Türkiye saati ile 18:00)
    cron.schedule("0 15 * * *", async () => {
        console.log("⏰ [SCHEDULER] Günlük bildirim görevi tetiklendi...");

        try {
            const today = new Date().getDay(); // 0 (Pazar) - 6 (Cumartesi)
            const messages = dailyMessages[today];

            if (!messages) {
                console.error("❌ [SCHEDULER] Bugün için mesaj bulunamadı!");
                return;
            }

            // Hedef kitleyi seç:
            // 1. Push token'ı olan
            // 2. Pro olmayan (is_pro false veya null)
            // 3. Kredisi 40 veya daha az olan
            const { data: users, error } = await supabase
                .from("users")
                .select("id, push_token, preferred_language, credit_balance")
                .not("push_token", "is", null)
                .or("is_pro.eq.false,is_pro.is.null")
                .lte("credit_balance", 40);

            if (error) {
                console.error("❌ [SCHEDULER] Kullanıcı listesi alınamadı:", error);
                return;
            }

            if (!users || users.length === 0) {
                console.log("ℹ️ [SCHEDULER] Hedef kitleye uygun kullanıcı bulunamadı.");
                return;
            }

            console.log(`📢 [SCHEDULER] ${users.length} kullanıcıya bildirim gönderilecek.`);

            const notifications = [];

            for (const user of users) {
                if (!Expo.isExpoPushToken(user.push_token)) {
                    continue;
                }

                // Kullanıcının dilini belirle (varsayılan: en)
                let lang = user.preferred_language || "en";
                // Desteklenmeyen dil ise 'en' kullan
                if (!messages[lang]) {
                    lang = "en";
                }

                const content = messages[lang];

                notifications.push({
                    to: user.push_token,
                    sound: "default",
                    title: content.title,
                    body: content.body,
                    data: { type: "daily_reminder" },
                });
            }

            // Bildirimleri chunk'lar halinde gönder
            const chunks = expo.chunkPushNotifications(notifications);
            let successCount = 0;
            let errorCount = 0;

            for (const chunk of chunks) {
                try {
                    await expo.sendPushNotificationsAsync(chunk);
                    successCount += chunk.length;
                } catch (error) {
                    console.error("❌ [SCHEDULER] Chunk gönderim hatası:", error);
                    errorCount += chunk.length;
                }
            }

            console.log(`✅ [SCHEDULER] Görev tamamlandı. Başarılı: ${successCount}, Hatalı: ${errorCount}`);

        } catch (error) {
            console.error("❌ [SCHEDULER] Genel hata:", error);
        }
    });
};

module.exports = { startScheduler };
