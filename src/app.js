// app.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");

// Security middleware
const { requireAuth } = require("./middleware/authMiddleware");
const { catalogRateLimiter, botDetection, requireBrowser } = require("./middleware/rateLimiter");

// Mevcut route'ların import'ları
const imageRoutes = require("./routes/imageRoutes");
const backgroundGeneratorRouter = require("./routes/backgroundGenerator");
const generateFirstShootRouter = require("./routes/generateFirstShoot");
const generatePhotoshootRouter = require("./routes/generatePhotoshoot");
const getModelRouter = require("./routes/getModel");
const listTraingsRouter = require("./routes/listModels");
const getTraining = require("./routes/getTraining");
const updateCreditRouter = require("./routes/updateCredit");
const changePose = require("./routes/changePose");
const changePoseWeb = require("./routes/changePoseWeb");
const createRefiner = require("./routes/createRefiner");
const createRefinerWeb = require("./routes/createRefinerWeb");
const changeProductColor = require("./routes/changeProductColor");
const changeProductColorWeb = require("./routes/changeProductColorWeb");
const backSideCloset = require("./routes/backSideCloset");
const backSideClosetWeb = require("./routes/backSideClosetWeb");

const getUserRouter = require("./routes/getUser");
const geminiImageEditRouter = require("./routes/geminiImageEdit");
const referenceBrowserRoutesBack = require("./routes/referenceBrowserRoutesBack");
const notificationRoutes = require("./routes/notificationRoutes");
const addProductRouter = require("./routes/addProduct");
const getUserProductRouter = require("./routes/getUserProduct");
const editRoomRoutes = require("./routes/editRoomRoutes");
const chatEditRoutes = require("./routes/chatEditRoutes");
const removeBgRouter = require("./routes/removeBg");
const backgroundRemoveRoutes = require("./routes/backgroundRemoveRoutes");
const uploadImageRouter = require("./routes/uploadImage");
const generateTrain = require("./routes/generateTrain");
const referenceBrowserRoutesV2 = require("./routes/referenceBrowserRoutesV2");
const referenceBrowserRoutesV3 = require("./routes/referenceBrowserRoutesV3");
const referenceBrowserRoutesV4 = require("./routes/referenceBrowserRoutesV4");
const referenceBrowserRoutesV5 = require("./routes/referenceBrowserRoutesV5");
const referenceBrowserRoutesV6 = require("./routes/referenceBrowserRoutesV6");
const referenceBrowserRoutesV7 = require("./routes/referenceBrowserRoutesV7");
const referenceJewelryBrowserRoutesV4 = require("./routes/referenceJewelryBrowserRoutesV4");
const referenceJewelryBrowserRoutesWeb = require("./routes/referenceJewelryBrowserRoutesWeb");

