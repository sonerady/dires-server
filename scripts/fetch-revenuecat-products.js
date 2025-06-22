// RevenueCat ürün bilgilerini çeken güvenli script - V1 API
// Kullanım: node fetch-revenuecat-products.js

const axios = require("axios");

// GÜVENLIK: Bu API key'i .env dosyasına koyun!
const REVENUECAT_SECRET_KEY = "appl_xZaSNKsBgLbRnFHVbDxhvkkvzTe"; // BUNU .ENV'E TAŞIYIN!

async function fetchRevenueCatProducts() {
  try {
    console.log("RevenueCat ürün bilgileri çekiliyor (V1 API)...\n");

    // Bu endpoint'ler gerçek paket isimlerini döndürmüyor, sadece customer bilgilerini
    // RevenueCat'te products/offerings bilgileri app store'lardan gelir

    console.log("⚠️  RevenueCat API Bilgisi:");
    console.log("RevenueCat API, product isimlerini ve fiyatlarını saklamaz.");
    console.log(
      "Bu bilgiler Apple/Google store'lardan gerçek zamanlı olarak gelir."
    );
    console.log("Webhook'ta göreceğiniz product_id'ler şunlardır:\n");

    // V2 App'i için beklenen product ID'ler:
    console.log("🎯 V2 WEBHOOK İÇİN BEKLENEN PRODUCT ID'LERİ:");
    console.log("================================================");

    console.log("SUBSCRIPTION PRODUCTS:");
    console.log("- com.monailisa.minipi_500coin_weekly (500 kredi haftalık)");
    console.log("- com.minipi.1500coin_yearly (1500 kredi yıllık)");

    console.log("\nONE-TIME PRODUCTS (örnek):");
    console.log("- com.monailisa.minipi_300coin (300 kredi)");
    console.log("- com.monailisa.minipi_500coin (500 kredi)");
    console.log("- com.monailisa.minipi_1000coin (1000 kredi)");
    console.log("- com.monailisa.minipi_1500coin (1500 kredi)");

    console.log("\n📱 GERÇEK PRODUCT ID'LERİ GÖRMEK İÇİN:");
    console.log(
      "1. App Store Connect / Google Play Console'da tanımlı product ID'leri kontrol edin"
    );
    console.log(
      "2. Webhook log'larınızı kontrol edin - gerçek purchase'larda product_id görünür"
    );
    console.log(
      "3. Test purchase yapın ve webhook'a gelen product_id'yi inceleyin"
    );

    // Test için bir customer ID ile deneme yapalım
    console.log("\n🔍 Test Customer Bilgisi Çekme:");

    try {
      // Örnek customer ID ile test
      const testUserId = "$RCAnonymousID:test123";
      const customerResponse = await axios.get(
        `https://api.revenuecat.com/v1/subscribers/${testUserId}`,
        {
          headers: {
            Authorization: `Bearer ${REVENUECAT_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("Test customer bilgisi başarılı:", customerResponse.status);
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log("✅ API Key çalışıyor (404 normal - test user yok)");
      } else {
        console.log(
          "❌ API Key hatası:",
          error.response?.status,
          error.response?.data
        );
      }
    }
  } catch (error) {
    if (error.response) {
      console.error(
        "❌ API Hatası:",
        error.response.status,
        error.response.data
      );
    } else {
      console.error("❌ Network Hatası:", error.message);
    }
  }
}

// Script'i çalıştır
fetchRevenueCatProducts();
