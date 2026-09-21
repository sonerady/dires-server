// A generation row is not a financial ledger. Only the backend's successful debit response
// may create this immutable, service-role-only proof. Missing proof means manual review.
//
// ⚠️ 17 Eyl 2026 — bu fonksiyon kredi DÜŞÜLDÜĞÜ an çağrılıyor, yani üretimin
// başında. O sırada reference_results satırı var ama result_image_url henüz
// NULL; eski sürüm bunu zorunlu tuttuğu için HİÇBİR ZAMAN yazmıyordu
// (credit_refund_charges tablosu bomboştu). Sonucu: claim_credit_refund'a
// proof gelmiyor, credit_owner_id null kalıyor ve /analyze içindeki
// "refunded + owner yok → review_pending" kuralı YZ'nin onayladığı her iadeyi
// admin kuyruğuna düşürüyordu. Artık kanıt satırı borçlanma anında yazılıyor;
// sonuç görseli o an yoksa null bırakılıyor ve hem RPC hem eligibility
// generation satırından coalesce ediyor.
async function recordRefundCharge(
  { generationId, userId, creditOwnerId, amount, debit },
  { db = require("../supabaseClient").supabaseAdmin } = {},
) {
  if (
    !db ||
    debit?.success !== true ||
    debit.deducted_amount !== amount ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    !creditOwnerId
  )
    return false;
  try {
    const { data: rows, error } = await db
      .from("reference_results")
      .select("id,result_image_url,pre_upscale_image_url,reference_images")
      .eq("generation_id", generationId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw error;
    const row = rows?.[0] || null;
    const { error: write } = await db.from("credit_refund_charges").upsert(
      {
        generation_id: String(generationId),
        user_id: userId,
        credit_owner_id: creditOwnerId,
        credits: amount,
        result_id: row?.id || null,
        // Üretim daha bitmediği için genelde null — kanıtın taşıdığı asıl bilgi
        // kimin kaç kredisinin düştüğü; görseller generation satırından gelir.
        result_image_url: row?.pre_upscale_image_url || row?.result_image_url || null,
        product_image_urls: row?.reference_images || [],
      },
      { onConflict: "user_id,generation_id", ignoreDuplicates: true },
    );
    if (write) throw write;
    return true;
  } catch (error) {
    console.error("[Refund charge evidence]", error.message);
    return false;
  }
}
module.exports = { recordRefundCharge };
