const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { Resend } = require('resend');
const { getSupportEmailTemplate } = require('../lib/emailTemplates');

const resend = new Resend(process.env.RESEND_API_KEY);

// Rate limit: 5 support emails per hour per IP
const supportRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many support requests. Please try again later.',
        code: 'SUPPORT_RATE_LIMIT',
    },
    keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
    validate: false,
});

// POST /api/support/send
router.post('/send', supportRateLimiter, async (req, res) => {
    try {
        const { email, subject, message } = req.body;

        if (!email || !subject || !message) {
            return res.status(400).json({
                success: false,
                error: 'Email, subject, and message are required.',
            });
        }

        // Get userId from auth middleware if available
        const userId = req.user?.id || '';

        const html = getSupportEmailTemplate(email, subject, message, userId);

        await resend.emails.send({
            from: 'Diress Support <noreply@diress.ai>',
            to: 'skozayy@gmail.com',
            replyTo: email,
            subject: `[Diress Support] ${subject}`,
            html,
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error sending support email:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to send support message.',
        });
    }
});

module.exports = router;