const referenceBrowserRoutesWithoutCanvas = require("./routes/referenceBrowserRoutesWithoutCanvas");
const checkStatusRouter = require("./routes/checkStatus");
const getTrainRequestRouter = require("./routes/getTrainRequest");
const getRequests = require("./routes/getRequests");
const getBalance = require("./routes/getBalance");
const generatePredictionsRouter = require("./routes/generatePredictions");
const generateImgToVidRouter = require("./routes/generateImgToVid");
const generateImgToVidv2Router = require("./routes/generateImgToVidv2"); // Seedance 2.0
const generateImgToVidv3Router = require("./routes/generateImgToVidv3"); // Veo 3.1 Fast
const generateImgToVidWebRouter = require("./routes/generateImgToVidWeb");
const videoPreviewGridRouter = require("./routes/videoPreviewGridRoutes"); // 🧩 Storyboard preview (nano-banana 6-scene grid)
const albumsRouter = require("./routes/albumsRoutes"); // 📁 History albums CRUD
const shareRouter = require("./routes/shareRoutes"); // 🔗 Public share tokens + /api/public/share/:token
const getPredictionsRouter = require("./routes/getPredictions");
const registerAnonymousUserRouter = require("./routes/registerAnonymousUser");
const registerAnonymousUserRouterV2 = require("./routes/registerAnonymousUserV2");
const registerAnonymousUserRouterV3 = require("./routes/registerAnonymousUserV3");
const userMetadataRouter = require("./routes/userMetadataRoutes");
const posesRouter = require("./routes/posesRoutes");
const generateImagesJsonRouter = require("./routes/generateImagesJson");
const locationRoutes = require("./routes/locationRoutes");
const backgroundRoutes = require("./routes/backgroundRoutes");
const imageEnhancementRouter = require("./routes/imageEnhancement");
const imageEnhancementWebRouter = require("./routes/imageEnhancementWeb");
const faceSwapRouter = require("./routes/faceSwap");
const geminiImageProcessRouter = require("./routes/geminiImageProcess");
const createAiBackgroundRouter = require("./routes/createAiBackground");
const imageClarityProcessRouter = require("./routes/imageClarityProcess");
const referenceBrowserRoutes = require("./routes/referenceBrowserRoutes");
const referenceBrowserRoutesWeb = require("./routes/referenceBrowserRoutesWeb");
const imageScraperRoutes = require("./routes/imageScraperRoutes");
const referencePhotoshootRoutes = require("./routes/referencePhotoshootRoutes");
const referenceRefinerRoutes = require("./routes/referenceRefinerRoutes");
const referenceImageRoutes = require("./routes/referenceImageRoutes");
const bodyShapeRoutes = require("./routes/bodyShapeRoutes");
const historyRoutes = require("./routes/historyRoutes");
const historyRoutesWeb = require("./routes/historyRoutesWeb");
const featureHistoryRoutes = require("./routes/featureHistoryRoutes");
const featureHistoryRoutesWeb = require("./routes/featureHistoryRoutesWeb");
const hairStyleRoutes = require("./routes/hairStyleRoutes");
const hairColorRoutes = require("./routes/hairColorRoutes");
const aiBackgroundsRouter = require("./routes/aiBackgroundsRoutes");
const poseRoutes = require("./routes/poseRoutes"); // Eski poseRoutes geri getirildi
const purchaseRoutes = require("./routes/purchaseRoutes");
const purchaseSummaryRoutes = require("./routes/purchaseSummaryRoutes");
const appConfigRoutes = require("./routes/appConfigRoutes");
const consRoutes = require("./routes/consRoutes");
const changeColorRoutes = require("./routes/changeColorRoutes_v1");
const changeColorRoutesV2 = require("./routes/changeColorRoutesV3");
const infoModalRoutes = require("./routes/infoModalRoutes");
const appLinksRoutes = require("./routes/appLinksRoutes");
const modalContentsRoutes = require("./routes/modalContentsRoutes");
const modelPosesRoutes = require("./routes/modelPosesRoutes"); // Yeni eklenen route
const modelPosesRoutesWeb = require("./routes/modelPosesRoutesWeb");
// RevenueCat webhook route import
const revenuecatWebhookRouterv2 = require("./routes/revenuecatWebhookv2");
const revenuecatWebhookRouterv4 = require("./routes/revenuecatWebhookv4");
// const revenuecatWebhookRouter = require("./routes/revenuecatWebhook"); // ESKİ WEBHOOK DEVRE DIŞI
// Custom Pose routes import
const customPoseRoutes = require("./routes/customPoseRoutes");
const customPoseRoutesWeb = require("./routes/customPoseRoutesWeb");
// Custom Hair Style routes import
const customHairStyleRoutes = require("./routes/customHairStyleRoutes");
const customHairStyleRoutesWeb = require("./routes/customHairStyleRoutesWeb");
// Pose Favorites routes import
const poseFavoritesRoutes = require("./routes/poseFavoritesRoutes");
const poseFavoritesRoutesWeb = require("./routes/poseFavoritesRoutesWeb");
// Hair Style Favorites routes import
const hairStyleFavoritesRoutes = require("./routes/hairStyleFavoritesRoutes");
const hairStyleFavoritesRoutesWeb = require("./routes/hairStyleFavoritesRoutesWeb");
// Marketing Banner routes import
const marketingBannerRoutes = require("./routes/marketingBannerRoutes");
// Canvas Combine routes import
const canvasCombineRoutes = require("./routes/canvasCombineRoutes");
// Icon Generator routes import
const iconGeneratorRoutes = require("./routes/iconGeneratorRoutes");
// Create Location routes import
const createLocationRoutes = require("./routes/createLocationRoutes");
const createLocationRoutesV2 = require("./routes/createLocationRoutes_v2");
const createLocationRoutesV3 = require("./routes/createLocationRoutes_v3");
const createLocationRoutesWeb = require("./routes/createLocationRoutesWeb");
const createLocationRoutesWebV2 = require("./routes/createLocationRoutesWebV2");
// Search Location routes import
const searchLocationRoutes = require("./routes/searchLocationRoutes");
const searchLocationRoutesWeb = require("./routes/searchLocationRoutesWeb");
// Location Suggestion routes import
const locationSuggestionRoutes = require("./routes/locationSuggestionRoutes");
const locationSuggestionRoutesWeb = require("./routes/locationSuggestionRoutesWeb");
// Create Model routes import
const createModelRoutes = require("./routes/createModelRoutes");
const createModelRoutesWeb = require("./routes/createModelRoutesWeb");
// Favorites routes import
const favoritesRoutes = require("./routes/favoritesRoutes");
const favoritesRoutesWeb = require("./routes/favoritesRoutesWeb");
// Video routes import
const videoRoutes = require("./routes/videoRoutes");
// Hair Styles routes import
const hairStylesRoutes = require("./routes/hairStylesRoutes");
const hairStylesRoutesWeb = require("./routes/hairStylesRoutesWeb");
// Admin Dashboard routes import
const adminDashboardRoutes = require("./routes/adminDashboardRoutes");
const adminAuthRoutes = require("./routes/adminAuthRoutes");
const adminBulkEmailRoutes = require("./routes/adminBulkEmailRoutes");
const adminAsoRoutes = require("./routes/adminAsoRoutes");
const { startAsoCron } = require("./services/asoTracker");
const { requireAdmin } = require("./middleware/requireAdmin");
// User Visibility routes import
const userVisibilityRoutes = require("./routes/userVisibilityRoutes");
// Push Notification routes import
const pushNotificationRoutes = require("./routes/pushNotificationRoutes");
// Banner AI Fill route import
const bannerAiFillRouter = require("./routes/bannerAiFill");
const { startScheduler } = require("./services/schedulerService");
const {
  startOneSignalMarketingScheduler,
} = require("./services/oneSignalMarketingScheduler");
const {
  startOneSignalTagSyncCron,
} = require("./services/oneSignalTagSyncCron");

