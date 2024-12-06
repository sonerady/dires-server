const express = require("express");
const Replicate = require("replicate");
const supabase = require("../supabaseClient");
const OpenAI = require("openai");

const router = express.Router();

const openai = new OpenAI();
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});
const { v4: uuidv4 } = require("uuid");

async function generatePrompt(
  imageUrl,
  initialPrompt,
  customPrompt,
  extraPromptDetail,
  categories
) {
  const MAX_RETRIES = 20; // Define the maximum number of retries
  let attempt = 0;
  let generatedPrompt = "";

  console.log("Image URL:", imageUrl);

  while (attempt < MAX_RETRIES) {
    try {
      let contentMessage = "";

      console.log("Initial Prompt:", initialPrompt);
      console.log("Custom Prompt:", customPrompt);
      console.log("Extra Prompt Detail:", extraPromptDetail);

      let environmentContext = "";
      if (customPrompt && initialPrompt) {
        environmentContext = `${initialPrompt}, ${customPrompt}`;
      } else if (customPrompt) {
        environmentContext = customPrompt;
      } else if (initialPrompt) {
        environmentContext = initialPrompt;
      }

      const rawImageString = imageUrl;
      let convertedImageUrl;

      try {
        convertedImageUrl = JSON.parse(rawImageString)[0]; // Extract the URL from JSON string
        console.log("Converted Image URL:", convertedImageUrl);
      } catch (error) {
        console.error("Error parsing image URL:", error);
        convertedImageUrl = rawImageString; // Use original string in case of error
      }

      console.log("Converted Image URL:", convertedImageUrl);

      if (categories === "on_model") {
        contentMessage = `Create a detailed and professional prompt for the product shown in the provided image. The description should capture the product with an extraordinary level of precision, focusing on every minute detail. Pay special attention to its color, texture, material, and any subtle design features that distinguish it. The product must be showcased on a real-life model, ensuring the natural interaction between the product and the model’s physique is emphasized authentically. This prompt should explicitly specify that no mannequins or artificial displays are to be used. The image should exude the realism, elegance, and sophistication that only a real-life model can provide, with the product fitting seamlessly into a dynamic, lifelike scenario.

        The real-life model should wear the product in a way that highlights its fit, style, and proportions. Describe how the fabric moves and interacts with the model’s body in motion—whether it flows elegantly with each step, drapes gently over the figure, or retains a structured, tailored look. If the product includes intricate details, such as embroidery or embellishments, these should be highlighted as they catch light or create dimension on the model. Mention specific elements like the long sleeves reaching the wrists, the high neckline gracefully framing the face, or how the hemline sweeps along the ground with a subtle train.

        The photograph must embody the quality and artistry of high-fashion editorial photography, with a polished, professional aesthetic. The lighting and composition should focus on bringing out the product’s details while presenting the real-life model in a flattering, elegant manner. The model’s pose, posture, and expression must complement the product, ensuring that it remains the focal point of the image while the model adds to the storytelling. Suggest unique camera angles—such as a close-up to highlight intricate texture and embroidery, a full-length profile to showcase the dress’s silhouette, or a dynamic angle that captures the model in motion.

        Clearly articulate how the product interacts with the model’s physique, noting whether it hugs the figure, flows loosely, or has a structured, regal appearance. If additional environmental details are provided, these should be woven into the narrative to place the model in an authentic or artistic setting. For instance, a soft, floral background or an elegant indoor space could enhance the overall presentation of the product.

        The resulting image must be artistic and professional, evoking the exclusivity and refinement of high-end fashion photography. The prompt should emphasize that the model is real, ensuring a sense of realism and luxury that cannot be replicated by mannequins. Specify the lighting conditions, such as soft, natural light for a dreamy effect, sharp studio lighting for a crisp, editorial look, or dramatic, moody lighting for an artistic flair.

        ${
          environmentContext
            ? `The details of the model and the environment where the model will be present are as follows: ${environmentContext}.`
            : ""
        }

        ${
          extraPromptDetail
            ? `These are additional details about the product, and I want you to include them in the generated prompt as well: ${extraPromptDetail}`
            : ""
        }`;
      } else if (categories === "photoshoot") {
        contentMessage = `Write a very long prompt in English that provides a highly detailed and vivid description of the item, focusing on highlighting it in a creative photoshoot scene with captivating angles and an atmosphere that draws the viewer in. Begin by setting the scene: describe the environment in exquisite detail, such as the way sunlight filters through the leaves of a lush garden, casting dappled light on the product, or the soft shadows. Explain how this setting complements the product, crafting a visual narrative that engages the audience's attention.

        Describe every aspect of the item meticulously. For example, if it is a unique ceramic vase, detail how the light reflects off its glossy surface or how the texture of the ceramic appears under soft shadows. Highlight any intricate patterns or subtle design features that make the item stand out, using sensory language to bring these details to life vividly.

        ${
          environmentContext
            ? `Base the scene and all descriptive details on the provided environment context. These details may have been provided in different languages, so translate and write them in English in your prompt: ${environmentContext}.`
            : ""
        }

        Bring the environment to life with rich sensory details: describe the interplay of light and shadow, the textures of the surroundings, and how these elements interact with the product. Paint a vivid image of how the product fits into or stands out in the scene. Elaborate on how the product's materials feel to the touch, how it interacts with the environment, and how its colors change under different lighting conditions. Use language that effectively conveys the mood and setting to evoke emotions and spark the viewer’s imagination.

        Do not describe the product as being worn or used by a model. Instead, ensure that the item is presented in the environment on its own, with the background being an AI-generated setting that complements the product's characteristics. ${
          extraPromptDetail
            ? `Include these additional details to describe the item in the prompt: ${extraPromptDetail}`
            : ""
        }`;
      } else if (categories === "retouch") {
        contentMessage = `Create a prompt that begins with a highly detailed and vivid description of the main product in the image. For instance, if the main product is a white lace dress, describe it as follows: 'The product is an exquisite white lace dress featuring intricate floral lace patterns that run seamlessly across the bodice and flow into a delicate, scalloped hemline. The dress is adorned with subtle, almost ethereal embroidery that captures the light, giving it a soft shimmer. Its elegant neckline is framed with fine lace trim, and the fitted bodice accentuates the waist before cascading into a graceful, flowing skirt. The fabric's texture is both soft and structured, with each lace detail carefully woven to create a harmonious and luxurious look. The delicate sleeves add a touch of romance, while the overall silhouette is designed to drape beautifully, creating a captivating and timeless appeal.' Then, proceed with the enhancement instructions: increase the dress's brightness and clarity to make the intricate lace patterns and embroidery stand out, add natural shadows to accentuate its shape, and improve the texture to emphasize the fabric’s delicate yet structured feel. Soften the edges of the dress to ensure it blends smoothly with a pure white background. Reduce any reflections on the fabric to maintain an authentic look and adjust the colors for perfect vibrancy. Remove any dust or imperfections to present the dress flawlessly. Make sure the entire prompt is written as a cohesive and continuous piece of text, focusing only on the main product and excluding any unnecessary or unrelated details. ${
          extraPromptDetail ? `Extra detail: ${extraPromptDetail}` : ""
        }`;
      }

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are a prompt engineer" },
          {
            role: "user",
            content: [
              { type: "text", text: contentMessage },
              {
                type: "image_url",
                image_url: {
                  url: `${convertedImageUrl}`,
                },
              },
            ],
          },
        ],
      });

      generatedPrompt = completion.choices[0].message.content;
      console.log("Generated prompt:", generatedPrompt);
      const finalWordCount = generatedPrompt.trim().split(/\s+/).length;

      // Check if the response contains the undesired phrase
      if (
        generatedPrompt.includes("I’m sorry") ||
        generatedPrompt.includes("I'm sorry") ||
        generatedPrompt.includes("I'm unable") ||
        generatedPrompt.includes("I can't") ||
        (generatedPrompt.includes("I cannot") && finalWordCount < 100)
      ) {
        console.warn(
          `Attempt ${
            attempt + 1
          }: Received an undesired response from ChatGPT. Retrying...`
        );
        attempt++;
        // Optional: Add a delay before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000)); // 1-second delay
        continue; // Retry the loop
      }

      // If the response is valid, break out of the loop
      break;
    } catch (error) {
      console.error("Error generating prompt:", error);
      attempt++;
      // Optional: Add a delay before retrying
      await new Promise((resolve) => setTimeout(resolve, 1000)); // 1-second delay
    }
  }

  if (
    generatedPrompt.includes("I’m sorry") ||
    generatedPrompt.includes("I'm sorry") ||
    generatedPrompt.includes("I'm unable")
  ) {
    throw new Error(
      "ChatGPT API could not generate a valid prompt after multiple attempts."
    );
  }

  return generatedPrompt;
}

