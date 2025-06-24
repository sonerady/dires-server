// RevenueCat API ile user temizleme scripti
const fetch = require("node-fetch");

const REVENUECAT_SECRET_KEY = "your_secret_key_here"; // RevenueCat dashboard'dan al
const PROJECT_ID = "your_project_id_here";

async function deleteRevenueCatUser(userId) {
  try {
    console.log(`🗑️ Deleting RevenueCat user: ${userId}`);

    const response = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${userId}`,
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
      console.error(
        `❌ Failed to delete user: ${response.status} ${response.statusText}`
      );
      return false;
    }
  } catch (error) {
    console.error(`❌ Error deleting user:`, error);
    return false;
  }
}

async function clearProblematicUsers() {
  const problematicUsers = [
    "d874632c-a011-46b3-9e39-cd544c915cc8",
    "f07xxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    // Diğer problematik user ID'leri buraya ekle
  ];

  for (const userId of problematicUsers) {
    await deleteRevenueCatUser(userId);
    // Rate limiting için bekleme
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// Script'i çalıştır
if (require.main === module) {
  clearProblematicUsers().then(() => {
    console.log("🎉 RevenueCat user cleanup completed");
  });
}

module.exports = { deleteRevenueCatUser };
