const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const writeFileAsync = promisify(fs.writeFile);
const unlinkAsync = promisify(fs.unlink);
const mkdirAsync = promisify(fs.mkdir);
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

// Supabase client setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");

// Configure multer storage for temporary file storage
const storage = multer.diskStorage({
  destination: async function (req, file, cb) {
    const tempDir = path.join(__dirname, "../../temp/uploads");

    // Create directory if it doesn't exist
    try {
      await mkdirAsync(tempDir, { recursive: true });
    } catch (err) {
      if (err.code !== "EEXIST") {
        console.error("Error creating temp directory:", err);
      }
    }

    cb(null, tempDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });

// Create results directory for saving processed images
const resultsDir = path.join(__dirname, "../../results");
// Ensure the results directory exists
(async () => {
  try {
    await mkdirAsync(resultsDir, { recursive: true });
    console.log("Results directory ready:", resultsDir);
  } catch (err) {
    if (err.code !== "EEXIST") {
      console.error("Error creating results directory:", err);
    }
  }
})();

// Gemini API setup
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const fileManager = new GoogleAIFileManager(apiKey);

// Replicate API üzerinden Gemini 2.5 Flash çağrısı yapan helper fonksiyon
// Hata durumunda 3 kez tekrar dener
async function callReplicateGeminiFlash(prompt, imageUrls = [], maxRetries = 3) {
  const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

  if (!REPLICATE_API_TOKEN) {
    throw new Error("REPLICATE_API_TOKEN environment variable is not set");
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🤖 [REPLICATE-GEMINI] API çağrısı attempt ${attempt}/${maxRetries}`);

      const requestBody = {
        input: {
          top_p: 0.95,
          images: imageUrls,
          prompt: prompt,
          videos: [],
          temperature: 1,
          dynamic_thinking: false,
          max_output_tokens: 65535
        }
      };

      const response = await axios.post(
        "https://api.replicate.com/v1/models/google/gemini-2.5-flash/predictions",
        requestBody,
        {
          headers: {
            "Authorization": `Bearer ${REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
            "Prefer": "wait"
          },
          timeout: 120000
        }
      );

      const data = response.data;

      if (data.error) {
        throw new Error(data.error);
      }

      if (data.status !== "succeeded") {
        throw new Error(`Prediction failed with status: ${data.status}`);
      }

      let outputText = "";
      if (Array.isArray(data.output)) {
        outputText = data.output.join("");
      } else if (typeof data.output === "string") {
        outputText = data.output;
      }

      if (!outputText || outputText.trim() === "") {
        throw new Error("Replicate Gemini response is empty");
      }

      console.log(`✅ [REPLICATE-GEMINI] Başarılı response alındı (attempt ${attempt})`);
      return outputText.trim();

    } catch (error) {
      console.error(`❌ [REPLICATE-GEMINI] Attempt ${attempt} failed:`, error.message);

      if (attempt === maxRetries) {
        throw error;
      }

      const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      console.log(`⏳ [REPLICATE-GEMINI] ${waitTime}ms bekleniyor...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

/**
 * Generate an enhanced product photo prompt using Gemini 1.5 Flash
 * @param {string} productDetails - Optional product details to include in the prompt
 * @returns {Promise<string>} Enhanced prompt for product image retouching
 */
async function generateEnhancedPrompt(
  productDetails = "",
  generationConfig = {}
) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

    // Create the prompt request to generate an instruction prompt based on user input
    const promptRequest = {
      contents: [
        {
          parts: [
            {
              text: `Create a concise edit prompt for improving a product image.

User instructions: ${productDetails || "No specific instructions provided."}

If the user instructions are not in English, translate them first. Then, write a clear, effective edit prompt that would transform a product image into a professional photo.

Keep it simple, direct, and under 100 words. Provide only the edit instructions without any additional commentary.`,
            },
          ],
        },
      ],
    };

    // Generate the enhanced prompt
    const result = await model.generateContent(promptRequest, generationConfig);
    const enhancedPrompt = result.response.text();

    return enhancedPrompt;
  } catch (error) {
    console.error("Error generating enhanced prompt:", error);
    // Fallback to a default prompt in case of error
    return `Edit this product image to make it look professional with good lighting and clean background.`;
  }
}

/**
 * Uploads the given file to Gemini.
 *
 * See https://ai.google.dev/gemini-api/docs/prompting_with_media
 */
async function uploadToGemini(path, mimeType, displayName = null) {
  console.log(`Uploading file ${path} to Gemini...`);
  const uploadResult = await fileManager.uploadFile(path, {
    mimeType,
    displayName: displayName || path,
  });
  const file = uploadResult.file;
  console.log(`Uploaded file ${file.displayName} as: ${file.name}`);
  return file;
}

/**
 * Uploads an image file to Supabase storage products bucket
 * @param {string} filePath - Path to the image file
 * @param {string} fileName - Name to use for the file in storage
 * @returns {Promise<string>} URL of the uploaded file
 */
async function uploadToSupabase(filePath, fileName) {
  try {
    console.log(
      `Uploading ${filePath} to Supabase products bucket as ${fileName}...`
    );

    // Read the file content
    const fileBuffer = await fs.promises.readFile(filePath);

    // Upload to Supabase
    const { data, error } = await supabase.storage
      .from("products")
      .upload(fileName, fileBuffer, {
        contentType: "image/png", // Adjust based on the actual file type if needed
        upsert: true, // Overwrite if exists
      });

    if (error) {
      console.error("Supabase upload error:", error);

      // Add more detailed error information based on the error type
      if (
        error.message &&
        error.message.includes("row-level security policy")
      ) {
        console.error(
          "Bu hata, Supabase'de 'products' bucket için Row Level Security (RLS) politikası kısıtlamasından kaynaklanıyor."
        );
        console.error(
          "Lütfen Supabase yönetici paneline giderek Storage -> products bucket -> Policies sekmesine gidin"
        );
        console.error("Ve aşağıdaki gibi bir INSERT politikası ekleyin:");
        console.error(`
        ---------- Policy Example -----------
        Name: Allow file uploads
        Definition: true 
        -------------------------------------
        `);
      }

      throw error;
    }

    // Get the public URL
    const { data: urlData } = supabase.storage
      .from("products")
      .getPublicUrl(fileName);

    console.log(`Successfully uploaded to Supabase: ${urlData.publicUrl}`);
    return urlData.publicUrl;
  } catch (err) {
    console.error("Failed to upload to Supabase:", err);
    throw err;
  }
}

// Route for processing images with Gemini
router.post("/gemini-image-edit", upload.single("image"), async (req, res) => {
  console.log("API endpoint çağrıldı");

  if (!req.file) {
    console.log("Dosya bulunamadı");
    return res.status(400).json({ error: "No image file provided" });
  }

  console.log(
    "Dosya alındı:",
    req.file.originalname,
    req.file.mimetype,
    req.file.size,
    req.body.userDescription,
    "bytes"
  );

  console.log("req.body:", req.body);

  const filePath = req.file.path;
  const mimeType = req.file.mimetype;

  try {
    // Check if API key is available
    if (!apiKey) {
      console.log("API anahtarı bulunamadı");
      throw new Error(
        "GEMINI_API_KEY is not configured in environment variables"
      );
    }

    // Check if Supabase credentials are available
    if (!supabaseUrl || !supabaseKey) {
      console.log("Supabase credentials bulunamadı");
      throw new Error(
        "SUPABASE_URL or SUPABASE_KEY is not configured in environment variables"
      );
    }

    console.log("Gemini ile görüntü işleme başlatılıyor");

    // Process image with Gemini
    async function processImage() {
      try {
        // Upload the input file to Gemini
        const uploadedFile = await uploadToGemini(
          filePath,
          mimeType,
          req.file.originalname
        );
        console.log("Dosya yüklendi:", uploadedFile.name);

        // First, send the image to Gemini 1.5 Flash to generate a prompt
        console.log("Gemini 1.5 Flash ile prompt oluşturuluyor...");
        const promptModel = genAI.getGenerativeModel({
          model: "gemini-flash-latest",
        });

        // Get the user description from request body
        const userDescription = req.body.userDescription || "";
        console.log(
          "Kullanıcı açıklamasıyla birlikte gönderilen prompt:",
          userDescription
        );

        // Create a content request with the uploaded image for prompt generation
        const promptContent = [
          {
            fileData: {
              mimeType: uploadedFile.mimeType,
              fileUri: uploadedFile.uri,
            },
          },
          {
            text: `Look at this product image and create a concise, effective edit prompt based on what you see. 

${userDescription
                ? `The user wants the following: "${userDescription}". The user prompt may be in any language, so if it's not in English, translate it first.`
                : "No specific user instructions were provided."
              }

Write a clear, effective image editing prompt that would help transform this into a professional product photo. Focus on what specific edits would improve this particular image.

Your prompt should be in English, under 100 words, and only contain the edit instructions with no additional commentary.`,
          },
        ];

        console.log(
          "Prompt oluşturmak için Gemini 1.5 Flash'a istek gönderiliyor..."
        );

        const promptResponse = await promptModel.generateContent(promptContent);

        // Extract the generated prompt
        let generatedPrompt =
          "Edit this product image to make it look professional with good lighting and clean background.";

        if (promptResponse && promptResponse.response) {
          generatedPrompt = promptResponse.response.text();

          // Post-process the prompt to remove any introductory phrases
          generatedPrompt = generatedPrompt
            .replace(
              /^(certainly|here is|here's|sure|of course|elbette)(!|,|:|\.)\s*/i,
              ""
            )
            .replace(/^(the|a) prompt( would be| is)(:|\.)?\s*/i, "")
            .replace(
              /^(here is|here's) (the|a) prompt( for you)?(:|\.)?\s*/i,
              ""
            )
            .trim();

          console.log(
            "\n==== GEMINİ 1.5 FLASH TARAFINDAN OLUŞTURULAN PROMPT - BAŞLANGIÇ ===="
          );
          console.log(generatedPrompt);
          console.log(
            "==== GEMINİ 1.5 FLASH TARAFINDAN OLUŞTURULAN PROMPT - BİTİŞ ====\n"
          );

          // Log the prompt in a more visible way for debugging
          console.log("\x1b[32m%s\x1b[0m", "OLUŞTURULAN PROMPT:");
          console.log("\x1b[33m%s\x1b[0m", generatedPrompt);
        } else {
          console.log("Prompt oluşturulamadı, varsayılan prompt kullanılacak.");
          console.log("\x1b[31m%s\x1b[0m", "VARSAYILAN PROMPT KULLANILDI");
        }

        // Now, use the generated prompt to process the image with Gemini 2.0 Flash
        const model = genAI.getGenerativeModel({
          model: "gemini-flash-latest",
          generationConfig: {
            responseModalities: ["Text", "Image"],
            temperature: 1,
            topP: 0.95,
            topK: 40,
          },
        });

        console.log(
          "Generating new image with gemini-1.5-flash-exp using the generated prompt..."
        );

        // Prepare the content with the uploaded image and generated prompt
        const content = [
          {
            fileData: {
              mimeType: uploadedFile.mimeType,
              fileUri: uploadedFile.uri,
            },
          },
          {
            text: `${generatedPrompt}

${userDescription
                ? `Also consider these user instructions: "${userDescription}"`
                : ""
              }`,
          },
        ];

        // Generate the content
        const response = await model.generateContent(content);
        console.log("\n==== GEMİNİ API YANIT BAŞLANGIÇ ====");
        console.log("Response received from Gemini API");
        console.log("==== GEMİNİ API YANIT BİTİŞ ====\n");

        // Log response structure for debugging
        console.log("Response structure:", Object.keys(response));

        let responseText = "";
        let generatedImages = [];
        let savedImagePaths = [];
        let supabaseUrls = [];

        // Process the response parts
        if (
          response.response &&
          response.response.candidates &&
          response.response.candidates.length > 0 &&
          response.response.candidates[0].content &&
          response.response.candidates[0].content.parts
        ) {
          console.log("Processing response parts...");

          for (const part of response.response.candidates[0].content.parts) {
            // Based on the part type, either extract text or image
            if (part.text) {
              console.log("Text part found:", part.text);
              responseText = part.text;
            } else if (part.inlineData) {
              console.log(`Image part found: ${part.inlineData.mimeType}`);

              // Save the image to both debug and results folders
              try {
                // For debug purpose
                const debugDir = path.join(__dirname, "../../temp/debug");
                await mkdirAsync(debugDir, { recursive: true }).catch(() => { });

                // Generate file names
                const imageExt =
                  part.inlineData.mimeType.split("/")[1] || "png";
                const timestamp = Date.now();
                const originalName = req.file.originalname.replace(
                  /\.[^/.]+$/,
                  ""
                ); // Remove extension
                const imageFileName = `${originalName}_processed_${timestamp}.${imageExt}`;

                // Save to debug folder
                const debugFilePath = path.join(debugDir, imageFileName);

                // Save to results folder
                const resultsFilePath = path.join(resultsDir, imageFileName);

                const imageData = part.inlineData.data;
                // Remove data URI prefix if present
                const base64Data = imageData.replace(
                  /^data:image\/\w+;base64,/,
                  ""
                );

                // Write to both locations
                await writeFileAsync(debugFilePath, base64Data, {
                  encoding: "base64",
                });

                await writeFileAsync(resultsFilePath, base64Data, {
                  encoding: "base64",
                });

                console.log(`Debug image saved to: ${debugFilePath}`);
                console.log(`Result image saved to: ${resultsFilePath}`);

                savedImagePaths.push(resultsFilePath);

                // Upload to Supabase
                try {
                  const supabaseUrl = await uploadToSupabase(
                    resultsFilePath,
                    `processed/${imageFileName}`
                  );
                  supabaseUrls.push(supabaseUrl);
                  console.log(`Image uploaded to Supabase: ${supabaseUrl}`);
                } catch (supabaseError) {
                  console.error("Supabase upload error:", supabaseError);
                  // Continue processing even if upload fails
                }

                generatedImages.push({
                  mimeType: part.inlineData.mimeType,
                  savedPath: resultsFilePath,
                  supabaseUrl: supabaseUrls[supabaseUrls.length - 1] || null,
                });
              } catch (e) {
                console.error("Failed to save image:", e);
              }
            }
          }
        } else {
          console.log("Unexpected response structure:", response);
        }

        if (generatedImages.length === 0) {
          console.log("No images found in the response");
        } else {
          console.log(`Found ${generatedImages.length} images in response`);
          console.log(
            `Saved ${savedImagePaths.length} images to results folder`
          );
          console.log(
            `Uploaded ${supabaseUrls.length} images to Supabase products bucket`
          );
        }

        return {
          responseText: responseText,
          generatedPrompt: generatedPrompt,
          generatedImages: generatedImages,
          savedImagePaths: savedImagePaths,
          supabaseUrls: supabaseUrls,
        };
      } catch (error) {
        console.error("Image processing error:", error);
        throw error;
      }
    }

    // Run the image processing
    const processingResult = await processImage();

    // Clean up the temporary upload file
    await unlinkAsync(filePath);

    // Return successful response to client
    console.log("Başarılı yanıt dönülüyor");
    res.status(200).json({
      success: true,
      message: "Image processed successfully",
      result: processingResult.responseText,
      generatedPrompt: processingResult.generatedPrompt,
      generatedImages: processingResult.generatedImages,
      savedImagePaths: processingResult.savedImagePaths,
      supabaseUrls: processingResult.supabaseUrls,
    });
  } catch (error) {
    console.error("Error processing image:", error);

    // Clean up temp file if it exists
    try {
      if (fs.existsSync(filePath)) {
        await unlinkAsync(filePath);
      }
    } catch (unlinkError) {
      console.error("Error deleting temp file:", unlinkError);
    }

    // Return error to client
    res.status(500).json({
      success: false,
      error: "Failed to process image",
      details: error.message,
    });
  }
});

module.exports = router;
