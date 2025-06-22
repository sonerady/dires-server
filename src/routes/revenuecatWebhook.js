// routes/revenuecatWebhook.js
const express = require("express");
const router = express.Router();
const supabase = require("../supabaseClient"); // supabaseClient.js dosyanın yolu

router.post("/webhook", async (req, res) => {
  try {
    const event = req.body;
    console.log(
      "RevenueCat webhook event received:",
      JSON.stringify(event, null, 2)
    );

    const rcEvent = event.event;
    if (!rcEvent) {
      return res.status(400).json({ message: "Invalid event structure" });
    }

    // requestte $RCAnonymousID vs diye birşey yoksa bu kısımları kaldırıyoruz
    const {
      type,
      app_user_id,
      product_id,
      original_transaction_id,
      purchased_at_ms,
    } = rcEvent;

    console.log("Webhook - Processing event:", {
      type,
      app_user_id,
      product_id,
      original_transaction_id,
    });

    // purchased_at_ms'den ISO formatında bir tarih oluşturuyoruz
    const purchase_date = purchased_at_ms
      ? new Date(purchased_at_ms).toISOString()
      : new Date().toISOString(); // güvenlik için, eğer yoksa mevcut zaman

    // Subscription expiration handling
    if (type === "EXPIRATION" || type === "CANCELLATION") {
      console.log(
        "Webhook - Handling subscription expiration/cancellation for:",
        app_user_id
      );

      const { error: updateError } = await supabase
        .from("users")
        .update({ is_pro: false })
        .eq("id", app_user_id);

      if (updateError) {
        console.error("Error updating user pro status:", updateError);
        return res.status(500).json({ message: "Failed to update pro status" });
      }

      console.log("User pro status updated to false for user:", app_user_id);
      return res.status(200).json({ message: "Pro status updated" });
    }

    // INITIAL_PURCHASE - İlk subscription satın alımı
    if (type === "INITIAL_PURCHASE") {
      console.log(
        "Webhook - Handling initial subscription purchase for:",
        app_user_id
      );

      // DUPLICATE CHECK
      const { data: existingTransaction, error: checkError } = await supabase
        .from("user_purchase")
        .select("*")
        .eq("transaction_id", original_transaction_id)
        .single();

      if (existingTransaction) {
        console.log(
          "Webhook - Initial purchase already processed:",
          original_transaction_id
        );
        return res
          .status(200)
          .json({ message: "Transaction already processed" });
      }

      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("*")
        .eq("id", app_user_id)
        .single();

      if (userError || !userData) {
        console.error("User not found:", userError);
        return res.status(404).json({ message: "User not found" });
      }

      let addedCoins = 0;
      let subscriptionTitle = "";

      if (product_id === "com.monailisa.pro_weekly600") {
        addedCoins = 600;
        subscriptionTitle = "Weekly Pro 600";
      } else if (product_id === "com.monailisa.pro_monthly2400") {
        addedCoins = 2400;
        subscriptionTitle = "Monthly Pro 2400";
      }

      const currentBalance = userData.credit_balance || 0;
      const newBalance = currentBalance + addedCoins;

      // Kullanıcıyı pro yap ve bakiyeyi güncelle
      const { error: updateErr } = await supabase
        .from("users")
        .update({
          credit_balance: newBalance,
          is_pro: true,
        })
        .eq("id", app_user_id);

      if (updateErr) {
        console.error("Error updating user for initial purchase:", updateErr);
        return res.status(500).json({ message: "Failed to update user" });
      }

      // user_purchase tablosuna kayıt ekle
      const purchaseData = {
        user_id: app_user_id,
        product_id: product_id,
        product_title: subscriptionTitle,
        purchase_date: purchase_date,
        package_type: "subscription",
        price: 0,
        coins_added: addedCoins,
        transaction_id: original_transaction_id,
        purchase_number: null,
      };

      const { error: insertError } = await supabase
        .from("user_purchase")
        .insert([purchaseData]);

      if (insertError) {
        console.error("Error inserting initial purchase data:", insertError);
        return res
          .status(500)
          .json({ message: "Failed to record initial purchase" });
      }

      console.log(
        "Initial subscription purchase processed successfully for user:",
        app_user_id
      );
      return res.status(200).json({ message: "Initial purchase processed" });
    }

    // NON_RENEWING_PURCHASE - One-time paket satın alımı (ÖNEMLİ!)
    if (type === "NON_RENEWING_PURCHASE") {
      console.log("Webhook - Handling one-time purchase for:", app_user_id);

      // DUPLICATE CHECK
      const { data: existingTransaction, error: checkError } = await supabase
        .from("user_purchase")
        .select("*")
        .eq("transaction_id", original_transaction_id)
        .single();

      if (existingTransaction) {
        console.log(
          "Webhook - One-time purchase already processed:",
          original_transaction_id
        );
        return res
          .status(200)
          .json({ message: "Transaction already processed" });
      }

      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("*")
        .eq("id", app_user_id)
        .single();

      if (userError || !userData) {
        console.error("User not found:", userError);
        return res.status(404).json({ message: "User not found" });
      }

      // Product ID'ye göre coin miktarını belirle
      let addedCoins = 0;
      let productTitle = "";

      // One-time paketlerin product ID'lerini kontrol et
      if (product_id.includes("300")) {
        addedCoins = 300;
        productTitle = "300 Credits Pack";
      } else if (product_id.includes("1000")) {
        addedCoins = 1000;
        productTitle = "1000 Credits Pack";
      } else if (product_id.includes("2200")) {
        addedCoins = 2200;
        productTitle = "2200 Credits Pack";
      } else if (product_id.includes("5000")) {
        addedCoins = 5000;
        productTitle = "5000 Credits Pack";
      } else {
        // Fallback - product title'dan çıkarmaya çalış
        const coinMatch = product_id.match(/(\d+)/);
        if (coinMatch) {
          addedCoins = parseInt(coinMatch[1]);
          productTitle = `${addedCoins} Credits Pack`;
        } else {
          addedCoins = 300; // Default
          productTitle = "Credits Pack";
        }
      }

      const currentBalance = userData.credit_balance || 0;
      const newBalance = currentBalance + addedCoins;

      // SADECE bakiyeyi güncelle - is_pro'yu değiştirme!
      // Çünkü kullanıcının zaten aktif subscription'ı var
      const { error: updateErr } = await supabase
        .from("users")
        .update({ credit_balance: newBalance })
        .eq("id", app_user_id);

      if (updateErr) {
        console.error(
          "Error updating user balance for one-time purchase:",
          updateErr
        );
        return res.status(500).json({ message: "Failed to update balance" });
      }

      // user_purchase tablosuna kayıt ekle
      const purchaseData = {
        user_id: app_user_id,
        product_id: product_id,
        product_title: productTitle,
        purchase_date: purchase_date,
        package_type: "one_time",
        price: 0,
        coins_added: addedCoins,
        transaction_id: original_transaction_id,
        purchase_number: null,
      };

      const { error: insertError } = await supabase
        .from("user_purchase")
        .insert([purchaseData]);

      if (insertError) {
        console.error("Error inserting one-time purchase data:", insertError);
        return res
          .status(500)
          .json({ message: "Failed to record one-time purchase" });
      }

      console.log("One-time purchase processed successfully:", {
        user: app_user_id,
        product: product_id,
        coins: addedCoins,
        newBalance: newBalance,
      });

      return res.status(200).json({
        message: "One-time purchase processed",
        coinsAdded: addedCoins,
        newBalance: newBalance,
      });
    }

    // Eğer gerçek yenileme event'i "RENEWAL" olarak geliyorsa
    if (type === "RENEWAL") {
      console.log("Webhook - Handling subscription renewal for:", app_user_id);

      // DUPLICATE CHECK: Aynı transaction_id ile işlem yapılmış mı kontrol et
      const { data: existingTransaction, error: checkError } = await supabase
        .from("user_purchase")
        .select("*")
        .eq("transaction_id", original_transaction_id)
        .single();

      if (existingTransaction) {
        console.log(
          "Webhook - Transaction already processed:",
          original_transaction_id
        );
        return res
          .status(200)
          .json({ message: "Transaction already processed" });
      }

      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("*")
        .eq("id", app_user_id)
        .single();

      if (userError || !userData) {
        console.error("User not found:", userError);
        return res.status(404).json({ message: "User not found" });
      }

      let addedCoins = 0;
      if (product_id === "com.monailisa.pro_weekly600") {
        addedCoins = 600;
      } else if (product_id === "com.monailisa.pro_monthly2400") {
        addedCoins = 2400;
      }

      const currentBalance = userData.credit_balance || 0;
      const newBalance = currentBalance + addedCoins;

      // Bakiyeyi güncelle ve pro statusu garanti et
      const { error: updateErr } = await supabase
        .from("users")
        .update({
          credit_balance: newBalance,
          is_pro: true,
        })
        .eq("id", app_user_id);

      if (updateErr) {
        console.error("Error updating user balance:", updateErr);
        return res.status(500).json({ message: "Failed to update balance" });
      }

      // user_purchase tablosuna kayıt ekle
      const purchaseData = {
        user_id: app_user_id,
        product_id: product_id,
        product_title: product_id.includes("monthly2400")
          ? "2400 Coin Monthly"
          : "600 Coin Weekly",
        purchase_date: purchase_date,
        package_type: "subscription",
        price: 0,
        coins_added: addedCoins,
        transaction_id: original_transaction_id,
        purchase_number: null,
      };

      const { error: insertError } = await supabase
        .from("user_purchase")
        .insert([purchaseData]);

      if (insertError) {
        console.error("Error inserting renewal data:", insertError);
        return res
          .status(500)
          .json({ message: "Failed to record renewal purchase" });
      }

      console.log("Renewal processed successfully for user:", app_user_id);
      return res.status(200).json({ message: "Renewal processed" });
    }

    // PRODUCT_CHANGE - Plan değişikliği
    if (type === "PRODUCT_CHANGE") {
      console.log("Webhook - Handling product change for:", app_user_id);
      // Bu durumda kullanıcı farklı bir subscription planına geçmiş
      // Şimdilik sadece log'la, gerekirse daha sonra implement ederiz
      return res.status(200).json({ message: "Product change noted" });
    }

    // Diğer bilinmeyen event tipleri
    console.log("Webhook - Unknown event type:", type);
    return res.status(200).json({ message: "Event handled - unknown type" });
  } catch (err) {
    console.error("Error handling webhook:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
