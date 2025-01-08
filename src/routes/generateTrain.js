// Bu kodda generate_requests tablosunda credits_deducted (boolean) alanının var olduğu varsayılmaktadır.
// Örneğin:
// ALTER TABLE generate_requests ADD COLUMN credits_deducted boolean DEFAULT false;

// Required modules
const express = require("express");
const supabase = require("../supabaseClient");
const Replicate = require("replicate");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const archiver = require("archiver");
const fs = require("fs");
const os = require("os");
const axios = require("axios");
const sharp = require("sharp"); // Import Sharp
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");

const upload = multer();
const router = express.Router();

// Replicate API client
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const predictions = replicate.predictions;

// Gemini ayarları
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const fileManager = new GoogleAIFileManager(apiKey);

// Sunucu başlatıldığında, pending durumundaki tüm kayıtları failed yap ve gerekiyorsa kredi iade et
(async () => {
  try {
    const { data: pendingRequests, error: pendingError } = await supabase
      .from("generate_requests")
      .select("uuid, user_id, credits_deducted")
      .eq("status", "pending");

    if (pendingError) {
      console.error("Pending istekler okunurken hata oluştu:", pendingError);
    } else if (pendingRequests && pendingRequests.length > 0) {
      for (const req of pendingRequests) {
        const { error: failError } = await supabase
          .from("generate_requests")
          .update({ status: "failed" })
          .eq("uuid", req.uuid);

        if (failError) {
          console.error(
            `İstek failed yapılırken hata oluştu (uuid: ${req.uuid}):`,
            failError
          );
        } else {
          console.log(`İstek failed yapıldı (uuid: ${req.uuid})`);

          // Eğer bu istek için kredi düşülmüşse iade et
          if (req.credits_deducted) {
            const { data: userData, error: userError } = await supabase
              .from("users")
              .select("credit_balance")
              .eq("id", req.user_id)
              .single();

            if (userError) {
              console.error("Kullanıcı kredisi okunamadı:", userError);
            } else {
              const refundedBalance = userData.credit_balance + 100;
              const { error: refundError } = await supabase
                .from("users")
                .update({ credit_balance: refundedBalance })
                .eq("id", req.user_id);
              if (refundError) {
                console.error("Kredi iadesi başarısız:", refundError);
              } else {
                console.log(
                  "Kredi başarıyla iade edildi (pending istek için):",
                  req.user_id
                );
              }
            }
          }
        }
      }
    } else {
      console.log("Pending istek yok. Sunucu temiz başlatıldı.");
    }
  } catch (err) {
    console.error("Sunucu başlatılırken hata:", err);
  }
})();

// Prediction tamamlana kadar bekleme fonksiyonu
async function waitForPredictionToComplete(
  predictionId,
  replicate,
  timeout = 60000,
  interval = 2000
) {
  const startTime = Date.now();
  console.log(`Prediction ${predictionId} bekleniyor...`);
  while (true) {
    const currentPrediction = await replicate.predictions.get(predictionId);
    console.log(
      `Prediction ${predictionId} durumu: ${currentPrediction.status}`
    );
    if (currentPrediction.status === "succeeded") {
      console.log(`Prediction ${predictionId} tamamlandı.`);
      return currentPrediction;
    } else if (
      currentPrediction.status === "failed" ||
      currentPrediction.status === "canceled"
    ) {
      throw new Error(`Prediction ${predictionId} failed or was canceled.`);
    }

    if (Date.now() - startTime > timeout) {
      throw new Error(`Prediction ${predictionId} timed out.`);
    }

    await new Promise((res) => setTimeout(res, interval));
  }
}

