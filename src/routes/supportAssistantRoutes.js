const express = require('express');
const rateLimit = require('express-rate-limit');
const Replicate = require('replicate');
const { validateChat, answerChat } = require('../services/supportAssistant');

function createSupportAssistantRouter({ replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN }) } = {}) {
  const router = express.Router(); let active = 0;
  router.post('/chat', rateLimit({ windowMs: 10 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
    message: { code: 'CHAT_RATE_LIMIT' } }), async (req, res) => {
    let input;
    try { input = validateChat(req.body); } catch { return res.status(400).json({ code: 'INVALID_CHAT' }); }
    if (active >= 8) return res.status(429).json({ code: 'CHAT_BUSY' });
    active++;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    const close = () => controller.abort();
    res.on('close', close);
    res.set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    let sequence = 0;
    const emit = event => { if (!res.destroyed && !res.writableEnded) { res.write(JSON.stringify({ ...event, sequence: sequence++ }) + '\n'); res.flush?.(); } };
    emit({ type: 'start' });
    const heartbeat = setInterval(() => emit({ type: 'ping' }), 15000);
    try { await answerChat({ replicate, ...input, signal: controller.signal, emit }); }
    catch { emit({ type: 'error', code: controller.signal.aborted ? 'CHAT_TIMEOUT' : 'CHAT_UNAVAILABLE' }); }
    finally { clearTimeout(timeout); clearInterval(heartbeat); res.off('close', close); active--; res.end(); }
  });
  return router;
}
module.exports = { createSupportAssistantRouter };