// Start the daily notification scheduler (Expo push, low-credit reminders)
// DISABLED: günlük Expo push bildirimleri kullanıcı isteğiyle kapatıldı.
// startScheduler();

// Start the OneSignal weekly marketing scheduler (non-Pro retention)
// Her gün 08:00 UTC → o günün kampanyası → Non-Pro Users segmenti
// → user'ın kendi dilinde, kendi yerel 20:00'ında teslim
// DISABLED: pazarlama bildirimleri kullanıcı isteğiyle kapatıldı.
// startOneSignalMarketingScheduler();

// Daily safety-net: rewrites is_pro / is_in_trial OneSignal tags for ALL
// users from the canonical `users` table (which RC webhooks keep updated).
// Real-time path is via webhook res.on('finish') in revenuecatWebhookv2/v3.js.
startOneSignalTagSyncCron();

// Auth routes import
const authRoutes = require("./routes/authRoutes");
const authRoutesWeb = require("./routes/authRoutesWeb");
// Generate Product Kit routes import
const generateProductKitRoutes = require("./routes/generateProductKitRoutes");
const generateProductKitRoutesV2 = require("./routes/generateProductKitRoutesV2");
// Generate Product Story routes import
const generateProductStoryRoutes = require("./routes/generateProductStoryRoutes");
// Generate Street Icon Kit routes import
const generateStreetIconKitRoutes = require("./routes/generateStreetIconKitRoutes");
// Generate Fashion Kit routes import
const generateFashionKitRoutes = require("./routes/generateFashionKitRoutes");
// Generate Unboxing Story routes import
const generateUnboxingStoryRoutes = require("./routes/generateUnboxingStoryRoutes");
// Team routes import
const teamRoutes = require("./routes/teamRoutes");
const teamRoutesWeb = require("./routes/teamRoutesWeb");
// Notification routes Web import
const notificationRoutesWeb = require("./routes/notificationRoutesWeb");
// What's New routes import
const whatsNewRoutes = require("./routes/whatsNewRoutes");
// Generation Status routes import

