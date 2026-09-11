# OneSignal kampanya senaryo testi — 8 Eylül 2026

## Sonuç ve sınırlar

- Backend testleri: 9/9 geçti. Mobil servis testleri: 9/9 geçti.
- Gerçek Diress veritabanında tests/acquisitionPush.sql çalıştırıldı. Tüm kontroller geçti; işlem ROLLBACK ile geri alındı, kalan geçici kullanıcı sayısı 0.
- Yeni ve hiç satın almamış kayıt uygun bulundu. Eski hesap, trial kullanmış hesap, trial bayrakları sonradan temizlenen hesap, aynı cihazı kullanan hesap ve iptal edilmiş satın alma geçmişi olan hesap elendi.
- Satın alan hesap silinse veya purchase_history kaydı kaldırılsa da kalıcı geçmiş kaydı yeniden uygunluğu engelledi.
- Aynı gün yeniden talep aynı gönderim kimliğini döndürdü; ertesi gün etiketiyle hemen tekrar gönderim engellendi.
- Gerçek iPhone hesabı uygun değil: ilişkili hesaplarda satın alma, abonelik/Pro ve cihaz geçmişi var. Mevcut enrollment subscribed=false.
- Gerçek backend sendOne akışı mevcut enrollment ile çalıştırıldı: not_due. Dış bildirim/mağaza isteği sayısı 0. Ayrı gerçek eligibility sorgusu false döndü.
- Kampanya veritabanında enabled=false. Yerel ACQUISITION_PUSH_WORKER_ENABLED etkin değil. Canlı sunucunun ortam değişkeni bu testte kontrol edilmedi.
- Bu çalışma gerçek veritabanı koşullarını, uygulama/backend testlerini ve mevcut cihazın elenmesini doğrular. Temiz yeni bir kurulumdan zamanlanmış kampanya bildiriminin fiziksel cihaza ulaşması uçtan uca henüz denenmedi. Önceki manuel test bunu doğrulamaz.

## Zamanlama

Koddaki koşullar: onboarding üzerinden en az 24 saat, son etkinlikten en az 4 saat; veritabanındaki local_hour=20 ayarıyla kullanıcının saat diliminde 20:00–20:14 aralığı. Gün seçimi kullanıcının yerel takvim gününe göre yapılır. Satın alma uygunluğu gönderimden hemen önce yeniden kontrol edilir. 70 dilde yedişer mesaj var; bilinmeyen dilde gönderim atlanır.

## Türkçe metinler

| Gün | Başlık | Mesaj |
| --- | --- | --- |
| Pazartesi | İlk model fotoğrafın burada başlıyor | Ürün fotoğrafını yapay zekâ ile model çekimine dönüştür. Başlamak için Diress paketlerini keşfet. |
| Salı | Ürününe yeni bir ortam kazandır | Ürün fotoğrafların için farklı arka planları keşfet. Fikirlerine uygun Diress paketini bul. |
| Çarşamba | Tek ürün, daha fazla seçenek | Koleksiyonun için pozları ve stilleri keşfet. Diress ile neler oluşturabileceğine göz at. |
| Perşembe | Yeni koleksiyonuna yer aç | Stüdyo çekimi organize etmeden ürün görselleri oluştur. Diress’te seçeneklerini incele. |
| Cuma | Mağazan için yeni bir görünüm | Ürün görsellerine tutarlı bir stil kazandır. Diress paketlerini keşfet. |
| Cumartesi | Yeni fikrin bir fotoğrafla başlayabilir | Aklında bir ürün mü var? Diress’i keşfet, bir sonraki çekimine uygun paketi bul. |
| Pazar | Ürünlerin için yeni bir başlangıç | Bir sonraki ürün çekimini Diress ile planla. Paketleri incele, mağazana uygun olanı seç. |

Kaynaklar: marketing/acquisition-push.json, src/services/acquisitionPush.js, tests/acquisitionPush.test.js, tests/acquisitionPush.sql, client/tests/OneSignalService.test.cjs.

## Gerçek iPhone dil değişimi kontrolü

8 Eylül 2026: Cihazın başlangıç dili İspanyolca (`es`) idi. SettingsScreen'in kullandığı `selectedLanguage` kaydı ve `i18n.changeLanguage` akışı cihazın çalışan uygulamasında Türkçeye geçirildi. Dışarıya bildirim gönderilmeden şu sonuçlar doğrulandı:

| Uygulama dili | OneSignal kullanıcı dili | Backend enrollment dili | Salı mesajının dili |
| --- | --- | --- | --- |
| tr | tr | tr | Türkçe |
| es (geri yüklendi) | es | es | İspanyolca |

Kontrol, gerçek cihazdaki dil değişiminin gerçek OneSignal ve backend kayıtlarına yansımasını kapsar. Ayarlar ekranında düğmeye fiziksel dokunma veya bu test sırasında lokalize push teslimi sınanmadı. Kullanıcının önceki dili ve kaydedilmiş tercihi test sonunda geri yüklendi; kampanya aboneliği false olarak kaldı.

## Lokalize bildirimin fiziksel iPhone'da görünmesi

Sonraki testte backend enrollment dili ve OneSignal kullanıcı dili `es` olarak eşleşti. `localizedCampaign` gerçek Salı metnini seçti: “De amateur a profesional”. Yalnızca daha önce doğrulanmış iPhone aboneliğine gönderildi. OneSignal 1 başarılı gönderim, 0 hata bildirdi; kullanıcı “Evet, İspanyolca geldi” yanıtıyla cihazda görünmesini doğruladı.

Bu test elle yazılmış Türkçe test metni yerine kayıtlı uygulama dilinden seçilen gerçek kampanya metnini kullandı. Yine tek cihazlık manuel gönderimdi; satın alma/zaman koşullarıyla otomatik kampanya başlatılmadı.
