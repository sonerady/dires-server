// app.js
require('dotenv').config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");

// Mevcut route'ların import'ları
const imageRoutes = require("./routes/imageRoutes");
const backgroundGeneratorRouter = require("./routes/backgroundGenerator");
const generateFirstShootRouter = require("./routes/generateFirstShoot");
const generatePhotoshootRouter = require("./routes/generatePhotoshoot");
const getModelRouter = require("./routes/getModel");
const listTraingsRouter = require("./routes/listModels");
const getTraining = require("./routes/getTraining");
const updateCreditRouter = require("./routes/updateCredit");
const getUserRouter = require("./routes/getUser");
const geminiImageEditRouter = require("./routes/geminiImageEdit");
const referenceBrowserRoutesBack = require("./routes/referenceBrowserRoutesBack");
const notificationRoutes = require("./routes/notificationRoutes");
const addProductRouter = require("./routes/addProduct");
const getUserProductRouter = require("./routes/getUserProduct");
const editRoomRoutes = require("./routes/editRoomRoutes");
const removeBgRouter = require("./routes/removeBg");
const uploadImageRouter = require("./routes/uploadImage");
const generateTrain = require("./routes/generateTrain");
const referenceBrowserRoutesV2 = require("./routes/referenceBrowserRoutesV2");
const referenceBrowserRoutesV3 = require("./routes/referenceBrowserRoutesV3");
const referenceBrowserRoutesV4 = require("./routes/referenceBrowserRoutesV4");
const referenceBrowserRoutesV5 = require("./routes/referenceBrowserRoutesV5");
const referenceJewelryBrowserRoutesV4 = require("./routes/referenceJewelryBrowserRoutesV4");

const referenceBrowserRoutesWithoutCanvas = require("./routes/referenceBrowserRoutesWithoutCanvas");
const checkStatusRouter = require("./routes/checkStatus");
const getTrainRequestRouter = require("./routes/getTrainRequest");
const getRequests = require("./routes/getRequests");
const getBalance = require("./routes/getBalance");
const generatePredictionsRouter = require("./routes/generatePredictions");
const generateImgToVidRouter = require("./routes/generateImgToVid");
const getPredictionsRouter = require("./routes/getPredictions");
const registerAnonymousUserRouter = require("./routes/registerAnonymousUser");
const registerAnonymousUserRouterV2 = require("./routes/registerAnonymousUserV2");
const registerAnonymousUserRouterV3 = require("./routes/registerAnonymousUserV3");
const posesRouter = require("./routes/posesRoutes");
const generateImagesJsonRouter = require("./routes/generateImagesJson");
const locationRoutes = require("./routes/locationRoutes");
const backgroundRoutes = require("./routes/backgroundRoutes");
const imageEnhancementRouter = require("./routes/imageEnhancement");
const faceSwapRouter = require("./routes/faceSwap");
const geminiImageProcessRouter = require("./routes/geminiImageProcess");
const createAiBackgroundRouter = require("./routes/createAiBackground");
const imageClarityProcessRouter = require("./routes/imageClarityProcess");
const referenceBrowserRoutes = require("./routes/referenceBrowserRoutes");
const referencePhotoshootRoutes = require("./routes/referencePhotoshootRoutes");
const referenceRefinerRoutes = require("./routes/referenceRefinerRoutes");
const referenceImageRoutes = require("./routes/referenceImageRoutes");
const bodyShapeRoutes = require("./routes/bodyShapeRoutes");
const historyRoutes = require("./routes/historyRoutes");
const hairStyleRoutes = require("./routes/hairStyleRoutes");
const hairColorRoutes = require("./routes/hairColorRoutes");
const aiBackgroundsRouter = require("./routes/aiBackgroundsRoutes");
const poseRoutes = require("./routes/poseRoutes"); // Eski poseRoutes geri getirildi
const purchaseRoutes = require("./routes/purchaseRoutes");
const purchaseSummaryRoutes = require("./routes/purchaseSummaryRoutes");
const appConfigRoutes = require("./routes/appConfigRoutes");
const consRoutes = require("./routes/consRoutes");
const changeColorRoutes = require("./routes/changeColorRoutes");
const changeColorRoutesV2 = require("./routes/changeColorRoutesV2");
const infoModalRoutes = require("./routes/infoModalRoutes");
const appLinksRoutes = require("./routes/appLinksRoutes");
const modalContentsRoutes = require("./routes/modalContentsRoutes");
const modelPosesRoutes = require("./routes/modelPosesRoutes"); // Yeni eklenen route
// RevenueCat webhook route import
const revenuecatWebhookRouterv2 = require("./routes/revenuecatWebhookv2");
// const revenuecatWebhookRouter = require("./routes/revenuecatWebhook"); // ESKİ WEBHOOK DEVRE DIŞI
// Custom Pose routes import
const customPoseRoutes = require("./routes/customPoseRoutes");
// Custom Hair Style routes import
const customHairStyleRoutes = require("./routes/customHairStyleRoutes");
// Pose Favorites routes import
const poseFavoritesRoutes = require("./routes/poseFavoritesRoutes");
// Hair Style Favorites routes import
const hairStyleFavoritesRoutes = require("./routes/hairStyleFavoritesRoutes");
// Canvas Combine routes import
const canvasCombineRoutes = require("./routes/canvasCombineRoutes");
// Icon Generator routes import
const iconGeneratorRoutes = require("./routes/iconGeneratorRoutes");
// Create Location routes import
const createLocationRoutes = require("./routes/createLocationRoutes");
const createLocationRoutesV2 = require("./routes/createLocationRoutes_v2");
const createLocationRoutesV3 = require("./routes/createLocationRoutes_v3");
// Search Location routes import
const searchLocationRoutes = require("./routes/searchLocationRoutes");
// Location Suggestion routes import
const locationSuggestionRoutes = require("./routes/locationSuggestionRoutes");
// Create Model routes import
const createModelRoutes = require("./routes/createModelRoutes");
// Favorites routes import
const favoritesRoutes = require("./routes/favoritesRoutes");
// Video routes import
const videoRoutes = require("./routes/videoRoutes");
// Hair Styles routes import
const hairStylesRoutes = require("./routes/hairStylesRoutes");
// User Visibility routes import
const userVisibilityRoutes = require("./routes/userVisibilityRoutes");
// Push Notification routes import
const pushNotificationRoutes = require("./routes/pushNotificationRoutes");
const { startScheduler } = require("./services/schedulerService");