// Tek görsel için gemini caption üretme fonksiyonu
async function downloadImage(url, filepath) {
  const writer = fs.createWriteStream(filepath);

  const response = await axios({
    url,
    method: "GET",
    responseType: "stream",
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

async function uploadToGemini(filePath, mimeType) {
  const uploadResult = await fileManager.uploadFile(filePath, {
    mimeType,
    displayName: path.basename(filePath),
  });
  const file = uploadResult.file;
  console.log(`Uploaded file ${file.displayName} as: ${file.name}`);
  return file;
}

async function generateCaptionForSingleImage(imageUrl, productDetails) {
  const MAX_RETRY = 5;
  const tempDir = path.join(__dirname, "temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
  }
  console.log("Product Details:", productDetails);

  const contentMessage = `
  Please look at this single product image and produce an extremely detailed,
  rich, and highly descriptive English caption focusing exclusively on the product's intricate details,
  materials, craftsmanship, colors, textures, subtle features, and overall luxury.
  Do not mention any mannequins, backgrounds, or unrelated elements.

  Product Details:
  ${productDetails || "No additional details provided"}

  The caption must be contained within a single long paragraph that vividly brings only the product to life
  in the reader's mind, specifying **exactly where each detail is located** on the product
  (for example, on the collar, sleeve, chest area, or hem), 
  as it is **extremely important** to identify the precise position of each design element.

  Additionally, please include details about the camera angle and the portion of the product that is visible:
  - If the shot is a full-body view, state that the entire piece from head to toe is captured.
  - If only the upper part of the product is shown, note that it focuses on the bodice/upper section.
  - If it is taken from the side or at an angle, describe how this perspective reveals the silhouette or side details.
  - If the product is facing the camera directly or slightly turned, mention how that view highlights certain design elements.
`;

  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      const userParts = [];
      const tempImagePath = path.join(tempDir, `${uuidv4()}.jpg`);
      await downloadImage(imageUrl, tempImagePath);
      const uploadedFile = await uploadToGemini(tempImagePath, "image/jpeg");
      fs.unlinkSync(tempImagePath);

      userParts.push({
        fileData: {
          mimeType: "image/jpeg",
          fileUri: uploadedFile.uri,
        },
      });
      userParts.push({ text: contentMessage });

      const history = [
        {
          role: "user",
          parts: userParts,
        },
      ];

      const model = genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
      });

      const generationConfig = {
        temperature: 1,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
        responseMimeType: "text/plain",
      };

      const chatSession = model.startChat({
        generationConfig,
        history,
      });

      const result = await chatSession.sendMessage("");
      const generatedCaption = result.response.text().trim();

      console.log(`Generated Caption for single image: ${generatedCaption}`);

      if (
        generatedCaption.toLowerCase().includes("please provide the image") ||
        generatedCaption.toLowerCase().includes("i need to see the product") ||
        generatedCaption.toLowerCase().includes("i'm sorry") ||
        generatedCaption.toLowerCase().includes("i'm sorry") ||
        generatedCaption.split(/\s+/).length < 20
      ) {
        console.log(`Single image caption not valid. Attempt: ${attempt}`);
        if (attempt === MAX_RETRY) {
          throw new Error(
            "Gemini could not generate a valid caption for the image."
          );
        }
        await new Promise((res) => setTimeout(res, 1000));
        continue;
      }

      return generatedCaption;
    } catch (err) {
      console.error("Error generating caption for single image:", err);
      if (attempt === MAX_RETRY) {
        throw err;
      }
      await new Promise((res) => setTimeout(res, 1000));
    }
  }

  throw new Error(
    "Gemini could not generate a valid caption after multiple attempts for single image."
  );
}

