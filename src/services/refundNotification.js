async function sendRefundNotification(
  db,
  row,
  { fetchImpl = fetch, env = process.env } = {},
) {
  if (
    row.status !== "refunded" ||
    !row.reviewed_by ||
    row.notification_status === "sent"
  )
    return row;
  try {
    if (!env.ONESIGNAL_APP_ID || !env.ONESIGNAL_REST_API_KEY)
      throw new Error("OneSignal not configured");
    const tr = String(row.language_code).startsWith("tr");
    const response = await fetchImpl(
      "https://api.onesignal.com/notifications",
      {
        method: "POST",
        headers: {
          Authorization: `Key ${env.ONESIGNAL_REST_API_KEY.replace(/^(Key|Basic)\s+/i, "")}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          app_id: env.ONESIGNAL_APP_ID,
          include_aliases: { external_id: [row.user_id] },
          target_channel: "push",
          idempotency_key: row.id,
          headings: {
            en: tr ? "İadeniz onaylandı" : "Your refund is approved",
          },
          contents: {
            en: tr
              ? `${row.refunded_credits} kredi hesabınıza iade edildi.`
              : `${row.refunded_credits} credits have been returned to your account.`,
          },
          data: {
            type: "credit_refund",
            requestId: row.id,
            generationId: row.generation_id,
          },
          ttl: 86400,
        }),
      },
    );
    const result = await response.json();
    if (!response.ok || !result.id || result.errors)
      throw new Error(`OneSignal delivery unavailable (${response.status})`);
    const { error } = await db
      .from("credit_refund_requests")
      .update({
        notification_status: "sent",
        notification_id: result.id,
        notification_error: null,
        notification_attempts: (row.notification_attempts || 0) + 1,
        notification_next_retry_at: null,
      })
      .eq("id", row.id);
    if (error) throw error;
    return { ...row, notification_status: "sent" };
  } catch (error) {
    await db
      .from("credit_refund_requests")
      .update({
        notification_status: "failed",
        notification_error: error.message.slice(0, 200),
        notification_attempts: (row.notification_attempts || 0) + 1,
        notification_next_retry_at: new Date(
          Date.now() +
            Math.min(3600000, 60000 * 2 ** (row.notification_attempts || 0)),
        ).toISOString(),
      })
      .eq("id", row.id);
    return { ...row, notification_status: "failed" };
  }
}
function startRefundReviewWorker(db) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const stale = await db
        .from("credit_refund_requests")
        .update({
          status: "review_pending",
          error_message: "Interrupted analysis; manual review required",
        })
        .eq("status", "analyzing")
        .lt("created_at", new Date(Date.now() - 180000).toISOString());
      if (stale.error) throw stale.error;
      const { data, error } = await db
        .from("credit_refund_requests")
        .select("*")
        .eq("status", "refunded")
        .in("notification_status", ["pending", "failed"])
        .lt("notification_attempts", 8)
        .or(
          `notification_next_retry_at.is.null,notification_next_retry_at.lte.${new Date().toISOString()}`,
        )
        .limit(5);
      if (error) throw error;
      for (const row of data || []) await sendRefundNotification(db, row);
    } catch (error) {
      console.error("[Refund review worker]", error.message);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, 60000);
  timer.unref();
  return () => clearInterval(timer);
}
module.exports = { sendRefundNotification, startRefundReviewWorker };