// Function to generate images using Replicate API
async function generateImagesWithReplicate(
  prompt,
  hf_loras,
  categories,
  imageRatio,
  imageFormat,
  imageCount
) {
  try {
    // Modify prompt based on category
    let modifiedPrompt = `A photo of TOK ${prompt}`;
    if (categories === "retouch") {
      modifiedPrompt += " in the middle, white background";
    }

    // Set default hf_loras based on category
    let hf_loras_default = [];
    if (categories === "on_model") {
      hf_loras_default = ["VideoAditor/Flux-Lora-Realism"];
    } else if (categories === "retouch") {
      hf_loras_default = ["gokaygokay/Flux-White-Background-LoRA"];
    }

    const filteredHfLoras = Array.isArray(hf_loras)
      ? hf_loras.filter(
          (item) => typeof item === "string" && item.trim() !== ""
        )
      : [];

    // Log hf_loras for debugging
    console.log("Filtered hf_loras:", filteredHfLoras);
    console.log("Default hf_loras:", hf_loras_default);

    // Combine default and provided hf_loras
    const combinedHfLoras =
      filteredHfLoras.length > 0
        ? [...hf_loras_default, ...filteredHfLoras]
        : hf_loras_default;

    console.log("Combined hf_loras:", combinedHfLoras);

    const output = await replicate.run(
      "lucataco/flux-dev-multi-lora:2389224e115448d9a77c07d7d45672b3f0aa45acacf1c5bcf51857ac295e3aec",
      {
        input: {
          prompt: modifiedPrompt,
          hf_loras: combinedHfLoras,
          lora_scales: [0.85],
          num_outputs: imageCount,
          aspect_ratio: imageRatio,
          output_format: imageFormat,
          guidance_scale: 5,
          output_quality: 100,
          prompt_strength: 1,
          num_inference_steps: 50,
          disable_safety_checker: true,
        },
      }
    );

    return output;
  } catch (error) {
    console.error("Error generating images:", error);
    throw error;
  }
}

