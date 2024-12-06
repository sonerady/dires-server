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

  console.log("image_url", image_url);

  if (!files || files.length === 0) {
    return res.status(400).json({ message: "Dosya gerekli." });
  }

  let creditsDeducted = false; // Flag to track if credits were deducted

  try {
    // Check if request_id is provided
    if (!request_id) {
      return res.status(400).json({ message: "Request ID gerekli." });
    }

    // Insert or update the generate_requests record with status 'processing' and image_url
    const { data: existingRequest, error: requestError } = await supabase
      .from("generate_requests")
      .select("*")
      .eq("uuid", request_id)
      .single();

    if (requestError && requestError.code !== "PGRST116") {
      // PGRST116 means no rows returned; proceed to insert
      throw requestError;
    }

    if (!existingRequest) {
      // If the record doesn't exist, insert it
      const { data: insertData, error: insertError } = await supabase
        .from("generate_requests")
        .insert([
          {
            uuid: request_id,
            request_id: request_id,
            user_id: user_id,
            status: "processing",
            image_url: image_url, // Include image_url
          },
        ]);

      if (insertError) throw insertError;
    } else {
      // If the record exists, update the status to 'processing' and image_url
      const { error: updateError } = await supabase
        .from("generate_requests")
        .update({ status: "processing", image_url: image_url }) // Include image_url
        .eq("uuid", request_id);

      if (updateError) throw updateError;
    }

    // 1. Check user's credit balance
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("credit_balance")
      .eq("id", user_id)
      .single();

    if (userError) throw userError;

    if (userData.credit_balance < 100) {
      // Update the status to 'failed' due to insufficient credits
      await supabase
        .from("generate_requests")
        .update({ status: "failed" })
        .eq("uuid", request_id);

      return res.status(400).json({ message: "Yetersiz kredi." });
    }

    // Deduct 100 credits immediately
    const newCreditBalance = userData.credit_balance - 100;
    const { error: updateError } = await supabase
      .from("users")
      .update({ credit_balance: newCreditBalance })
      .eq("id", user_id);

    if (updateError) throw updateError;
    creditsDeducted = true; // Set the flag to true

    const signedUrls = [];
    const removeBgResults = [];

    // 2. Upload files to Supabase storage
    for (const file of files) {
      const fileName = `${Date.now()}_${file.originalname}`;
      const { data, error } = await supabase.storage
        .from("images")
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
        });

      if (error) throw error;

      const { data: publicUrlData, error: publicUrlError } =
        await supabase.storage.from("images").getPublicUrl(fileName);

      if (publicUrlError) throw publicUrlError;

      signedUrls.push(publicUrlData.publicUrl);
    }

    // 3. Background removal process
    let processingFailed = false; // Flag to track if any processing fails

    for (const url of signedUrls) {
      try {
        const output = await replicate.run(
          "smoretalk/rembg-enhance:4067ee2a58f6c161d434a9c077cfa012820b8e076efa2772aa171e26557da919",
          { input: { image: url } }
        );

        // Get the first item of the output
        if (Array.isArray(output) && output.length > 0) {
          removeBgResults.push(output[0]);
        } else {
          removeBgResults.push(output);
        }

        console.log("Arka plan kaldırma başarılı:", output);
      } catch (error) {
        console.error("Arka plan kaldırma hatası:", error);
        removeBgResults.push({ error: error.message || "Unknown error" });
        processingFailed = true; // Set flag if any processing fails
      }
    }

    // After processing all images, check if any failed
    if (processingFailed) {
      // Update the status to 'failed' in generate_requests table
      await supabase
        .from("generate_requests")
        .update({ status: "failed" })
        .eq("uuid", request_id);

      // Re-add 100 credits if deducted
      if (creditsDeducted) {
        const { error: refundError } = await supabase
          .from("users")
          .update({ credit_balance: userData.credit_balance })
          .eq("id", user_id);

        if (refundError) {
          console.error("Credits refund failed:", refundError);
        }
      }

      return res.status(500).json({
        message: "Arka plan kaldırma işlemi sırasında bir hata oluştu.",
        removeBgResults,
      });
    }

    // Array to store processed image URLs
    const processedImageUrls = [];

    // 4. Create a zip file and upload to Supabase storage
    const zipFileName = `images_${Date.now()}.zip`;
    const zipFilePath = `${os.tmpdir()}/${zipFileName}`;
    const outputStream = fs.createWriteStream(zipFilePath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    // Handle 'close' event with try/catch
    outputStream.on("close", async () => {
      try {
        console.log(`${archive.pointer()} byte'lık zip dosyası oluşturuldu.`);

        const zipBuffer = fs.readFileSync(zipFilePath);

        const { data: zipData, error: zipError } = await supabase.storage
          .from("zips")
          .upload(zipFileName, zipBuffer, {
            contentType: "application/zip",
          });

        if (zipError) throw zipError;

        const { data: zipUrlData, error: zipUrlError } = await supabase.storage
          .from("zips")
          .getPublicUrl(zipFileName);

        if (zipUrlError) throw zipUrlError;

        // Start the training process (Replicate)
        const repoName = uuidv4()
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-_.]/g, "")
          .replace(/^-+|-+$/g, "");

        const model = await replicate.models.create("appdiress", repoName, {
          visibility: "private",
          hardware: "gpu-a100-large",
        });

        const training = await replicate.trainings.create(
          "ostris",
          "flux-dev-lora-trainer",
          "e440909d3512c31646ee2e0c7d6f6f4923224863a6a10c494606e79fb5844497",
          {
            destination: `appdiress/${repoName}`,
            input: {
              steps: 2000,
              lora_rank: 16,
              optimizer: "adamw8bit",
              batch_size: 1,
              resolution: "512,768,1024",
              autocaption: true,
              input_images: zipUrlData.publicUrl, // URL of the zip file
              trigger_word: "TOK",
              learning_rate: 0.0004,
              autocaption_prefix: "a photo of TOK",
            },
          }
        );

        const replicateId = training.id;

        // Save to database with cover_images and request_id
        const { data: insertData, error: insertError } = await supabase
          .from("userproduct")
          .insert({
            user_id,
            product_id: replicateId,
            status: "pending",
            image_urls: JSON.stringify(processedImageUrls.slice(0, 3)), // First 3 processed image URLs
            cover_images: JSON.stringify([image_url]), // Store as a JSON array
            isPaid: true,
            request_id: request_id, // **Add request_id here**
          });

        if (insertError) throw insertError;

        // Update the status to 'succeeded' in generate_requests table
        const { error: statusUpdateError } = await supabase
          .from("generate_requests")
          .update({ status: "succeeded" })
          .eq("uuid", request_id);

        if (statusUpdateError) throw statusUpdateError;

        res.status(200).json({
          message: "Eğitim başlatıldı",
          training,
          signedUrls,
          removeBgResults,
          zipUrl: zipUrlData.publicUrl,
        });
      } catch (error) {
        console.error("Zip işlemleri sırasında hata:", error);

        // Update the status to 'failed' in generate_requests table
        await supabase
          .from("generate_requests")
          .update({ status: "failed" })
          .eq("uuid", request_id);

        // Re-add 100 credits if deducted
        if (creditsDeducted) {
          const { error: refundError } = await supabase
            .from("users")
            .update({ credit_balance: userData.credit_balance })
            .eq("id", user_id);

          if (refundError) {
            console.error("Credits refund failed:", refundError);
          }
        }

        res.status(500).json({
          message: "Zip işlemleri sırasında hata oluştu.",
          error: error.message || "Unknown error",
        });
      } finally {
        // Clean up the temporary zip file
        fs.unlink(zipFilePath, (err) => {
          if (err) {
            console.error("Geçici zip dosyası silinemedi:", err);
          }
        });
      }
    });

    // Handle 'error' event with try/catch
    archive.on("error", async (err) => {
      try {
        console.error("Zip oluşturma hatası:", err);

        // Update the status to 'failed' in generate_requests table
        await supabase
          .from("generate_requests")
          .update({ status: "failed" })
          .eq("uuid", request_id);

        // Re-add 100 credits if deducted
        if (creditsDeducted) {
          const { error: refundError } = await supabase
            .from("users")
            .update({ credit_balance: userData.credit_balance })
            .eq("id", user_id);

          if (refundError) {
            console.error("Credits refund failed:", refundError);
          }
        }

        res.status(500).json({
          message: "Zip oluşturma başarısız.",
          error: err.message || err,
        });
      } catch (error) {
        console.error("Zip error handler sırasında hata:", error);
        res.status(500).json({
          message: "Zip error handler sırasında hata oluştu.",
          error: error.message || "Unknown error",
        });
      }
    });

    archive.pipe(outputStream);

    // Upload processed images to Supabase and add to zip
    for (const imageUrl of removeBgResults) {
      if (typeof imageUrl === "string") {
        try {
          // Download the image
          const response = await axios({
            method: "get",
            url: imageUrl,
            responseType: "arraybuffer",
          });

          const buffer = Buffer.from(response.data, "binary");

          // Use Sharp to composite the image over a white background
          const processedBuffer = await sharp(buffer)
            .flatten({ background: { r: 255, g: 255, b: 255 } }) // Set background to white
            .png() // Ensure the output is in PNG format
            .toBuffer();

          const fileName = `${uuidv4()}.png`;

          // Upload to Supabase
          const { data: uploadData, error: uploadError } =
            await supabase.storage
              .from("images") // Use an existing bucket
              .upload(fileName, processedBuffer, {
                contentType: "image/png",
              });

          if (uploadError) throw uploadError;

          // Get public URL
          const { data: publicUrlData, error: publicUrlError } =
            await supabase.storage.from("images").getPublicUrl(fileName);

          if (publicUrlError) throw publicUrlError;

          // Add URL to array
          processedImageUrls.push(publicUrlData.publicUrl);

          // Add to zip archive
          archive.append(processedBuffer, { name: fileName });
        } catch (err) {
          console.error("Resim işleme hatası:", err);
          // Optionally, handle individual image processing errors
          // You might decide to set processingFailed = true; here if critical
        }
      } else {
        console.error("Geçersiz resim verisi:", imageUrl);
      }
    }

    // Finalize the zip archive
    archive.finalize();
  } catch (error) {
    console.error("İşlem başarısız:", error);

    // Update the status to 'failed' in generate_requests table
    await supabase
      .from("generate_requests")
      .update({ status: "failed" })
      .eq("uuid", request_id);

    // Re-add 100 credits if deducted
    if (creditsDeducted) {
      const { error: refundError } = await supabase
        .from("users")
        .update({ credit_balance: userData.credit_balance })
        .eq("id", user_id);

      if (refundError) {
        console.error("Credits refund failed:", refundError);
      }
    }

    res
      .status(500)
      .json({ message: "İşlem başarısız.", error: error.message || error });
  }
});

module.exports = router;
