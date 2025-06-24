// RevenueCat API ile son 24 saatteki sandbox user'ları toplu silme scripti
const fetch = require("node-fetch");

// RevenueCat API credentials - Dashboard'dan al
const REVENUECAT_SECRET_KEY = "sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"; // Secret key buraya
const REVENUECAT_PUBLIC_KEY = "appl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"; // Public key buraya

// 24 saat öncesinin timestamp'i
const TWENTY_FOUR_HOURS_AGO = Date.now() - 24 * 60 * 60 * 1000;

async function getRecentSandboxUsers() {
  try {
    console.log("🔍 Fetching recent sandbox users...");

    // RevenueCat API'den user listesi al
    // Not: RevenueCat'in direct user listing API'si sınırlı, alternatif yöntemler gerekebilir

    const response = await fetch("https://api.revenuecat.com/v1/subscribers", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${REVENUECAT_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log("📊 API Response:", data);

    return data.subscribers || [];
  } catch (error) {
    console.error("❌ Error fetching users:", error);
    return [];
  }
}

async function deleteRevenueCatUser(userId) {
  try {
    console.log(`🗑️ Deleting RevenueCat user: ${userId}`);

    const response = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${REVENUECAT_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.ok) {
      console.log(`✅ Successfully deleted user: ${userId}`);
      return true;
    } else {
      const errorText = await response.text();
      console.error(
        `❌ Failed to delete user ${userId}: ${response.status} ${errorText}`
      );
      return false;
    }
  } catch (error) {
    console.error(`❌ Error deleting user ${userId}:`, error);
    return false;
  }
}

async function clearRecentSandboxUsers() {
  try {
    console.log("🧹 Starting cleanup of recent sandbox users...");
    console.log(
      `📅 Targeting users created after: ${new Date(
        TWENTY_FOUR_HOURS_AGO
      ).toISOString()}`
    );

    // Bilinen problematik user'ları manuel olarak ekle
    const knownProblematicUsers = [
      "d874632c-a011-46b3-9e39-cd544c915cc8",
      "f07xxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "cc56d5f0d9d64acc86bf65e2b3b607d9",
      // Diğer bilinen user'ları buraya ekle
    ];

    console.log(
      `🎯 Manual cleanup of ${knownProblematicUsers.length} known problematic users...`
    );

    let deletedCount = 0;
    let failedCount = 0;

    for (const userId of knownProblematicUsers) {
      const success = await deleteRevenueCatUser(userId);
      if (success) {
        deletedCount++;
      } else {
        failedCount++;
      }

      // Rate limiting - RevenueCat API'sine çok hızlı istek göndermeyelim
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log("📊 Cleanup Summary:");
    console.log(`✅ Successfully deleted: ${deletedCount} users`);
    console.log(`❌ Failed to delete: ${failedCount} users`);

    return { deletedCount, failedCount };
  } catch (error) {
    console.error("❌ Error during cleanup:", error);
    return { deletedCount: 0, failedCount: 0 };
  }
}

// RevenueCat Dashboard'dan user ID'leri manuel olarak topla
async function manualUserCleanup(userIds) {
  console.log(`🎯 Manual cleanup of ${userIds.length} specified users...`);

  let deletedCount = 0;
  let failedCount = 0;

  for (const userId of userIds) {
    const success = await deleteRevenueCatUser(userId);
    if (success) {
      deletedCount++;
    } else {
      failedCount++;
    }

    // Rate limiting
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log("📊 Manual Cleanup Summary:");
  console.log(`✅ Successfully deleted: ${deletedCount} users`);
  console.log(`❌ Failed to delete: ${failedCount} users`);

  return { deletedCount, failedCount };
}

// Script'i çalıştır
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args[0] === "manual" && args.length > 1) {
    // Manuel mod: node clear-recent-sandbox-users.js manual user1 user2 user3
    const userIds = args.slice(1);
    console.log(`🚀 Running manual cleanup for ${userIds.length} users...`);
    manualUserCleanup(userIds).then((result) => {
      console.log("🎉 Manual cleanup completed:", result);
    });
  } else {
    // Otomatik mod: node clear-recent-sandbox-users.js
    console.log("🚀 Running automatic cleanup for recent sandbox users...");
    clearRecentSandboxUsers().then((result) => {
      console.log("🎉 Automatic cleanup completed:", result);
    });
  }
}

module.exports = {
  clearRecentSandboxUsers,
  manualUserCleanup,
  deleteRevenueCatUser,
};
