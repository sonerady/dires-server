// app.js
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
const notificationRoutes = require("./routes/notificationRoutes");
const addProductRouter = require("./routes/addProduct");
const getUserProductRouter = require("./routes/getUserProduct");
const removeBgRouter = require("./routes/removeBg");
const uploadImageRouter = require("./routes/uploadImage");
const generateTrain = require("./routes/generateTrain");
const checkStatusRouter = require("./routes/checkStatus");
const getTrainRequestRouter = require("./routes/getTrainRequest");
const getRequests = require("./routes/getRequests");
const getBalance = require("./routes/getBalance");
const generatePredictionsRouter = require("./routes/generatePredictions");
const generateImgToVidRouter = require("./routes/generateImgToVid");
const getPredictionsRouter = require("./routes/getPredictions");
const registerAnonymousUserRouter = require("./routes/registerAnonymousUser");
const posesRouter = require("./routes/posesRoutes");
const generateImagesJsonRouter = require("./routes/generateImagesJson");
const locationRoutes = require("./routes/locationRoutes");
const imageEnhancementRouter = require("./routes/imageEnhancement");
const faceSwapRouter = require("./routes/faceSwap");
const geminiImageProcessRouter = require("./routes/geminiImageProcess");
const imageClarityProcessRouter = require("./routes/imageClarityProcess");

// RevenueCat webhook route import
const revenuecatWebhookRouter = require("./routes/revenuecatWebhook");

const app = express();

// CORS ayarlarını daha esnek hale getir
app.use(
  cors({
    origin: "*", // Tüm originlere izin ver
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

// Results klasörüne statik dosya erişimi sağla
app.use("/results", express.static(path.join(__dirname, "../results")));

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
app.use("/api", notificationRoutes);
app.use("/api", uploadImageRouter);
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
app.use("/api", registerAnonymousUserRouter);
app.use("/api", generateImgToVidRouter);
app.use("/api", posesRouter);
app.use("/api", generateImagesJsonRouter);
app.use("/api", locationRoutes);
app.use("/api", geminiImageProcessRouter);
app.use("/api", imageClarityProcessRouter);

// RevenueCat webhook route ekle
app.use("/revenuecat", revenuecatWebhookRouter);

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Server is accessible at http://localhost:${PORT}`);
  console.log(
    `For mobile devices use your machine's IP address: http://192.168.1.100:${PORT}`
  );
});
