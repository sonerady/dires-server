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

const upload = multer();
const router = express.Router();

// Replicate API client
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const predictions = replicate.predictions;

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

router.post("/generateTrain", upload.array("files", 20), async (req, res) => {
  const files = req.files;
  const { user_id, request_id, image_url } = req.body; // Accept image_url

  // İstek gelir gelmez hemen front-end'e yanıt dönüyoruz.
  console.log(
    `Yeni istek alındı: request_id=${request_id}, user_id=${user_id}`
  );
  res.status(200).json({ message: "İşlem başlatıldı, lütfen bekleyin..." });

  (async () => {
    let creditsDeducted = false; // Flag to track if credits were deducted

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
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("credit_balance")
        .eq("id", user_id)
        .single();

      if (userError) throw userError;

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
      creditsDeducted = true;

      const signedUrls = [];

      console.log("Resimler işleniyor ve yükleniyor...");
      for (const file of files) {
        const rotatedBuffer = await sharp(file.buffer).rotate().toBuffer();
        const metadata = await sharp(rotatedBuffer).metadata();
        const halfWidth = Math.round(metadata.width / 2);
        const halfHeight = Math.round(metadata.height / 2);

        const resizedBuffer = await sharp(rotatedBuffer)
          .resize(halfWidth, halfHeight)
          .toBuffer();

        const fileName = `${Date.now()}_${file.originalname}`;
        const { data, error } = await supabase.storage
          .from("images")
          .upload(fileName, resizedBuffer, {
            contentType: file.mimetype,
          });

        if (error) throw error;

        const { data: publicUrlData, error: publicUrlError } =
          await supabase.storage.from("images").getPublicUrl(fileName);

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
            120000, // Timeout'ı 2 dakikaya çıkar
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
      const processedImageUrls = [];
      const zipFileName = `images_${Date.now()}.zip`;
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

            const fileName = `${uuidv4()}.png`;

            const { error: uploadError } = await supabase.storage
              .from("images")
              .upload(fileName, processedBuffer, {
                contentType: "image/png",
              });

            if (uploadError) {
              console.error("Resim upload hatası:", uploadError);
              // Bu noktada hata olsa bile zip finalize edilmeli
            } else {
              const { data: publicUrlData, error: publicUrlError } =
                await supabase.storage.from("images").getPublicUrl(fileName);

              if (!publicUrlError) {
                processedImageUrls.push(publicUrlData.publicUrl);
              }
            }

            archive.append(processedBuffer, { name: fileName });
          } catch (err) {
            console.error("Resim işleme hatası:", err);
          }
        } else {
          console.error("Geçersiz resim verisi:", imageUrl);
        }
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

          console.log("Model oluşturuluyor...");
          const repoName = uuidv4()
            .toLowerCase()
            .replace(/\s+/g, "-")
            .replace(/[^a-z0-9-_.]/g, "")
            .replace(/^-+|-+$/g, "");

          const model = await replicate.models.create("appdiress", repoName, {
            visibility: "private",
            hardware: "gpu-a100-large",
          });

          console.log("Model eğitimi başlatılıyor...");
          const training = await replicate.trainings.create(
            "ostris",
            "flux-dev-lora-trainer",
            "e440909d3512c31646ee2e0c7d6f6f4923224863a6a10c494606e79fb5844497",
            {
              destination: `appdiress/${repoName}`,
              input: {
                steps: 1000,
                lora_rank: 20,
                optimizer: "adamw8bit",
                batch_size: 1,
                resolution: "512,768,1024",
                autocaption: true,
                input_images: zipUrlData.publicUrl,
                trigger_word: "TOK",
                learning_rate: 0.0004,
                autocaption_prefix: "a photo of TOK",
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
              image_urls: JSON.stringify(processedImageUrls.slice(0, 3)),
              cover_images: JSON.stringify([image_url]),
              isPaid: true,
              request_id: request_id,
            });
          if (insertError) throw insertError;

          console.log("generate_requests durumu succeeded yapılıyor...");
          const { error: statusUpdateError } = await supabase
            .from("generate_requests")
            .update({ status: "succeeded" })
            .eq("uuid", request_id);

          if (statusUpdateError) throw statusUpdateError;

          console.log("İşlem başarıyla tamamlandı.");
        } catch (error) {
          console.error("Zip sonrası işlemlerde hata:", error);

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

      // Hata durumunda failed yap
      await supabase
        .from("generate_requests")
        .update({ status: "failed" })
        .eq("uuid", request_id);

      // Krediyi iade et
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
    }
  })();
});

module.exports = router;