const app = express();
app.set('trust proxy', 1); // Trust first proxy (Railway)

// CORS ayarlarını daha esnek hale getir
app.use(
  cors({
    origin: "*", // Tüm originlere izin ver
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-User-ID"],
  }),
);

// LemonSqueezy webhook - MUST be before bodyParser.json() to preserve raw body for signature verification
const lemonsqueezyWebhook = require("./routes/lemonsqueezyWebhook");
app.use("/api/lemonsqueezy", express.raw({ type: "application/json" }), lemonsqueezyWebhook);

app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

// Results klasörüne statik dosya erişimi sağla
app.use("/results", express.static(path.join(__dirname, "../results")));

// Icon Generator UI'yi serve et
app.get("/icon-generator-ui.html", (req, res) => {
  res.sendFile(path.join(__dirname, "../icon-generator-ui.html"));
});

// Notification Dashboard UI'yi serve et
app.get("/notification-dashboard.html", (req, res) => {
  res.sendFile(path.join(__dirname, "../notification-dashboard.html"));
});

// Admin Dashboard UI'yi serve et
app.get("/admin-dashboard.html", (req, res) => {
  res.sendFile(path.join(__dirname, "../admin-dashboard.html"));
});

// OneSignal Test Panel UI'yi serve et
app.get("/onesignal-test.html", (req, res) => {
  res.sendFile(path.join(__dirname, "../onesignal-test.html"));
});

// Basit test endpointi ekle
app.get("/test", (req, res) => {
  console.log("Test endpoint was called from:", req.ip);
  res.json({
    success: true,
    message: "API bağlantı testi başarılı!",
    timestamp: new Date().toISOString(),
  });
});

