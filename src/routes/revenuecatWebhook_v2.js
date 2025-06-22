// routes/revenuecatWebhook_v2.js - DIRESS2 (MiniPI) Webhook
const express = require("express");
const router = express.Router();
const supabase = require("../supabaseClient"); // supabaseClient.js dosyanın yolu

router.post("/webhook", async (req, res) => {
  try {
    const event = req.body;
    console.log(
      "🎯 DIRESS2 (MiniPI) RevenueCat webhook v2 event received:",
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

    console.log("Webhook v2 - Processing event:", {
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
        "Webhook v2 - Handling subscription expiration/cancellation for:",
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
        "Webhook v2 - Handling initial subscription purchase for:",
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
          "Webhook v2 - Initial purchase already processed:",
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

      // V2 app (MiniPI) GERÇEK subscription product ID'leri
      if (product_id === "com.monailisa.minipi_500coin_weekly") {
        addedCoins = 500;
        subscriptionTitle = "500 Coin Weekly";
      } else if (product_id === "com.minipi.1500coin_yearly") {
        addedCoins = 1500;
        subscriptionTitle = "1500 Coin Yearly";
      } else {
        console.log("⚠️ UNKNOWN V2 SUBSCRIPTION PRODUCT ID:", product_id);
        // Fallback - varsayılan değerler
        addedCoins = 500;
        subscriptionTitle = "Unknown Subscription";
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
      console.log("Webhook v2 - Handling one-time purchase for:", app_user_id);

      // DUPLICATE CHECK
      const { data: existingTransaction, error: checkError } = await supabase
        .from("user_purchase")
        .select("*")
        .eq("transaction_id", original_transaction_id)
        .single();

      if (existingTransaction) {
        console.log(
          "Webhook v2 - One-time purchase already processed:",
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

      // V2 app (MiniPI) GERÇEK one-time product ID'leri
      let addedCoins = 0;
      let productTitle = "";

      if (product_id === "com.monailisa.minipi.250coin") {
        addedCoins = 250;
        productTitle = "250 Credits Pack";
      } else if (product_id === "com.monailisa.minipi.500coin") {
        addedCoins = 500;
        productTitle = "500 Credits Pack";
      } else if (product_id === "com.monailisa.minipi.1000coin") {
        addedCoins = 1000;
        productTitle = "1000 Credits Pack";
      } else if (product_id === "com.monailisa.minipi.2000coin") {
        addedCoins = 2000;
        productTitle = "2000 Credits Pack";
      } else {
        // Fallback - product ID'den coin miktarını çıkarmaya çalış
        const coinMatch = product_id.match(/(\d+)coin/);
        if (coinMatch) {
          addedCoins = parseInt(coinMatch[1]);
          productTitle = `${addedCoins} Credits Pack`;
        } else {
          // Son fallback - generic sayı arama
          const numberMatch = product_id.match(/(\d+)/);
          if (numberMatch) {
            addedCoins = parseInt(numberMatch[1]);
            productTitle = `${addedCoins} Credits Pack`;
          } else {
            addedCoins = 300; // Default
            productTitle = "Credits Pack";
          }
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
      console.log(
        "Webhook v2 - Handling subscription renewal for:",
        app_user_id
      );

      // DUPLICATE CHECK: Aynı transaction_id ile işlem yapılmış mı kontrol et
      const { data: existingTransaction, error: checkError } = await supabase
        .from("user_purchase")
        .select("*")
        .eq("transaction_id", original_transaction_id)
        .single();

      if (existingTransaction) {
        console.log(
          "Webhook v2 - Transaction already processed:",
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
      let productTitle = "";
      let packageType = "";

      // V2 app (MiniPI) GERÇEK subscription renewal product ID'leri
      if (product_id === "com.monailisa.minipi_500coin_weekly") {
        addedCoins = 500;
        productTitle = "500 Coin Weekly";
        packageType = "CUSTOM";
      } else if (product_id === "com.minipi.1500coin_yearly") {
        addedCoins = 1500;
        productTitle = "1500 Coin Yearly";
        packageType = "AUTO_RENEWABLE_SUBSCRIPTION";
      } else {
        console.log("⚠️ UNKNOWN V2 RENEWAL PRODUCT ID:", product_id);
        addedCoins = 500; // Fallback
        productTitle = "Unknown Renewal";
        packageType = "subscription";
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
        product_title: productTitle,
        purchase_date: purchase_date,
        package_type: packageType,
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

    // Diğer bilinmeyen event tipleri
    console.log("Webhook v2 - Unknown event type:", type);
    return res.status(200).json({ message: "Event handled - unknown type" });
  } catch (err) {
    console.error("Error handling webhook v2:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
