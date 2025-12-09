const express = require("express");
const router = express.Router();
const { supabase } = require("../supabaseClient");
const { sendPushNotification } = require("../services/pushNotificationService");
const { Expo } = require("expo-server-sdk");

const expo = new Expo();

// Helper: Normalize language code
function normalizeLanguageCode(language) {
  if (!language) return "en";
  const normalized = language.split("-")[0].toLowerCase();
  const supportedLanguages = ["en", "tr", "es", "fr", "de", "it", "ja", "ko", "pt", "ru", "zh"];
  return supportedLanguages.includes(normalized) ? normalized : "en";
}

// 1. Save Device Token
router.post("/save-device-token", async (req, res) => {
  const { userId, expoPushToken, language } = req.body;

  if (!userId || !expoPushToken) {
    return res.status(400).json({ success: false, error: "Missing userId or expoPushToken" });
  }

  if (!Expo.isExpoPushToken(expoPushToken)) {
    return res.status(400).json({ success: false, error: "Invalid Expo push token" });
  }

  try {
    // Update user with push token and language
    const updateData = {
      push_token: expoPushToken,
      updated_at: new Date().toISOString()
    };

    if (language) {
      updateData.preferred_language = normalizeLanguageCode(language);
    }

    const { error } = await supabase
      .from("users")
      .update(updateData)
      .eq("id", userId);

    if (error) throw error;

    res.json({ success: true, message: "Token saved successfully" });
  } catch (error) {
    console.error("Error saving device token:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. Get Target Users (for dashboard)
router.get("/target-users", async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const lang = req.query.lang; // Get language filter
  const offset = (page - 1) * limit;

  try {
    // Start building the query
    let query = supabase
      .from("users")
      .select("id, created_at, preferred_language, is_pro", { count: "exact" })
      .not("push_token", "is", null);

    // Apply language filter if provided
    if (lang) {
      // Using ilike for case-insensitive matching, and % wildcard to match locales like en-US
      query = query.ilike("preferred_language", `${lang}%`);
    }

    // Apply ordering and pagination
    const { data: users, error, count } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    res.json({
      success: true,
      users,
      pagination: {
        total: count,
        page,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error("Error fetching target users:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Send to Single User
router.post("/send-to-user", async (req, res) => {
  const { userId, messages, data, onlyNonPro } = req.body;

  if (!userId || !messages || !messages.en) {
    return res.status(400).json({ success: false, error: "Missing userId or messages (English is required)" });
  }

  try {
    // Fetch user details
    const { data: user, error } = await supabase
      .from("users")
      .select("push_token, preferred_language, is_pro")
      .eq("id", userId)
      .single();

    if (error) throw error;
    if (!user) return res.status(404).json({ success: false, error: "User not found" });
    if (!user.push_token) return res.status(400).json({ success: false, error: "User has no push token" });

    // Check non-pro condition
    if (onlyNonPro && user.is_pro) {
      return res.json({ success: false, error: "User is Pro, notification skipped" });
    }

    // Determine language
    const userLang = normalizeLanguageCode(user.preferred_language);
    const content = messages[userLang] || messages["en"];

    // Send notification
    const result = await sendPushNotification(userId, content.title, content.body, data);

    if (result.success) {
      res.json({ success: true, message: "Notification sent successfully" });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (error) {
    console.error("Error sending to user:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Send Broadcast (to all target users)
router.post("/send-broadcast", async (req, res) => {
  const { messages, data } = req.body;

  if (!messages || !messages.en) {
    return res.status(400).json({ success: false, error: "Missing messages (English is required)" });
  }

  try {
    // Fetch all users with push token
    let allUsers = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data: users, error } = await supabase
        .from("users")
        .select("id, push_token, preferred_language")
        .not("push_token", "is", null)
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) throw error;

      if (users.length < pageSize) hasMore = false;
      allUsers = allUsers.concat(users);
      page++;
    }

    console.log(`[BROADCAST] Found ${allUsers.length} users with push tokens`);

    const notifications = [];
    let successCount = 0;
    let skipCount = 0;

    for (const user of allUsers) {
      if (!Expo.isExpoPushToken(user.push_token)) {
        skipCount++;
        continue;
      }

      // Determine language
      const userLang = normalizeLanguageCode(user.preferred_language);
      const content = messages[userLang] || messages["en"];

      notifications.push({
        to: user.push_token,
        sound: "default",
        title: content.title,
        body: content.body,
        data: data,
      });
    }

    // Send in chunks using Expo SDK
    const chunks = expo.chunkPushNotifications(notifications);
    const tickets = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
        successCount += chunk.length;
      } catch (error) {
        console.error("Error sending chunk:", error);
      }
    }

    res.json({
      success: true,
      message: `Broadcast sent to ${successCount} users`,
      details: {
        totalFound: allUsers.length,
        sent: successCount,
        skipped: skipCount
      }
    });

  } catch (error) {
    console.error("Error sending broadcast:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