// Start the daily notification scheduler
startScheduler();

// Auth routes import
const authRoutes = require("./routes/authRoutes");
// Generate Product Kit routes import
const generateProductKitRoutes = require("./routes/generateProductKitRoutes");
// Generation Status routes import

const app = express();

// CORS ayarlarını daha esnek hale getir
app.use(
  cors({
    origin: "*", // Tüm originlere izin ver
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-User-ID"],
  })
);
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
app.use("/api/faceSwap", faceSwapRouter);
app.use("/api", updateCreditRouter);
app.use("/api", getUserRouter);
app.use("/api/push-notifications", pushNotificationRoutes);
app.use("/api", notificationRoutes);
app.use("/api/uploadImage", uploadImageRouter);
app.use("/api", generateTrain);
app.use("/api/checkStatus", checkStatusRouter);
app.use("/api", getTrainRequestRouter);
app.use("/api", getRequests);
app.use("/api", addProductRouter);
app.use("/api", getUserProductRouter);
app.use("/api", removeBgRouter);
app.use("/api", generatePredictionsRouter);
app.use("/api", getPredictionsRouter);
app.use("/api", getBalance);
const refinerDownloadRoutes = require("./routes/refinerDownloadRoutes");
// Debug middleware for refiner-download
app.use("/api/refiner-download", (req, res, next) => {
  console.log("🔍 [DEBUG] Refiner-download request received:", req.method, req.url);
  next();
});
app.use("/api/refiner-download", refinerDownloadRoutes);

app.use("/api", registerAnonymousUserRouter);
app.use("/api/v2", registerAnonymousUserRouterV2);
app.use("/api/v3", registerAnonymousUserRouterV3);
app.use("/api", generateImgToVidRouter);
app.use("/api", posesRouter);
app.use("/api", generateImagesJsonRouter);
app.use("/api", locationRoutes);
app.use("/api/backgrounds", backgroundRoutes);
app.use("/api/bodyshapes", bodyShapeRoutes);
app.use("/api/history", historyRoutes);