async function updateRequestStatus(request_id, status) {
  const { data, error } = await supabase
    .from("requests")
    .update({ status })
    .eq("request_id", request_id);

  if (error) {
    console.error(
      `Error updating request status to '${status}' for request_id ${request_id}:`,
      error
    );
    // Decide whether to throw the error or handle it silently
    throw error; // Propagate the error to handle it in the calling function
  }

  console.log(`Request ${request_id} status updated to '${status}'.`);
}

async function createSupabaseRequest({
  userId,
  productId,
  product_main_image,
  imageCount,
  requests_image,
  categories,
}) {
  const newUuid = uuidv4(); // Generate a new UUID

  const { data, error } = await supabase
    .from("requests")
    .insert([
      {
        user_id: userId,
        status: "pending",
        image_url: requests_image, // Assuming first image URL
        product_id: productId,
        request_id: newUuid,
        image_count: imageCount,
        categories: categories,
      },
    ])
    .select();

  if (error) {
    console.error("Supabase insert error:", error);
    throw new Error("Failed to create request in Supabase.");
  }

  console.log("Request successfully added to Supabase:", data);
  return newUuid;
}

// Main POST endpoint with request_id handling
router.post("/generatePredictions", async (req, res) => {
  const {
    prompt,
    hf_loras,
    categories,
    userId,
    productId, // This will be a varchar
    product_main_image,
    customPrompt,
    extraPromptDetail,
    imageRatio,
    imageFormat,
    imageCount,
    requests_image,
    // request_id is no longer expected from frontend
  } = req.body;

  // Basic validation
  if (!userId || !productId || !product_main_image || !imageCount) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields.",
    });
  }

  let request_id; // Declare request_id outside the try block

  try {
    // Create a new request in Supabase and get the request_id
    request_id = await createSupabaseRequest({
      userId,
      productId,
      product_main_image,
      imageCount,
      requests_image: requests_image,
      categories: categories,
    });

    console.log("Starting prompt generation for productId:", productId);

    // Generate the prompt
    const generatedPrompt = await generatePrompt(
      product_main_image[0],
      prompt,
      customPrompt,
      extraPromptDetail,
      categories
    );

    console.log("Generated Prompt:", generatedPrompt);

    // Fetch current imageCount for the product
    const { data: productData, error: productError } = await supabase
      .from("userproduct")
      .select("imageCount")
      .eq("product_id", productId) // product_id is varchar
      .single();

    if (productError) {
      console.error("Error fetching product data:", productError);
      // Update request status to 'failed'
      await updateRequestStatus(request_id, "failed");
      return res.status(500).json({
        success: false,
        message: "Failed to fetch product data",
        error: productError.message,
      });
    }

    // Calculate the new imageCount
    const newImageCount = (productData?.imageCount || 0) + imageCount;

    // Check if newImageCount exceeds 30
    if (newImageCount > 30) {
      const creditsToDeduct = imageCount * 5; // 5 credits per image

      // Fetch user's current credit balance
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("credit_balance")
        .eq("id", userId)
        .single();

      if (userError) {
        console.error("Error fetching user data:", userError);
        // Update request status to 'failed'
        await updateRequestStatus(request_id, "failed");
        return res.status(500).json({
          success: false,
          message: "Failed to fetch user data",
          error: userError.message,
        });
      }

      // Check if user has enough credits
      if (userData.credit_balance < creditsToDeduct) {
        // Update request status to 'failed'
        await updateRequestStatus(request_id, "failed");
        return res.status(400).json({
          success: false,
          message: "Insufficient credit balance",
        });
      }

      // Deduct credits from user's balance
      const { error: creditUpdateError } = await supabase
        .from("users")
        .update({ credit_balance: userData.credit_balance - creditsToDeduct })
        .eq("id", userId);

      if (creditUpdateError) {
        console.error("Error updating credit balance:", creditUpdateError);
        // Update request status to 'failed'
        await updateRequestStatus(request_id, "failed");
        return res.status(500).json({
          success: false,
          message: "Failed to deduct credits",
          error: creditUpdateError.message,
        });
      }

      console.log(`Deducted ${creditsToDeduct} credits from userId: ${userId}`);
    }

    // Generate images using Replicate API
    const output = await generateImagesWithReplicate(
      generatedPrompt,
      hf_loras,
      categories,
      imageRatio,
      imageFormat,
      imageCount
    );

    console.log("Generated Images:", output);

    // Insert each generated image into the 'predictions' table
    const insertPromises = output.map(async (imageUrl) => {
      const { error: insertError } = await supabase.from("predictions").insert({
        id: uuidv4(), // Generate a new UUID
        user_id: userId,
        product_id: productId, // Using varchar as intended
        prediction_image: imageUrl,
        categories,
        product_main_image,
      });

      if (insertError) {
        console.error("Insert error:", insertError);
        throw insertError;
      }
    });

    // Wait for all insert operations to complete
    await Promise.all(insertPromises);

    // Update the imageCount in the 'userproduct' table
    const { error: updateError } = await supabase
      .from("userproduct")
      .update({ imageCount: newImageCount })
      .eq("product_id", productId); // product_id is varchar

    if (updateError) {
      console.error("Error updating image count:", updateError);
      // Update request status to 'failed'
      await updateRequestStatus(request_id, "failed");
      return res.status(500).json({
        success: false,
        message: "Failed to update image count",
        error: updateError.message,
      });
    }

    // Update request status to 'succeeded'
    await updateRequestStatus(request_id, "succeeded");

    // Successful response
    res.status(200).json({
      success: true,
      message: "Predictions generated and imageCount updated successfully",
      data: output,
    });

    console.log("Response Data:", output);
  } catch (error) {
    console.error("Prediction error:", error);
    try {
      // Attempt to update request status to 'failed' if possible
      if (typeof request_id !== "undefined") {
        await updateRequestStatus(request_id, "failed");
      }
    } catch (updateStatusError) {
      console.error(
        "Failed to update request status to 'failed':",
        updateStatusError
      );
      // Optionally, you might want to handle this scenario further
    }
    res.status(500).json({
      success: false,
      message: "Prediction generation failed",
      error: error.message,
    });
  }
});

module.exports = router;