// API durumunu kontrol endpointi
app.get("/api/status", (req, res) => {
  console.log("Status check called from:", req.ip);
  res.json({
    status: "online",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

// Mevcut route tanımlamaları
app.use("/api", backgroundGeneratorRouter);
app.use("/api/images", imageRoutes);
app.use("/api/generateFirstShoot", generateFirstShootRouter);
app.use("/api/generatePhotoshoot", generatePhotoshootRouter);
app.use("/api/getModel", getModelRouter);
app.use("/api/listTrainings", listTraingsRouter);
app.use("/api/getTraining", getTraining);
app.use("/api/imageEnhancement", imageEnhancementRouter);
app.use("/api/imageEnhancementWeb", requireBrowser, requireAuth, imageEnhancementWebRouter);
app.use("/api/faceSwap", faceSwapRouter);
app.use("/api", updateCreditRouter);
app.use("/api", getUserRouter);
app.use("/api/push-notifications", pushNotificationRoutes);
app.use("/api", notificationRoutes);
app.use("/api/notificationsWeb", requireBrowser, requireAuth, notificationRoutesWeb);
app.use("/api/uploadImage", uploadImageRouter);
app.use("/api", generateTrain);
app.use("/api/checkStatus", checkStatusRouter);
app.use("/api", getTrainRequestRouter);
app.use("/api", getRequests);
app.use("/api", addProductRouter);
app.use("/api", getUserProductRouter);
app.use("/api", removeBgRouter);
const removeBgPixelcutRouter = require("./routes/removeBgPixelcut");
app.use("/api", removeBgPixelcutRouter);
app.use("/api/background-remove", backgroundRemoveRoutes);
app.use("/api", generatePredictionsRouter);
app.use("/api", getPredictionsRouter);
app.use("/api", getBalance);
const refinerDownloadRoutes = require("./routes/refinerDownloadRoutes");
// Debug middleware for refiner-download
app.use("/api/refiner-download", (req, res, next) => {
  console.log(
    "🔍 [DEBUG] Refiner-download request received:",
    req.method,
    req.url,
  );
  next();
});
app.use("/api/refiner-download", refinerDownloadRoutes);

app.use("/api", registerAnonymousUserRouter);
app.use("/api/v2", registerAnonymousUserRouterV2);
app.use("/api/v3", registerAnonymousUserRouterV3);
app.use("/api/users", userMetadataRouter);
app.use("/api", generateImgToVidRouter);
app.use("/api", generateImgToVidv2Router); // Seedance 2.0
app.use("/api", generateImgToVidv3Router); // Veo 3.1 Fast
app.use("/api", generateImgToVidWebRouter);
app.use("/api", videoPreviewGridRouter); // 🧩 /api/videoPreviewGrid/generate
app.use("/api", albumsRouter); // 📁 /api/albums/*
app.use("/api", shareRouter); // 🔗 /api/share/* + /api/public/share/:token (public)
app.use("/api", posesRouter);
app.use("/api", generateImagesJsonRouter);
app.use("/api", locationRoutes);
app.use("/api/backgrounds", botDetection, catalogRateLimiter, backgroundRoutes);
app.use("/api/bodyshapes", botDetection, catalogRateLimiter, bodyShapeRoutes);
app.use("/api/history", historyRoutes);
app.use("/api/historyWeb", requireBrowser, requireAuth, historyRoutesWeb);
app.use("/api/feature-history", featureHistoryRoutes);
app.use("/api/feature-historyWeb", requireBrowser, requireAuth, featureHistoryRoutesWeb);
app.use("/api/admin-dashboard", adminAuthRoutes);
app.use("/api/admin-dashboard", requireAdmin, adminDashboardRoutes);
app.use("/api/admin-dashboard", requireAdmin, adminBulkEmailRoutes);
app.use("/api/admin-dashboard", requireAdmin, adminAsoRoutes);
startAsoCron();

// Social Studio — Instagram içerik otomasyonu (admin token ile korunur)
const socialStudioRoutes = require("./routes/socialStudioRoutes");
const { startSocialStudioScheduler } = require("./jobs/socialStudioScheduler");
app.use("/api/social-studio", requireAdmin, socialStudioRoutes);
startSocialStudioScheduler();
app.use("/api/onesignal", require("./routes/oneSignalTestRoutes"));
app.use("/api", require("./routes/contentReportRoutes"));

const downloadRoutes = require("./routes/downloadRoutes");
app.use("/api/download", downloadRoutes);
app.use("/api/hairstyles", botDetection, catalogRateLimiter, hairStyleRoutes);
app.use("/api/haircolors", botDetection, catalogRateLimiter, hairColorRoutes);
app.use("/api/banner-ai-fill", bannerAiFillRouter);
app.use("/api", geminiImageProcessRouter);
app.use("/api", imageClarityProcessRouter);
app.use("/api", geminiImageEditRouter);
app.use("/api", aiBackgroundsRouter);
app.use("/api", createAiBackgroundRouter);
app.use("/api/referenceBrowser", referenceBrowserRoutes);
app.use("/api/referenceBrowserBack", referenceBrowserRoutesBack);
app.use("/api/referenceBrowserV2", referenceBrowserRoutesV2);
app.use("/api/referenceBrowserV3", referenceBrowserRoutesV3);
app.use("/api/referenceBrowserV4", referenceBrowserRoutesV4);
app.use("/api/referenceBrowserV5", referenceBrowserRoutesV5);
app.use("/api/referenceBrowserV6", referenceBrowserRoutesV6);
app.use("/api/referenceBrowserV7", referenceBrowserRoutesV7);
app.use("/api/referenceBrowserWeb", requireBrowser, requireAuth, referenceBrowserRoutesWeb);
app.use("/api/image-scraper", requireBrowser, imageScraperRoutes);
app.use("/api/changePose", changePose);
app.use("/api/changePoseWeb", requireBrowser, requireAuth, changePoseWeb);
app.use("/api/createRefiner", createRefiner);
app.use("/api/createRefinerWeb", requireBrowser, requireAuth, createRefinerWeb);

app.use("/api/changeProductColor", changeProductColor);
app.use("/api/changeProductColorWeb", requireBrowser, requireAuth, changeProductColorWeb);
app.use("/api/backSideCloset", backSideCloset);
app.use("/api/backSideClosetWeb", requireBrowser, requireAuth, backSideClosetWeb);

app.use("/api/referenceJewelryBrowserV4", referenceJewelryBrowserRoutesV4);
app.use("/api/referenceJewelryBrowserWeb", requireBrowser, requireAuth, referenceJewelryBrowserRoutesWeb);
app.use("/api/reference-images", referenceImageRoutes);
app.use(
  "/api/referenceBrowserWithoutCanvas",
  referenceBrowserRoutesWithoutCanvas,
);

app.use("/api/referencePhotoshoot", referencePhotoshootRoutes);
app.use("/api/referenceRefiner", referenceRefinerRoutes);
app.use("/api", consRoutes);
app.use("/api", changeColorRoutes);
app.use("/api", changeColorRoutesV2);
app.use("/api/poses", botDetection, catalogRateLimiter, poseRoutes); // Eski poseRoutes geri getirildi
app.use("/api/user", infoModalRoutes);
app.use("/api/editRoom", editRoomRoutes);
app.use("/api/chat-edit", chatEditRoutes);
app.use("/api/canvas", canvasCombineRoutes);
app.use("/api/marketing-banner", marketingBannerRoutes);
// ESKİ WEBHOOK DEVRE DIŞI - Duplicate kredi sorunu yüzünden kapatıldı
// app.use("/revenuecat", revenuecatWebhookRouter);
app.use("/revenuecatv2", revenuecatWebhookRouterv2);
const revenuecatWebhookRouterv3 = require("./routes/revenuecatWebhookv3");
app.use("/revenuecatv3", revenuecatWebhookRouterv3);
app.use("/revenuecatv4", revenuecatWebhookRouterv4);

app.use("/purchase", purchaseRoutes);
app.use("/api/purchase-summary", purchaseSummaryRoutes);
app.use("/api", appConfigRoutes);

// Custom Pose routes ekle
app.use("/api/customPose", customPoseRoutes);
app.use("/api/customPoseWeb", requireBrowser, requireAuth, customPoseRoutesWeb);

// Custom Hair Style routes ekle
app.use("/api/customHairStyle", customHairStyleRoutes);
app.use("/api/customHairStyleWeb", requireBrowser, requireAuth, customHairStyleRoutesWeb);

// Pose Favorites routes ekle
app.use("/api/pose-favorites", poseFavoritesRoutes);
app.use("/api/pose-favoritesWeb", requireBrowser, requireAuth, poseFavoritesRoutesWeb);

// Hair Style Favorites routes ekle
app.use("/api/hair-style-favorites", hairStyleFavoritesRoutes);
app.use("/api/hair-style-favoritesWeb", requireBrowser, requireAuth, hairStyleFavoritesRoutesWeb);

// Last Selected Pose routes ekle
const lastSelectedPoseRoutes = require("./routes/lastSelectedPoseRoutes");
app.use("/api/last-selected-pose", lastSelectedPoseRoutes);

// Create Location routes ekle
app.use("/api/location", createLocationRoutes);
app.use("/api/location/v2", createLocationRoutesV2);
app.use("/api/location/v3", createLocationRoutesV3);
app.use("/api/locationWeb/v2", requireBrowser, requireAuth, createLocationRoutesWebV2);
app.use("/api/locationWeb/v3", requireBrowser, requireAuth, createLocationRoutesWeb);
// Search Location routes ekle
app.use("/api/location/v2", searchLocationRoutes);
app.use("/api/locationWeb/v2", requireBrowser, requireAuth, searchLocationRoutesWeb);

// Location Suggestion routes ekle
app.use("/api/location-suggestions", locationSuggestionRoutes);
app.use("/api/location-suggestionsWeb", requireBrowser, requireAuth, locationSuggestionRoutesWeb);

// Create Model routes ekle
app.use("/api/model", createModelRoutes);
app.use("/api/modelWeb", requireBrowser, requireAuth, createModelRoutesWeb);

// Hair Styles routes ekle
app.use("/api/hair-styles", botDetection, catalogRateLimiter, hairStylesRoutes);
app.use("/api/hair-stylesWeb", requireBrowser, requireAuth, hairStylesRoutesWeb);

// Favorites routes ekle
app.use("/api/favorites", favoritesRoutes);
app.use("/api/favoritesWeb", requireBrowser, requireAuth, favoritesRoutesWeb);

// Video routes ekle
app.use("/api", videoRoutes);

// User Visibility routes ekle
app.use("/api", userVisibilityRoutes);

// Icon Generator routes ekle
app.use("/api/icon-generator", iconGeneratorRoutes);

// App Links routes ekle
app.use("/api/app-links", appLinksRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/authWeb", authRoutesWeb);
const webAuthRoutes = require("./routes/webAuthRoutes");
app.use("/api/web/auth", webAuthRoutes);

// Modal Contents routes ekle
app.use(modalContentsRoutes);

// Model Poses routes ekle (artık /api/posesNew altında olacak)
app.use("/api", modelPosesRoutes); // Yeni eklenen route'u /api/posesNew olarak ayarla
app.use("/api", modelPosesRoutesWeb);

// Generate Product Kit routes
app.use("/api", generateProductKitRoutes);
app.use("/api", generateProductKitRoutesV2);

// Generate Product Story routes
app.use("/api", generateProductStoryRoutes);

// Generate Street Icon Kit routes
app.use("/api", generateStreetIconKitRoutes);

// Generate Fashion Kit routes
app.use("/api", generateFashionKitRoutes);

// Generate Unboxing Story routes
app.use("/api", generateUnboxingStoryRoutes);

// Campaign Kit routes
const campaignKitRoutes = require("./routes/campaignKitRoutes");
app.use("/api/campaign-kit", campaignKitRoutes);

// Support routes
const supportRoutes = require("./routes/supportRoutes");
app.use("/api/support", requireBrowser, requireAuth, supportRoutes);

// Team routes
app.use("/api/teams", teamRoutes);
app.use("/api/teamsWeb", requireBrowser, requireAuth, teamRoutesWeb);

// What's New routes
app.use("/api/whats-new", whatsNewRoutes);

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
  console.log("🔄 Server reloaded with Refiner Download routes!");
  console.log(`Server is accessible at http://localhost:${PORT}`);
  console.log(
    `For mobile devices use your machine's IP address: http://192.168.1.100:${PORT}`,
  );
});
