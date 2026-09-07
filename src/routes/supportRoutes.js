const express = require('express');
const rateLimit = require('express-rate-limit');
const { service } = require('../lib/supportMailRuntime');
const { supabaseAdmin } = require('../supabaseClient');
const { resolveSupportContext } = require('../lib/supportContext');
const router = express.Router();

// Contact is available to signed-out customers and native clients as well.
// It only sends to our fixed support inbox, never to a client-supplied recipient.
router.post('/send', rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: 'SUPPORT_RATE_LIMIT' },
}), async (req, res) => {
  try {
    const result = await service.submit(req.body, await resolveSupportContext(req, supabaseAdmin));
    res.json(result);
  } catch (error) {
    console.error('[Support] Form failed', { code: error.code || 'SUPPORT_SEND_FAILED' });
    res.status(error.status || 503).json({ success: false, code: error.code || 'SUPPORT_SEND_FAILED' });
  }
});
module.exports = router;
