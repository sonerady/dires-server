const axios = require("axios");

// API base URL - gerçek IP adresi kullan
const API_BASE = "http://172.20.10.6:3001/api/favorites";

// Test user ID
const TEST_USER_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

// Test location data
const TEST_LOCATION = {
  location_id: "test-location-123",
  location_type: "discovery",
  location_title: "Beautiful Beach Location",
  location_image_url: "https://example.com/beach.jpg",
  location_category: "outdoor",
};

async function testFavoritesAPI() {
  console.log("🧪 Testing Favorites API...");
  console.log("📍 API Base:", API_BASE);
  console.log("👤 Test User ID:", TEST_USER_ID);
  console.log("");

  try {
    // Test 1: Get empty favorites list
    console.log("1️⃣ Testing: Get empty favorites list");
    try {
      const response = await axios.get(`${API_BASE}/${TEST_USER_ID}`);
      console.log("✅ Response:", response.data);
      console.log(`📊 Found ${response.data.data.length} favorites`);
    } catch (error) {
      console.error("❌ Error:", error.response?.data || error.message);
    }
    console.log("");

    // Test 2: Add favorite
    console.log("2️⃣ Testing: Add favorite");
    try {
      const response = await axios.post(API_BASE, {
        user_id: TEST_USER_ID,
        ...TEST_LOCATION,
      });
      console.log("✅ Response:", response.data);
    } catch (error) {
      console.error("❌ Error:", error.response?.data || error.message);
    }
    console.log("");

    // Test 3: Get favorites list (should have 1 item)
    console.log("3️⃣ Testing: Get favorites list with item");
    try {
      const response = await axios.get(`${API_BASE}/${TEST_USER_ID}`);
      console.log("✅ Response:", response.data);
      console.log(`📊 Found ${response.data.data.length} favorites`);
    } catch (error) {
      console.error("❌ Error:", error.response?.data || error.message);
    }
    console.log("");

    // Test 4: Check if location is favorite
    console.log("4️⃣ Testing: Check if location is favorite");
    try {
      const response = await axios.get(
        `${API_BASE}/${TEST_USER_ID}/check/${TEST_LOCATION.location_id}`
      );
      console.log("✅ Response:", response.data);
      console.log(`💖 Is favorite: ${response.data.is_favorite}`);
    } catch (error) {
      console.error("❌ Error:", error.response?.data || error.message);
    }
    console.log("");

    // Test 5: Try to add same favorite (should fail)
    console.log("5️⃣ Testing: Add duplicate favorite (should fail)");
    try {
      const response = await axios.post(API_BASE, {
        user_id: TEST_USER_ID,
        ...TEST_LOCATION,
      });
      console.log("✅ Response:", response.data);
    } catch (error) {
      console.log(
        "✅ Expected error (duplicate):",
        error.response?.data || error.message
      );
    }
    console.log("");

    // Test 6: Toggle favorite (should remove)
    console.log("6️⃣ Testing: Toggle favorite (remove)");
    try {
      const response = await axios.post(`${API_BASE}/toggle`, {
        user_id: TEST_USER_ID,
        location_id: TEST_LOCATION.location_id,
      });
      console.log("✅ Response:", response.data);
      console.log(`🔄 Action: ${response.data.action}`);
    } catch (error) {
      console.error("❌ Error:", error.response?.data || error.message);
    }
    console.log("");

    // Test 7: Toggle favorite again (should add)
    console.log("7️⃣ Testing: Toggle favorite (add)");
    try {
      const response = await axios.post(`${API_BASE}/toggle`, {
        user_id: TEST_USER_ID,
        location_id: TEST_LOCATION.location_id,
        location_type: TEST_LOCATION.location_type,
        location_title: TEST_LOCATION.location_title,
        location_image_url: TEST_LOCATION.location_image_url,
        location_category: TEST_LOCATION.location_category,
      });
      console.log("✅ Response:", response.data);
      console.log(`🔄 Action: ${response.data.action}`);
    } catch (error) {
      console.error("❌ Error:", error.response?.data || error.message);
    }
    console.log("");

    // Test 8: Get favorites stats
    console.log("8️⃣ Testing: Get favorites stats");
    try {
      const response = await axios.get(`${API_BASE}/${TEST_USER_ID}/stats`);
      console.log("✅ Response:", response.data);
      console.log(`📊 Total favorites: ${response.data.data.total}`);
      console.log(`📋 By type:`, response.data.data.by_type);
    } catch (error) {
      console.error("❌ Error:", error.response?.data || error.message);
    }
    console.log("");

    // Test 9: Delete favorite
    console.log("9️⃣ Testing: Delete favorite");
    try {
      const response = await axios.delete(
        `${API_BASE}/${TEST_USER_ID}/${TEST_LOCATION.location_id}`
      );
      console.log("✅ Response:", response.data);
    } catch (error) {
      console.error("❌ Error:", error.response?.data || error.message);
    }
    console.log("");

    // Test 10: Final favorites list (should be empty)
    console.log("🔟 Testing: Final favorites list (should be empty)");
    try {
      const response = await axios.get(`${API_BASE}/${TEST_USER_ID}`);
      console.log("✅ Response:", response.data);
      console.log(`📊 Found ${response.data.data.length} favorites`);
    } catch (error) {
      console.error("❌ Error:", error.response?.data || error.message);
    }

    console.log("");
    console.log("🎉 API Testing completed!");
  } catch (error) {
    console.error("💥 Test suite failed:", error.message);
  }
}

// Run tests
if (require.main === module) {
  testFavoritesAPI();
}

module.exports = { testFavoritesAPI };
