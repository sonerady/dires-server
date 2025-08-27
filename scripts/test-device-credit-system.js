/**
 * Device Credit Tracking System Test Script
 * Bu script yeni database yapısını test eder
 */

const { createClient } = require("@supabase/supabase-js");

// Supabase konfigürasyonu
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    "❌ SUPABASE_URL ve SUPABASE_ANON_KEY environment variable'ları gerekli!"
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testDeviceCreditSystem() {
  console.log("🧪 Device Credit Tracking System Test Başlıyor...\n");

  try {
    // 1. Test device ID'leri
    const testDeviceId1 = "test-device-12345";
    const testDeviceId2 = "test-device-67890";

    console.log("1️⃣ Test Database Function: check_device_credit_eligibility");

    // Test 1: Yeni device ID - kredi alabilmeli
    const { data: test1, error: test1Error } = await supabase.rpc(
      "check_device_credit_eligibility",
      { device_id_param: testDeviceId1 }
    );

    if (test1Error) {
      console.error("❌ Function test hatası:", test1Error);
    } else {
      console.log(`✅ Test 1 (Yeni Device):`, test1[0]);
    }

    // 2. Test users tablosu column'larını kontrol et
    console.log("\n2️⃣ Users Tablosu Yapısını Kontrol Et");

    const { data: columns, error: columnsError } = await supabase
      .from("information_schema.columns")
      .select("column_name, data_type, is_nullable, column_default")
      .eq("table_name", "users")
      .in("column_name", [
        "device_id",
        "received_initial_credit",
        "initial_credit_date",
      ]);

    if (columnsError) {
      console.error("❌ Column kontrol hatası:", columnsError);
    } else {
      console.log("✅ Users tablosu column'ları:");
      columns.forEach((col) => {
        console.log(
          `   - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`
        );
      });
    }

    // 3. Test kullanıcı oluştur
    console.log("\n3️⃣ Test Kullanıcı Oluştur");

    const testUserId = `test-user-${Date.now()}`;
    const { data: newUser, error: userError } = await supabase
      .from("users")
      .insert([
        {
          id: testUserId,
          credit_balance: 100,
          device_id: testDeviceId1,
          received_initial_credit: true,
          initial_credit_date: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
      ])
      .select("*")
      .single();

    if (userError) {
      console.error("❌ Test kullanıcı oluşturma hatası:", userError);
    } else {
      console.log("✅ Test kullanıcı oluşturuldu:", {
        id: newUser.id,
        credit_balance: newUser.credit_balance,
        device_id: newUser.device_id,
        received_initial_credit: newUser.received_initial_credit,
      });
    }

    // 4. Aynı device ID ile tekrar test et
    console.log("\n4️⃣ Aynı Device ID İle Tekrar Test Et");

    const { data: test2, error: test2Error } = await supabase.rpc(
      "check_device_credit_eligibility",
      { device_id_param: testDeviceId1 }
    );

    if (test2Error) {
      console.error("❌ Function test 2 hatası:", test2Error);
    } else {
      console.log(`✅ Test 2 (Kredi Alınmış Device):`, test2[0]);

      // Beklenen: can_receive_credit = false olmalı
      if (!test2[0].can_receive_credit) {
        console.log("✅ BAŞARILI: Device ID doğru şekilde bloklandı!");
      } else {
        console.log("❌ HATA: Device ID bloklanmadı!");
      }
    }

    // 5. Farklı device ID test et
    console.log("\n5️⃣ Farklı Device ID Test Et");

    const { data: test3, error: test3Error } = await supabase.rpc(
      "check_device_credit_eligibility",
      { device_id_param: testDeviceId2 }
    );

    if (test3Error) {
      console.error("❌ Function test 3 hatası:", test3Error);
    } else {
      console.log(`✅ Test 3 (Farklı Device):`, test3[0]);

      // Beklenen: can_receive_credit = true olmalı
      if (test3[0].can_receive_credit) {
        console.log("✅ BAŞARILI: Farklı device ID kredi alabilir!");
      } else {
        console.log("❌ HATA: Farklı device ID kredi alamıyor!");
      }
    }

    // 6. Test kullanıcıyı temizle
    console.log("\n6️⃣ Test Verilerini Temizle");

    const { error: deleteError } = await supabase
      .from("users")
      .delete()
      .eq("id", testUserId);

    if (deleteError) {
      console.error("❌ Test kullanıcı silme hatası:", deleteError);
    } else {
      console.log("✅ Test kullanıcı silindi");
    }

    // 7. İstatistik raporu
    console.log("\n7️⃣ Sistem İstatistikleri");

    const { data: stats, error: statsError } = await supabase
      .from("users")
      .select("*");

    if (statsError) {
      console.error("❌ İstatistik hatası:", statsError);
    } else {
      const totalUsers = stats.length;
      const usersWithDevice = stats.filter((u) => u.device_id).length;
      const usersReceivedCredit = stats.filter(
        (u) => u.received_initial_credit
      ).length;
      const users100Plus = stats.filter((u) => u.credit_balance >= 100).length;

      console.log(`📊 Toplam kullanıcı: ${totalUsers}`);
      console.log(`📱 Device ID'si olan: ${usersWithDevice}`);
      console.log(`🎁 Initial kredi alanlar: ${usersReceivedCredit}`);
      console.log(`💰 100+ kredisi olan: ${users100Plus}`);
    }

    console.log("\n🎉 Test tamamlandı!");
  } catch (error) {
    console.error("❌ Test genel hatası:", error);
  }
}

// Script'i çalıştır
if (require.main === module) {
  testDeviceCreditSystem();
}

module.exports = { testDeviceCreditSystem };
