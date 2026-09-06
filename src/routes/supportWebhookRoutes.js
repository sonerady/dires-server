const express = require('express');
function createSupportWebhookRouter({ service, resend }) {
const router = express.Router();

router.post('/', async (req, res) => {
  const headers = { id: req.get('svix-id'), timestamp: req.get('svix-timestamp'), signature: req.get('svix-signature') };
  if (!headers.id || !headers.timestamp || !headers.signature || !Buffer.isBuffer(req.body)) return res.status(400).json({ error: 'Invalid webhook' });
  let secret;
  try { secret = await service.webhookSecret(); }
  catch { return res.status(503).json({ error: 'Webhook configuration unavailable' }); }
  let event;
  try { event = resend.webhooks.verify({ payload: req.body.toString('utf8'), headers, webhookSecret: secret }); }
  catch { return res.status(400).json({ error: 'Invalid webhook signature' }); }
  try { await service.receive(event); return res.json({ received: true }); }
  catch (error) {
    console.error('[Support] Inbound delivery failed', { emailId: event.data?.email_id, code: error.code || 'SUPPORT_RELAY_FAILED' });
    return res.status(error.status || 503).json({ error: 'Support relay temporarily unavailable' });
  }
});
return router;
}
module.exports = { createSupportWebhookRouter };
