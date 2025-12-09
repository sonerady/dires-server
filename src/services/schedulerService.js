const cron = require("node-cron");
const { supabase } = require("../supabaseClient");
const { Expo } = require("expo-server-sdk");

const expo = new Expo();

// Günlük bildirim içerikleri (Multilingual)
const dailyMessages = {
    1: { // Pazartesi
        tr: { title: "Saniyeler İçinde Mankene Giydir! ⚡️", body: "Tek fotoğraf yüklemen yeterli; Diress gerisini otomatik yapar." },
        en: { title: "Dress on Model in Seconds! ⚡️", body: "Just upload a single photo; Diress does the rest automatically." },
        de: { title: "In Sekunden am Model! ⚡️", body: "Laden Sie einfach ein Foto hoch; Diress erledigt den Rest automatisch." },
        es: { title: "¡Viste en Modelo en Segundos! ⚡️", body: "Solo sube una foto; Diress hace el resto automáticamente." },
        fr: { title: "Habillez en Secondes ! ⚡️", body: "Téléchargez juste une photo ; Diress fait le reste automatiquement." },
        it: { title: "Vesti su Modello in Secondi! ⚡️", body: "Carica solo una foto; Diress fa il resto automaticamente." },
        ja: { title: "数秒でモデルに着せよう！⚡️", body: "写真を1枚アップロードするだけ。あとはDiressが自動で行います。" },
        ko: { title: "몇 초 만에 모델 착용! ⚡️", body: "사진 한 장만 업로드하세요. 나머지는 Diress가 자동으로 처리합니다." },
        pt: { title: "Vista em Modelo em Segundos! ⚡️", body: "Basta enviar uma foto; o Diress faz o resto automaticamente." },
        ru: { title: "На Модели за Секунды! ⚡️", body: "Просто загрузите одно фото; Diress сделает остальное автоматически." },
        zh: { title: "几秒钟内穿在模特身上！⚡️", body: "只需上传一张照片；Diress 会自动完成剩下的工作。" }
    },
    2: { // Salı
        tr: { title: "Mankensiz Çekim Mümkün! 😄", body: "Ürünlerini yükle, saniyeler içinde gerçekçi bir model üzerinde gör." },
        en: { title: "Photoshoot Without Model? Yes! 😄", body: "Upload your products, see them on a realistic model in seconds." },
        de: { title: "Fotoshooting ohne Model? Ja! 😄", body: "Laden Sie Ihre Produkte hoch, sehen Sie sie in Sekunden an einem realistischen Model." },
        es: { title: "¿Sesión sin Modelo? ¡Sí! 😄", body: "Sube tus productos, velos en un modelo realista en segundos." },
        fr: { title: "Shooting sans Mannequin ? Oui ! 😄", body: "Téléchargez vos produits, voyez-les sur un mannequin réaliste en quelques secondes." },
        it: { title: "Foto senza Modella? Sì! 😄", body: "Carica i tuoi prodotti, vedili su un modello realistico in pochi secondi." },
        ja: { title: "モデルなしで撮影？可能！😄", body: "商品をアップロードして、数秒でリアルなモデルに着せてみましょう。" },
        ko: { title: "모델 없는 화보 촬영? 가능! 😄", body: "제품을 업로드하고 몇 초 만에 현실적인 모델 착용 샷을 확인하세요." },
        pt: { title: "Sessão sem Modelo? Sim! 😄", body: "Envie seus produtos, veja-os em um modelo realista em segundos." },
        ru: { title: "Фотосессия без Модели? Да! 😄", body: "Загрузите свои товары, увидите их на реалистичной модели за секунды." },
        zh: { title: "无模特拍摄？是的！😄", body: "上传您的产品，几秒钟内即可在逼真的模特身上看到效果。" }
    },
    3: { // Çarşamba
        tr: { title: "Kıyafetlerini Denemeden Gör! 👗✨", body: "Diress ürününü anında seçtiğin mankene giydirir." },
        en: { title: "See Clothes Without Trying! 👗✨", body: "Diress instantly dresses your product on the model you choose." },
        de: { title: "Kleidung sehen ohne Anprobe! 👗✨", body: "Diress zieht Ihr Produkt sofort dem von Ihnen gewählten Model an." },
        es: { title: "¡Ver Ropa sin Probar! 👗✨", body: "Diress viste instantáneamente tu producto en el modelo que elijas." },
        fr: { title: "Voir Vêtements sans Essayer ! 👗✨", body: "Diress habille instantanément votre produit sur le mannequin de votre choix." },
        it: { title: "Vedi Vestiti senza Provare! 👗✨", body: "Diress veste istantaneamente il tuo prodotto sul modello che scegli." },
        ja: { title: "試着せずに服を見る！👗✨", body: "Diressは、選んだモデルに商品を即座に着せます。" },
        ko: { title: "입어보지 않고 확인하세요! 👗✨", body: "Diress는 선택한 모델에게 즉시 제품을 입혀줍니다." },
        pt: { title: "Ver Roupas sem Experimentar! 👗✨", body: "O Diress veste instantaneamente seu produto no modelo que você escolher." },
        ru: { title: "Одежда без Примерки! 👗✨", body: "Diress мгновенно наденет ваш товар на выбранную вами модель." },
        zh: { title: "无需试穿即可查看！👗✨", body: "Diress 会立即将您的产品穿在您选择的模特身上。" }
    },
    4: { // Perşembe
        tr: { title: "Profesyonel Çekime Son! ⚡️", body: "Ürünü yükle, saniyeler içinde katalog kalitesinde model görseli al." },
        en: { title: "No More Pro Shoots! ⚡️", body: "Upload the product, get catalog-quality model images in seconds." },
        de: { title: "Kein Profi-Shooting Nötig! ⚡️", body: "Produkt hochladen, in Sekunden Bilder in Katalogqualität erhalten." },
        es: { title: "¡Adiós Sesiones Pro! ⚡️", body: "Sube el producto, obtén imágenes de modelo con calidad de catálogo en segundos." },
        fr: { title: "Fini les Shootings Pro ! ⚡️", body: "Téléchargez le produit, obtenez des images de mannequin de qualité catalogue en quelques secondes." },
        it: { title: "Basta Servizi Pro! ⚡️", body: "Carica il prodotto, ottieni immagini di modelli di qualità catalogo in pochi secondi." },
        ja: { title: "プロの撮影はもう不要！⚡️", body: "商品をアップロードするだけで、数秒でカタログ品質のモデル画像を取得できます。" },
        ko: { title: "전문 촬영은 그만! ⚡️", body: "제품을 업로드하고 몇 초 만에 카탈로그 품질의 모델 이미지를 얻으세요." },
        pt: { title: "Adeus Sessões Pro! ⚡️", body: "Envie o produto, obtenha imagens de modelo com qualidade de catálogo em segundos." },
        ru: { title: "Профи-съемка не нужна! ⚡️", body: "Загрузите товар, получите изображения модели каталожного качества за секунды." },
        zh: { title: "不再需要专业拍摄！⚡️", body: "上传产品，几秒钟内获得目录级质量的模特图片。" }
    },
    5: { // Cuma
        tr: { title: "Hafta Bitmeden Ürünlerini Gör! 🧡", body: "Birkaç saniyede gerçekçi pozlar ve mükemmel ışıklandırma seni bekliyor." },
        en: { title: "See Products Before Weekend! 🧡", body: "Realistic poses and perfect lighting await you in just a few seconds." },
        de: { title: "Produkte vor Wochenende sehen! 🧡", body: "Realistische Posen und perfekte Beleuchtung erwarten Sie in wenigen Sekunden." },
        es: { title: "¡Ver Productos antes del Finde! 🧡", body: "Poses realistas e iluminación perfecta te esperan en unos segundos." },
        fr: { title: "Voir Produits avant le Week-end ! 🧡", body: "Des poses réalistes et un éclairage parfait vous attendent en quelques secondes." },
        it: { title: "Vedi Prodotti prima del Weekend! 🧡", body: "Pose realistiche e illuminazione perfetta ti aspettano in pochi secondi." },
        ja: { title: "週末前に商品を確認！🧡", body: "数秒でリアルなポーズと完璧なライティングがあなたを待っています。" },
        ko: { title: "주말 전에 확인하세요! 🧡", body: "몇 초 만에 현실적인 포즈와 완벽한 조명을 만나보세요." },
        pt: { title: "Ver Produtos antes do Fim de Semana! 🧡", body: "Poses realistas e iluminação perfeita esperam por você em poucos segundos." },
        ru: { title: "Товары до Выходных! 🧡", body: "Реалистичные позы и идеальное освещение ждут вас всего через несколько секунд." },
        zh: { title: "周末前查看产品！🧡", body: "几秒钟内即可获得逼真的姿势和完美的灯光。" }
    },
    6: { // Cumartesi
        tr: { title: "Bugün Mankende Dene! 😊", body: "Yükle–seç–oluştur… Hepsi birkaç saniye içinde tamamlanıyor." },
        en: { title: "Try on Model Today! 😊", body: "Upload–Select–Create… All completed in a few seconds." },
        de: { title: "Heute am Model Testen! 😊", body: "Hochladen–Auswählen–Erstellen… Alles in wenigen Sekunden erledigt." },
        es: { title: "¡Prueba en Modelo Hoy! 😊", body: "Subir–Seleccionar–Crear… Todo completado en unos segundos." },
        fr: { title: "Essayez sur Mannequin Aujourd'hui ! 😊", body: "Télécharger–Sélectionner–Créer… Tout est terminé en quelques secondes." },
        it: { title: "Prova su Modello Oggi! 😊", body: "Carica–Seleziona–Crea… Tutto completato in pochi secondi." },
        ja: { title: "今日モデルで試そう！😊", body: "アップロード–選択–作成… すべて数秒で完了します。" },
        ko: { title: "오늘 모델에게 입혀보세요! 😊", body: "업로드–선택–생성… 모든 과정이 몇 초 안에 완료됩니다." },
        pt: { title: "Experimente em Modelo Hoje! 😊", body: "Enviar–Selecionar–Criar… Tudo concluído em poucos segundos." },
        ru: { title: "Примерь на Модели Сегодня! 😊", body: "Загрузить–Выбрать–Создать… Все готово за несколько секунд." },
        zh: { title: "今天在模特身上尝试！😊", body: "上传–选择–创建… 全部在几秒钟内完成。" }
    },
    0: { // Pazar
        tr: { title: "Yeni Haftaya Güçlü Başla! 📸✨", body: "Saniyeler içinde profesyonel görünüm için şimdi oluşturmayı dene." },
        en: { title: "Start Week Strong! 📸✨", body: "Try creating now for a professional look in seconds." },
        de: { title: "Stark in die Woche! 📸✨", body: "Versuchen Sie jetzt, in Sekunden einen professionellen Look zu erstellen." },
        es: { title: "¡Empieza Fuerte la Semana! 📸✨", body: "Prueba a crear ahora para un look profesional en segundos." },
        fr: { title: "Commencez la Semaine en Force ! 📸✨", body: "Essayez de créer maintenant pour un look professionnel en quelques secondes." },
        it: { title: "Inizia la Settimana alla Grande! 📸✨", body: "Prova a creare ora per un look professionale in pochi secondi." },
        ja: { title: "新しい週を力強くスタート！📸✨", body: "今すぐ作成して、数秒でプロフェッショナルな外観を手に入れましょう。" },
        ko: { title: "힘찬 한 주 시작! 📸✨", body: "지금 생성하여 몇 초 만에 전문적인 룩을 완성해보세요." },
        pt: { title: "Comece a Semana com Força! 📸✨", body: "Experimente criar agora para um visual profissional em segundos." },
        ru: { title: "Начни Неделю Мощно! 📸✨", body: "Попробуйте создать сейчас для профессионального вида за секунды." },
        zh: { title: "强势开启新的一周！📸✨", body: "立即尝试创建，几秒钟内获得专业外观。" }
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
                let rawLang = user.preferred_language || "en";
                let lang = rawLang.split('-')[0].toLowerCase(); // 'tr-TR' -> 'tr'

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
