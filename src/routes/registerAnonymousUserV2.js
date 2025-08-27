// routes/registerAnonymousUser.js
const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const supabase = require("../supabaseClient"); // Halihazırda BE tarafında supabaseClient.js var

router.post("/registerAnonymousUser", async (req, res) => {
  try {
    let { userId, deviceId } = req.body;
    console.log("🆔 [REGISTER] userId:", userId, "deviceId:", deviceId);

    // 🛡️ GÜVENLIK: Device ID bazlı kredi kontrolü
    if (deviceId) {
      // PostgreSQL function ile device kredi uygunluğunu kontrol et
      const { data: creditCheck, error: creditCheckError } = await supabase.rpc(
        "check_device_credit_eligibility",
        { device_id_param: deviceId }
      );

      if (creditCheckError) {
        console.error(
          "❌ [SECURITY] Device credit check hatası:",
          creditCheckError
        );
        // Hata durumunda devam et, ama log'la
      } else if (creditCheck && creditCheck.length > 0) {
        const { can_receive_credit, existing_user_count, last_credit_date } =
          creditCheck[0];

        console.log(`🔍 [SECURITY] Device ID (${deviceId}) kredi kontrolü:`, {
          can_receive_credit,
          existing_user_count,
          last_credit_date,
        });

        // Eğer bu device daha önce kredi aldıysa
        if (!can_receive_credit) {
          // Bu device'dan mevcut kullanıcıları bul
          const { data: existingDeviceUsers, error: deviceError } =
            await supabase
              .from("users")
              .select(
                "id, device_id, credit_balance, created_at, received_initial_credit"
              )
              .eq("device_id", deviceId)
              .order("created_at", { ascending: false })
              .limit(1);

          if (
            !deviceError &&
            existingDeviceUsers &&
            existingDeviceUsers.length > 0
          ) {
            const existingUser = existingDeviceUsers[0];
            console.log(
              `🛡️ [SECURITY] Device daha önce kredi aldı. Mevcut kullanıcı döndürülüyor: ${existingUser.id} (Kredi: ${existingUser.credit_balance})`
            );

            return res.status(200).json({
              message: "Bu cihaz daha önce kredi aldı",
              userId: existingUser.id,
              creditBalance: existingUser.credit_balance,
              isExistingDevice: true,
              deviceAlreadyReceivedCredit: true,
              lastCreditDate: last_credit_date,
            });
          }
        }
      }
    }

    // Eğer istekle bir userId geldi ise bu kullanıcı zaten var mı bak
    if (userId) {
      const { data: user, error } = await supabase
        .from("users")
        .select("*")
        .eq("id", userId)
        .single();

      if (error || !user) {
        // Kayıt yoksa yeni oluştur - 100 kredi ile
        userId = uuidv4();
        const { data, error: insertError } = await supabase
          .from("users")
          .insert([
            {
              id: userId,
              credit_balance: 100, // 🎁 YENİ KULLANICI HEDİYESİ: 100 KREDİ
              device_id: deviceId || null,
              received_initial_credit: true, // 🎯 Bu kullanıcı initial kredi aldı
              initial_credit_date: new Date().toISOString(), // 📅 Kredi alım tarihi
              created_at: new Date().toISOString(),
            },
          ]);

        if (insertError) {
          console.error("❌ Kullanıcı oluşturma hatası:", insertError);
          return res.status(500).json({
            message: "Kullanıcı oluşturulamadı",
            error: insertError.message,
          });
        }

        console.log(
          `🎉 [NEW USER] Yeni kullanıcı oluşturuldu: ${userId} (100 kredi hediye)`
        );
        return res.status(200).json({
          message: "Yeni anonim kullanıcı oluşturuldu",
          userId,
          creditBalance: 100,
          isNewUser: true,
        });
      } else {
        // Kullanıcı zaten var - device ID güncelle
        if (deviceId && user.device_id !== deviceId) {
          await supabase
            .from("users")
            .update({ device_id: deviceId })
            .eq("id", userId);
          console.log(
            `🔄 [UPDATE] Device ID güncellendi: ${userId} -> ${deviceId}`
          );
        }

        console.log(
          `✅ [EXISTING] Mevcut kullanıcı: ${userId} (Kredi: ${user.credit_balance})`
        );
        return res.status(200).json({
          message: "Kullanıcı zaten mevcut",
          userId,
          creditBalance: user.credit_balance,
          isExistingUser: true,
        });
      }
    } else {
      // userId yoksa yeni userId oluştur - 100 kredi ile
      userId = uuidv4();
      const { data, error } = await supabase.from("users").insert([
        {
          id: userId,
          credit_balance: 100, // 🎁 YENİ KULLANICI HEDİYESİ: 100 KREDİ
          device_id: deviceId || null,
          received_initial_credit: true, // 🎯 Bu kullanıcı initial kredi aldı
          initial_credit_date: new Date().toISOString(), // 📅 Kredi alım tarihi
          created_at: new Date().toISOString(),
        },
      ]);

      if (error) {
        console.error("❌ Yeni kullanıcı oluşturma hatası:", error);
        return res.status(500).json({
          message: "Kullanıcı oluşturulamadı",
          error: error.message,
        });
      }

      console.log(
        `🎉 [NEW USER] Yeni kullanıcı oluşturuldu: ${userId} (100 kredi hediye)`
      );
      return res.status(200).json({
        message: "Yeni anonim kullanıcı oluşturuldu",
        userId,
        creditBalance: 100,
        isNewUser: true,
      });
    }
  } catch (error) {
    console.error("❌ Register Anonymous User hatası:", error);
    return res.status(500).json({
      message: "Sunucu hatası",
      error: error.message,
    });
  }
});

module.exports = router;