router.post("/generateTrain", upload.array("files", 20), async (req, res) => {
  const files = req.files;
  const { user_id, request_id, image_url, product_details } = req.body;

  console.log(
    `Yeni istek alındı: request_id=${request_id}, user_id=${user_id}, product_details=`,
    product_details
  );
  res.status(200).json({ message: "İşlem başlatıldı, lütfen bekleyin..." });

  (async () => {
    let creditsDeducted = false;
    let userData;
    let fallbackAutocaption = false;

    try {
      if (!request_id) {
        console.error("Request ID eksik, işlem sonlandırılıyor...");
        return;
      }

      if (!files || files.length === 0) {
        console.error("Dosya bulunamadı, failed durumuna geçiliyor...");
        await supabase
          .from("generate_requests")
          .update({ status: "failed" })
          .eq("uuid", request_id);
        return;
      }

      console.log("generate_requests kontrol ediliyor...");
      const { data: existingRequest, error: requestError } = await supabase
        .from("generate_requests")
        .select("*")
        .eq("uuid", request_id)
        .single();

      if (requestError && requestError.code !== "PGRST116") {
        console.error("generate_requests sorgusunda hata:", requestError);
        throw requestError;
      }

      if (!existingRequest) {
        console.log("Yeni generate_request kaydı oluşturuluyor...");
        const { error: insertError } = await supabase
          .from("generate_requests")
          .insert([
            {
              uuid: request_id,
              request_id: request_id,
              user_id: user_id,
              status: "pending",
              image_url: image_url,
            },
          ]);
        if (insertError) throw insertError;
      } else {
        console.log("Mevcut generate_request kaydı güncelleniyor...");
        const { error: updateError } = await supabase
          .from("generate_requests")
          .update({ status: "pending", image_url: image_url })
          .eq("uuid", request_id);

        if (updateError) throw updateError;
      }

      console.log("Kullanıcı kredi bakiyesi kontrol ediliyor...");
      const { data: ud, error: userError } = await supabase
        .from("users")
        .select("credit_balance")
        .eq("id", user_id)
        .single();

      if (userError) throw userError;
      userData = ud;

      if (userData.credit_balance < 100) {
        console.error("Kredi yetersiz. failed durumuna geçiliyor...");
        await supabase
          .from("generate_requests")
          .update({ status: "failed" })
          .eq("uuid", request_id);
        return;
      }

      console.log("100 kredi düşülüyor...");
      const newCreditBalance = userData.credit_balance - 100;
      const { error: updateCreditError } = await supabase
        .from("users")
        .update({ credit_balance: newCreditBalance })
        .eq("id", user_id);
      if (updateCreditError) throw updateCreditError;

      // Kredi düşüldüğünü generate_requests tablosuna yansıtıyoruz
      const { error: creditsDeductedError } = await supabase
        .from("generate_requests")
        .update({ credits_deducted: true })
        .eq("uuid", request_id);
      if (creditsDeductedError) throw creditsDeductedError;

      creditsDeducted = true;

      const signedUrls = [];

      console.log("Resimler işleniyor ve yükleniyor...");
      for (const file of files) {
        // Görüntüyü döndür (exif rotasyonunu düzeltmek için)
        const rotatedBuffer = await sharp(file.buffer).rotate().toBuffer();
        const metadata = await sharp(rotatedBuffer).metadata();

        let finalBuffer = rotatedBuffer; // Varsayılan olarak yeniden boyutlandırma yapma

        // Eğer genişlik 1024 pikselden büyükse yeniden boyutlandır
        if (metadata.width > 2048) {
          const halfWidth = Math.round(metadata.width / 2);
          const halfHeight = Math.round(metadata.height / 2);
          finalBuffer = await sharp(rotatedBuffer)
            .resize(halfWidth, halfHeight)
            .toBuffer();
        }

        const uniqueName = `${Date.now()}_${uuidv4()}_${file.originalname}`;
        const { data, error } = await supabase.storage
          .from("images")
          .upload(uniqueName, finalBuffer, {
            contentType: file.mimetype,
          });

        if (error) throw error;

        const { data: publicUrlData, error: publicUrlError } =
          await supabase.storage.from("images").getPublicUrl(uniqueName);

        if (publicUrlError) throw publicUrlError;

        signedUrls.push(publicUrlData.publicUrl);
      }

      console.log("Arka plan kaldırma işlemi başlıyor...");
      let processingFailed = false;
      const removeBgResults = [];

      for (const url of signedUrls) {
        try {
          const prediction = await predictions.create({
            version:
              "4067ee2a58f6c161d434a9c077cfa012820b8e076efa2772aa171e26557da919",
            input: { image: url },
          });

          const completedPrediction = await waitForPredictionToComplete(
            prediction.id,
            replicate,
            120000,
            3000
          );

          if (completedPrediction.output) {
            removeBgResults.push(completedPrediction.output);
          } else {
            console.error("Çıktı alınamadı, processingFailed=true");
            removeBgResults.push({ error: "Çıktı alınamadı" });
            processingFailed = true;
          }
        } catch (error) {
          console.error("Arka plan kaldırma hatası:", error);
          removeBgResults.push({ error: error.message || "Unknown error" });
          processingFailed = true;
        }
      }

      if (processingFailed || removeBgResults.length === 0) {
        console.error(
          "İşlem processingFailed=true ya da sonuç boş, failed durumu..."
        );
        await supabase
          .from("generate_requests")
          .update({ status: "failed" })
          .eq("uuid", request_id);

        if (creditsDeducted) {
          console.log("Krediler iade ediliyor...");
          await supabase
            .from("users")
            .update({ credit_balance: userData.credit_balance })
            .eq("id", user_id);
        }

        return;
      }

      console.log("Zip dosyası oluşturuluyor...");
      // processedImages hem publicUrl hem de dosya ismini tutacak
      const processedImages = [];
      const zipFileName = `images_${Date.now()}_${uuidv4()}.zip`;
      const zipFilePath = `${os.tmpdir()}/${zipFileName}`;
      const outputStream = fs.createWriteStream(zipFilePath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      const handleZipError = async (err) => {
        console.error("Zip oluşturma hatası:", err);
        await supabase
          .from("generate_requests")
          .update({ status: "failed" })
          .eq("uuid", request_id);

        if (creditsDeducted) {
          console.log("Krediler iade ediliyor...");
          const { error: refundError } = await supabase
            .from("users")
            .update({ credit_balance: userData.credit_balance })
            .eq("id", user_id);

          if (refundError) {
            console.error("Credits refund failed:", refundError);
          }
        }
      };

      archive.on("error", handleZipError);
      archive.pipe(outputStream);

      console.log("RemoveBg sonuçları işlenip zip'e ekleniyor...");
      let imageIndex = 0;

      for (const imageUrl of removeBgResults) {
        if (typeof imageUrl === "string") {
          try {
            const response = await axios({
              method: "get",
              url: imageUrl,
              responseType: "arraybuffer",
            });

            const buffer = Buffer.from(response.data, "binary");
            const processedBuffer = await sharp(buffer)
              .flatten({ background: { r: 255, g: 255, b: 255 } })
              .png()
              .toBuffer();

            const imgFileName = `product_${imageIndex}_${uuidv4()}.png`;

            const { error: uploadError } = await supabase.storage
              .from("images")
              .upload(imgFileName, processedBuffer, {
                contentType: "image/png",
              });

            if (uploadError) {
              console.error("Resim upload hatası:", uploadError);
            } else {
              const { data: publicUrlData, error: publicUrlError } =
                await supabase.storage.from("images").getPublicUrl(imgFileName);

              if (!publicUrlError) {
                processedImages.push({
                  url: publicUrlData.publicUrl,
                  fileName: imgFileName,
                });
              }
            }

            archive.append(processedBuffer, { name: imgFileName });
            imageIndex++;
          } catch (err) {
            console.error("Resim işleme hatası:", err);
          }
        } else {
          console.error("Geçersiz resim verisi:", imageUrl);
        }
      }

      // Her görsel için ayrı caption, aynı isimde .txt
      try {
        for (const imageObj of processedImages) {
          const caption = await generateCaptionForSingleImage(
            imageObj.url,
            product_details
          );
          const txtFileName = imageObj.fileName.replace(".png", ".txt");
          archive.append(caption, { name: txtFileName });
        }
      } catch (captionErr) {
        console.error(
          "En az bir görsel için caption oluşturulamadı, fallbackAutocaption=true",
          captionErr
        );
        fallbackAutocaption = true;
      }

      console.log("Zip finalize ediliyor...");
      archive.finalize();

      outputStream.on("close", async () => {
        console.log(`${archive.pointer()} byte'lık zip dosyası oluşturuldu.`);

        try {
          const zipBuffer = fs.readFileSync(zipFilePath);

          const { error: zipError } = await supabase.storage
            .from("zips")
            .upload(zipFileName, zipBuffer, {
              contentType: "application/zip",
            });

          if (zipError) throw zipError;

          const { data: zipUrlData, error: zipUrlError } =
            await supabase.storage.from("zips").getPublicUrl(zipFileName);

          if (zipUrlError) throw zipUrlError;

          // generate_requests succeeded yap
          console.log("generate_requests durumu succeeded yapılıyor...");
          const { error: statusUpdateError } = await supabase
            .from("generate_requests")
            .update({ status: "succeeded" })
            .eq("uuid", request_id);

          if (statusUpdateError) throw statusUpdateError;
          console.log("generate_requests succeeded durumunda.");

          console.log(
            "Şimdi replicate API'ye model oluşturma isteği gönderiliyor..."
          );
          try {
            const repoName = uuidv4()
              .toLowerCase()
              .replace(/\s+/g, "-")
              .replace(/[^a-z0-9-_.]/g, "")
              .replace(/^-+|-+$/g, "");

            const model = await replicate.models.create(
              "nodselemen",
              repoName,
              {
                visibility: "private",
                hardware: "gpu-a100-large",
              }
            );

            console.log("Model eğitimi başlatılıyor...");
            const training = await replicate.trainings.create(
              "ostris",
              "flux-dev-lora-trainer",
              "e440909d3512c31646ee2e0c7d6f6f4923224863a6a10c494606e79fb5844497",
              {
                destination: `nodselemen/${repoName}`,
                input: {
                  steps: 1000,
                  lora_rank: 20,
                  optimizer: "adamw8bit",
                  batch_size: 1,
                  resolution: "512,768,1024",
                  autocaption: fallbackAutocaption ? true : false,
                  input_images: zipUrlData.publicUrl,
                  trigger_word: "TOK",
                  learning_rate: 0.0004,
                },
              }
            );

            const replicateId = training.id;

            console.log("userproduct kaydı yapılıyor...");
            const { error: insertError } = await supabase
              .from("userproduct")
              .insert({
                user_id,
                product_id: replicateId,
                status: "pending",
                image_urls: JSON.stringify(
                  processedImages.map((img) => img.url).slice(0, 3)
                ),
                cover_images: JSON.stringify([image_url]),
                isPaid: true,
                request_id: request_id,
              });
            if (insertError)
              console.error("userproduct insert hatası:", insertError);
            else console.log("userproduct kaydı yapıldı.");

            console.log("İşlem başarıyla tamamlandı (Replicate aşaması).");
          } catch (repErr) {
            console.error("Replicate API çağrısında hata oluştu:", repErr);
            // Bu noktada generate_requests'i failed yapmıyoruz, succeeded kalacak.
          }
        } catch (error) {
          console.error("Zip sonrası işlemlerde hata:", error);
          // Bu aşamada hata olsa bile generate_requests succeeded durumunda bırakıyoruz.
        } finally {
          fs.unlink(zipFilePath, (err) => {
            if (err) {
              console.error("Geçici zip dosyası silinemedi:", err);
            }
          });
        }
      });
    } catch (error) {
      console.error("İşlem başarısız:", error);

      // Bu noktada zip öncesi hatada failed yap
      await supabase
        .from("generate_requests")
        .update({ status: "failed" })
        .eq("uuid", request_id);

      // Krediyi iade et
      if (creditsDeducted && userData) {
        console.log("Krediler iade ediliyor...");
        const { error: refundError } = await supabase
          .from("users")
          .update({ credit_balance: userData.credit_balance })
          .eq("id", user_id);

        if (refundError) {
          console.error("Credits refund failed:", refundError);
        }
      }
    }
  })();
});

module.exports = router;
