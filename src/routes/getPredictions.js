const express = require("express");
const { supabase } = require("../supabaseClient");
const axios = require("axios");
const { fal } = require("@fal-ai/client");
const teamService = require("../services/teamService");

// Fal.ai Config
fal.config({
  credentials: process.env.FAL_API_KEY,
});

const router = express.Router();

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

// Replicate'ten gelen logs içerisinden progress yüzdesini çıkaran fonksiyon
// Bu fonksiyon, log satırlarında "%|" desenini arar ve yakalarsa yüzde değerini döndürür.
function extractProgressFromLogs(logs) {
  if (!logs || typeof logs !== "string") return 0;

  const lines = logs.split("\n").reverse();
  for (const line of lines) {
    const match = line.match(/(\d+)%\|/);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return 0;
}

// Belirli bir prediction_id için Replicate veya Fal.ai API'sinden detayları alan fonksiyon
async function fetchPredictionDetails(predictionId) {
  // Fal.ai ID check (UUID format for Queue API calls)
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(predictionId);

  if (isUuid) {
    // Try Fal.ai Queue API via SDK
    try {
      // queue.status ile durumu kontrol et
      const result = await fal.queue.status("fal-ai/kling-video/v2.1/pro/image-to-video", {
        requestId: predictionId,
        logs: true
      });

      let status = "processing";
      if (result.status === "IN_QUEUE") status = "starting";
      else if (result.status === "IN_PROGRESS") status = "processing";
      else if (result.status === "COMPLETED") status = "succeeded";
      else if (result.status === "FAILED") status = "failed";

      let output = null;
      let logs = "";

      // Logs varsa al
      if (result.logs && Array.isArray(result.logs)) {
        logs = result.logs.map(l => l.message).join("\n");
      }

      // Eğer tamamlandıysa result output'u çekmemiz gerekebilir
      if (status === "succeeded") {
        // Status sonucunda video varsa direkt kullan, yoksa result çağır
        // Not: SDK bazen completed statüsünde data dönüyor olabilir ama queue.result garantidir.
        const finalData = await fal.queue.result("fal-ai/kling-video/v2.1/pro/image-to-video", {
          requestId: predictionId
        });

        if (finalData.data && finalData.data.video && finalData.data.video.url) {
          output = [finalData.data.video.url];
        } else if (finalData.data && finalData.data.images && finalData.data.images[0]) {
          output = [finalData.data.images[0].url];
        }
      }

      return {
        status: status,
        output: output,
        error: null, // Error detayını SDK'dan çekmek lazım ama basitçe null
        logs: logs,
        input: { num_outputs: 1 }
      };

    } catch (falError) {
      // Handle known errors for invalid/local IDs (404 Not Found, 422 Unprocessable Entity)
      // These are likely fallback UUIDs created locally when API failed, so they don't exist in Fal.ai.
      if (falError.status === 404 || falError.status === 422 || (falError.response && (falError.response.status === 404 || falError.response.status === 422)) || falError.message.includes("Unprocessable Entity")) {
        // console.log(`Skipping invalid Fal.ai ID: ${predictionId}`); // Optional debug
        return {
          status: "failed",
          output: null,
          error: "Prediction not found or invalid ID",
          logs: "",
          input: { num_outputs: 0 }
        };
      }

      console.error(`Fal.ai SDK fetch failed for ${predictionId}:`, falError.message);
      return null;
    }
  }

  // Fallback to Replicate for non-UUID IDs (or if logic above allows fallback)
  try {
    const response = await axios.get(
      `https://api.replicate.com/v1/predictions/${predictionId}`,
      {
        headers: {
          Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
        },
      }
    );
    return response.data;
  } catch (error) {
    // Only log error if we are sure it should have existed
    // console.error(...) - reducing noise for expected failures during transition
    console.error(
      `Error fetching prediction ${predictionId} from Replicate:`,
      error.response ? error.response.data : error.message
    );
    return null;
  }
}

router.get("/getPredictions/:userId", async (req, res) => {
  const { userId } = req.params;

  // limit parametresini al
  const limitParam = req.query.limit;
  let limit = null;

  console.log("Received limit parameter:", limitParam);

  if (limitParam !== undefined) {
    limit = parseInt(limitParam, 10);
    if (isNaN(limit) || limit <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid 'limit' parameter. It must be a positive integer.",
      });
    }

    const MAX_LIMIT = 100;
    if (limit > MAX_LIMIT) {
      return res.status(400).json({
        success: false,
        message: `The 'limit' parameter cannot exceed ${MAX_LIMIT}.`,
      });
    }
  }

  try {
    // Get team member IDs for shared workspace
    const { memberIds, isTeamMember } = await teamService.getTeamMemberIds(userId);

    console.log(`📊 [PREDICTIONS] Team mode: ${isTeamMember}, Member IDs: ${memberIds.join(', ')}`);

    // Bir saat önceki zaman damgası
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);

    // Kullanıcının (ve takım üyelerinin) 1 saatten eski tahminlerini sil
    const { error: deleteError } = await supabase
      .from("predictions")
      .delete()
      .in("user_id", memberIds)
      .lt("created_at", oneHourAgo.toISOString());

    if (deleteError) {
      console.error("Delete error:", deleteError);
      return res.status(500).json({
        success: false,
        message: "Failed to delete old predictions",
      });
    }

    // Bir gün önceki zaman damgası
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    // Supabase sorgusu - Team üyeleri için .in() kullan
    let query = supabase
      .from("predictions")
      .select(
        "id, prediction_id, categories, product_id, product_main_image, created_at, user_id"
      )
      .in("user_id", memberIds)
      .gte("created_at", oneDayAgo.toISOString())
      .order("created_at", { ascending: false });

    if (limit !== null) {
      console.log(`Applying limit: ${limit}`);
      query = query.limit(limit);
    }

    const { data: predictions, error: fetchError } = await query;

    if (fetchError) {
      console.error("Fetch error:", fetchError);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch predictions",
      });
    }

    console.log(`Fetched ${predictions.length} predictions`);

    // Her bir prediction için Replicate detaylarını al
    // Her bir prediction için Replicate detaylarını alırken:
    const predictionsWithDetails = await Promise.all(
      predictions.map(async (prediction) => {
        const replicateData = await fetchPredictionDetails(
          prediction.prediction_id
        );

        if (!replicateData) {
          return {
            ...prediction,
            replicate_status: "unknown",
            replicate_output: null,
            replicate_error: null,
            progress: 0,
            image_count: 0,
            replicate_logs: "", // Boş log
          };
        }

        const progress = extractProgressFromLogs(replicateData.logs);

        // Kredi iadesi kontrolü
        if (
          (replicateData.status === "failed" ||
            replicateData.status === "canceled") &&
          (replicateData.status === "failed" ||
            replicateData.status === "canceled") &&
          replicateData.model === "minimax/video-01"
        ) {
          // Önce bu prediction için daha önce iade yapılıp yapılmadığını kontrol et
          const { data: predictionData, error: predictionError } =
            await supabase
              .from("predictions")
              .select("credit_refunded")
              .eq("prediction_id", prediction.prediction_id)
              .single();

          if (predictionError) {
            console.error("Error checking refund status:", predictionError);
          } else if (!predictionData.credit_refunded) {
            // Krediyi iade et
            const { data: userData, error: userError } = await supabase
              .from("users")
              .select("credit_balance")
              .eq("id", userId)
              .single();

            if (userError) {
              console.error(
                "Error fetching user credit balance for refund:",
                userError
              );
            } else if (userData) {
              const { error: creditRefundError } = await supabase
                .from("users")
                .update({ credit_balance: userData.credit_balance + 50 })
                .eq("id", userId);

              if (creditRefundError) {
                console.error(
                  "Error refunding credit balance:",
                  creditRefundError
                );
              } else {
                // İade başarılı olduysa, prediction'ı güncelle
                const { error: updateError } = await supabase
                  .from("predictions")
                  .update({ credit_refunded: true })
                  .eq("prediction_id", prediction.prediction_id);

                if (updateError) {
                  console.error("Error updating refund status:", updateError);
                } else {
                  console.log(
                    `Refunded 50 credits to user ${userId} due to ${replicateData.status} status`
                  );
                }
              }
            }
          } else {
            console.log(
              `Credits already refunded for prediction ${prediction.prediction_id}`
            );
          }
        }

        return {
          ...prediction,
          replicate_status: replicateData.status,
          replicate_output: replicateData.output || null,
          replicate_error: replicateData.error || null,
          progress: progress,
          image_count: replicateData.input.num_outputs || 0,
          replicate_logs: replicateData.logs || "",
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: predictionsWithDetails,
    });
  } catch (error) {
    console.error("Error fetching predictions:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching predictions",
    });
  }
});

module.exports = router;