const downloadRoutes = require("./routes/downloadRoutes");
app.use("/api/download", downloadRoutes);
app.use("/api/hairstyles", hairStyleRoutes);
app.use("/api/haircolors", hairColorRoutes);
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
app.use("/api/referenceJewelryBrowserV4", referenceJewelryBrowserRoutesV4);
app.use("/api/reference-images", referenceImageRoutes);
app.use(
  "/api/referenceBrowserWithoutCanvas",
  referenceBrowserRoutesWithoutCanvas
);

app.use("/api/referencePhotoshoot", referencePhotoshootRoutes);
app.use("/api/referenceRefiner", referenceRefinerRoutes);
app.use("/api", consRoutes);
app.use("/api", changeColorRoutes);
app.use("/api", changeColorRoutesV2);
app.use("/api/poses", poseRoutes); // Eski poseRoutes geri getirildi
app.use("/api/user", infoModalRoutes);
app.use("/api/editRoom", editRoomRoutes);
app.use("/api/canvas", canvasCombineRoutes);
// ESKİ WEBHOOK DEVRE DIŞI - Duplicate kredi sorunu yüzünden kapatıldı
// app.use("/revenuecat", revenuecatWebhookRouter);
app.use("/revenuecatv2", revenuecatWebhookRouterv2);
const revenuecatWebhookRouterv3 = require("./routes/revenuecatWebhookv3");
app.use("/revenuecatv3", revenuecatWebhookRouterv3);

app.use("/purchase", purchaseRoutes);
app.use("/api/purchase-summary", purchaseSummaryRoutes);
app.use("/api", appConfigRoutes);

// Custom Pose routes ekle
app.use("/api/customPose", customPoseRoutes);

// Custom Hair Style routes ekle
app.use("/api/customHairStyle", customHairStyleRoutes);

// Pose Favorites routes ekle
app.use("/api/pose-favorites", poseFavoritesRoutes);

// Hair Style Favorites routes ekle
app.use("/api/hair-style-favorites", hairStyleFavoritesRoutes);

// Last Selected Pose routes ekle
const lastSelectedPoseRoutes = require("./routes/lastSelectedPoseRoutes");
app.use("/api/last-selected-pose", lastSelectedPoseRoutes);

// Create Location routes ekle
app.use("/api/location", createLocationRoutes);
app.use("/api/location/v2", createLocationRoutesV2);
app.use("/api/location/v3", createLocationRoutesV3);
// Search Location routes ekle
app.use("/api/location/v2", searchLocationRoutes);

// Location Suggestion routes ekle
app.use("/api/location-suggestions", locationSuggestionRoutes);

// Create Model routes ekle
app.use("/api/model", createModelRoutes);

// Hair Styles routes ekle
app.use("/api/hair-styles", hairStylesRoutes);

// Favorites routes ekle
app.use("/api/favorites", favoritesRoutes);

// Video routes ekle
app.use("/api", videoRoutes);

// User Visibility routes ekle
app.use("/api", userVisibilityRoutes);

// Icon Generator routes ekle
app.use("/api/icon-generator", iconGeneratorRoutes);

// App Links routes ekle
app.use("/api/app-links", appLinksRoutes);
app.use("/api/auth", authRoutes);
const webAuthRoutes = require("./routes/webAuthRoutes");
app.use("/api/web/auth", webAuthRoutes);

// Modal Contents routes ekle
app.use(modalContentsRoutes);

// Model Poses routes ekle (artık /api/posesNew altında olacak)
app.use("/api", modelPosesRoutes); // Yeni eklenen route'u /api/posesNew olarak ayarla

// Generate Product Kit routes
app.use("/api", generateProductKitRoutes);

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
  console.log("🔄 Server reloaded with Refiner Download routes!");
  console.log(`Server is accessible at http://localhost:${PORT}`);
  console.log(
    `For mobile devices use your machine's IP address: http://192.168.1.100:${PORT}`
  );
});
