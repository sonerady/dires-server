const express = require("express");
const router = express.Router();
const Replicate = require("replicate");

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

router.post("/", async (req, res) => {
  try {
    const { swapImage, inputImage } = req.body;
    console.log("1. Received request with data:", {
      swapImage,
      inputImage,
    });

    if (!swapImage || !inputImage) {
      console.log("Error: Both swap image and input image URLs are required");
      return res
        .status(400)
        .json({ error: "Both swap image and input image URLs are required" });
    }

    console.log("2. Starting Replicate API call...");
    const replicateResponse = await replicate.run(
      "codeplugtech/face-swap:278a81e7ebb22db98bcba54de985d22cc1abeead2754eb1f2af717247be69b34",
      {
        input: {
          swap_image: swapImage,
          input_image: inputImage,
        },
      }
    );
    console.log("3. Replicate API response:", replicateResponse);

    const response = {
      swapImage,
      inputImage,
      output: replicateResponse,
      swappedImageUrl: replicateResponse.output,
    };
    console.log("4. Sending response to client:", response);

    res.json(response);
  } catch (error) {
    console.error("Face swap error details:", {
      message: error.message,
      stack: error.stack,
      response: error.response?.data,
    });
    res.status(500).json({ error: "Failed to swap faces" });
  }
});

module.exports = router;
