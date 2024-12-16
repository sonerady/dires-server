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

router.post("/generateTrain", upload.array("files", 20), async (req, res) => {
  const files = req.files;
  const { user_id, request_id, image_url } = req.body; // Accept image_url

  // Front-end'e hemen yanıt dön
  res.status(200).json({ message: "İşlem başlatıldı, lütfen bekleyin..." });

  (async () => {
    let creditsDeducted = false; // Flag to track if credits were deducted
    let zipFileName = null;
    let processedImageUrls = [];
    let replicateId = null;
    let userData = null; // Kullanıcı verisini globalde tut
    let intervalId = null; // Polling interval'ı globalde tut

    try {
      if (!request_id) {
        console.error("Request ID eksik.");
        return;
      }

      if (!files || files.length === 0) {
        // Dosya yoksa failed
        await supabase
          .from("generate_requests")
          .update({ status: "failed" })
          .eq("uuid", request_id);
        return;
      }

      // generate_requests kaydını oluştur veya güncelle
      const { data: existingRequest, error: requestError } = await supabase
        .from("generate_requests")
        .select("*")
        .eq("uuid", request_id)
        .single();

      if (requestError && requestError.code !== "PGRST116") {
        throw requestError;
      }

      if (!existingRequest) {
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
        const { error: updateError } = await supabase
          .from("generate_requests")
          .update({ status: "pending", image_url: image_url })
          .eq("uuid", request_id);

        if (updateError) throw updateError;
      }

      // Kullanıcının kredi bakiyesi
      const { data: uData, error: userError } = await supabase
        .from("users")
        .select("credit_balance")
        .eq("id", user_id)
        .single();

      if (userError) throw userError;

      userData = uData;

      if (userData.credit_balance < 100) {
        // Kredi yetersiz
        await supabase
          .from("generate_requests")
          .update({ status: "failed" })
          .eq("uuid", request_id);

        return;
      }

      // 100 kredi düş
      const newCreditBalance = userData.credit_balance - 100;
      const { error: updateCreditError } = await supabase
        .from("users")
        .update({ credit_balance: newCreditBalance })
        .eq("id", user_id);

      if (updateCreditError) throw updateCreditError;
      creditsDeducted = true;

      const signedUrls = [];
      const removeBgResults = [];

      // Resimleri yarıya düşür, döndür ve yükle
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

      // Arka plan kaldırma
      let processingFailed = false;
      for (const url of signedUrls) {
        try {
          const output = await replicate.run(
            "smoretalk/rembg-enhance:4067ee2a58f6c161d434a9c077cfa012820b8e076efa2772aa171e26557da919",
            { input: { image: url } }
          );

          if (Array.isArray(output) && output.length > 0) {
            removeBgResults.push(output[0]);
          } else {
            removeBgResults.push(output);
          }
        } catch (error) {
          console.error("Arka plan kaldırma hatası:", error);
          removeBgResults.push({ error: error.message || "Unknown error" });
          processingFailed = true;
        }
      }

      if (processingFailed) {
        await supabase
          .from("generate_requests")
          .update({ status: "failed" })
          .eq("uuid", request_id);

        // Krediyi iade et
        if (creditsDeducted) {
          await supabase
            .from("users")
            .update({ credit_balance: userData.credit_balance })
            .eq("id", user_id);
        }

        return;
      }

      // Zip dosyası oluştur
      zipFileName = `images_${Date.now()}.zip`;
      const zipFilePath = `${os.tmpdir()}/${zipFileName}`;
      const outputStream = fs.createWriteStream(zipFilePath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      outputStream.on("close", async () => {
        try {
          console.log(`${archive.pointer()} byte'lık zip dosyası oluşturuldu.`);

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

          const repoName = uuidv4()
            .toLowerCase()
            .replace(/\s+/g, "-")
            .replace(/[^a-z0-9-_.]/g, "")
            .replace(/^-+|-+$/g, "");

          // Model oluştur
          const model = await replicate.models.create("appdiress", repoName, {
            visibility: "private",
            hardware: "gpu-a100-large",
          });

          // Eğitim başlat
          const training = await replicate.trainings.create(
            "ostris",
            "flux-dev-lora-trainer",
            "e440909d3512c31646ee2e0c7d6f6f4923224863a6a10c494606e79fb5844497",
            {
              destination: `appdiress/${repoName}`,
              input: {
                steps: 1000,
                lora_rank: 16,
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

          replicateId = training.id;

          // Eğitim durumu polling fonksiyonu
          const checkTrainingStatus = async () => {
            try {
              const statusResponse = await replicate.trainings.get(
                "ostris",
                "flux-dev-lora-trainer",
                replicateId
              );
              const status = statusResponse.status;

              console.log(`Eğitim durumu: ${status}`);

              if (status === "succeeded" || status === "failed") {
                // Zip'i sil
                const { error: removeZipError } = await supabase.storage
                  .from("zips")
                  .remove([zipFileName]);
                if (removeZipError) {
                  console.error(
                    "Zip dosyası bucket'tan silinemedi:",
                    removeZipError
                  );
                } else {
                  console.log(
                    "Zip dosyası eğitim tamamlandıktan sonra başarıyla silindi."
                  );
                }

                if (status === "succeeded") {
                  // Eğitim başarılı: userproduct kaydı ekle
                  const { error: insertError } = await supabase
                    .from("userproduct")
                    .insert({
                      user_id,
                      product_id: replicateId,
                      status: "pending",
                      image_urls: JSON.stringify(
                        processedImageUrls.slice(0, 3)
                      ),
                      cover_images: JSON.stringify([image_url]),
                      isPaid: true,
                      request_id: request_id,
                    });
                  if (insertError) throw insertError;

                  // generate_requests tablosunu güncelle
                  const { error: statusUpdateError } = await supabase
                    .from("generate_requests")
                    .update({ status: "succeeded" })
                    .eq("uuid", request_id);

                  if (statusUpdateError) throw statusUpdateError;
                } else {
                  // Eğitim başarısız: krediyi iade et
                  if (creditsDeducted) {
                    const { error: refundError } = await supabase
                      .from("users")
                      .update({ credit_balance: userData.credit_balance })
                      .eq("id", user_id);

                    if (refundError) {
                      console.error("Credits refund failed:", refundError);
                    }
                  }

                  // generate_requests tablosunu güncelle
                  const { error: statusUpdateError } = await supabase
                    .from("generate_requests")
                    .update({ status: "failed" })
                    .eq("uuid", request_id);

                  if (statusUpdateError) throw statusUpdateError;
                }

                // Polling'i durdur
                clearInterval(intervalId);
              }
            } catch (err) {
              console.error("Eğitim durumunu sorgularken hata oluştu:", err);
              // Hata durumunda tekrar deneyebiliriz, polling devam edecek.
            }
          };

          // Her 30 saniyede bir durum kontrolü
          intervalId = setInterval(checkTrainingStatus, 30000);
        } catch (error) {
          console.error("Zip işlemleri sırasında hata:", error);

          await supabase
            .from("generate_requests")
            .update({ status: "failed" })
            .eq("uuid", request_id);

          // Krediyi iade et
          if (creditsDeducted) {
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

      archive.on("error", async (err) => {
        console.error("Zip oluşturma hatası:", err);

        await supabase
          .from("generate_requests")
          .update({ status: "failed" })
          .eq("uuid", request_id);

        // Krediyi iade et
        if (creditsDeducted) {
          const { error: refundError } = await supabase
            .from("users")
            .update({ credit_balance: userData.credit_balance })
            .eq("id", user_id);

          if (refundError) {
            console.error("Credits refund failed:", refundError);
          }
        }
      });

      archive.pipe(outputStream);

      // İşlenmiş görselleri zip'e ekle
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

            if (uploadError) throw uploadError;

            const { data: publicUrlData, error: publicUrlError } =
              await supabase.storage.from("images").getPublicUrl(fileName);

            if (publicUrlError) throw publicUrlError;

            processedImageUrls.push(publicUrlData.publicUrl);

            archive.append(processedBuffer, { name: fileName });
          } catch (err) {
            console.error("Resim işleme hatası:", err);
          }
        } else {
          console.error("Geçersiz resim verisi:", imageUrl);
        }
      }

      archive.finalize();
    } catch (error) {
      console.error("İşlem başarısız:", error);

      // Hata durumunda failed yap
      await supabase
        .from("generate_requests")
        .update({ status: "failed" })
        .eq("uuid", request_id);

      // Krediyi iade et
      if (creditsDeducted) {
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
