const rateLimit = require('express-rate-limit');

const getClientIp = (req) => {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
};

// Strict rate limit for catalog/data endpoints (anti-scraping)
const catalogRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many requests. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
    },
    keyGenerator: getClientIp,
    validate: false,
});

// Browser detection middleware
// Browsers send `origin` header for CORS requests and `sec-fetch-mode` for modern browsers.
// Postman, curl, and scripts do not send these headers by default.
const requireBrowser = (req, res, next) => {
    const origin = req.headers['origin'];
    const secFetchMode = req.headers['sec-fetch-mode'];
    const referer = req.headers['referer'];

    // Allow if any browser-specific header is present
    if (origin || secFetchMode || referer) {
        return next();
    }

    return res.status(403).json({
        success: false,
        error: 'Forbidden',
        code: 'NON_BROWSER_REQUEST',
    });
};

// Bot detection middleware
const botDetection = (req, res, next) => {
    const userAgent = req.headers['user-agent'];

    if (!userAgent) {
        return res.status(403).json({
            success: false,
            error: 'Forbidden',
            code: 'NO_USER_AGENT',
        });
    }

    const botPatterns = [
        /\bbot\b/i, /\bcrawl/i, /\bspider\b/i, /\bscraper\b/i,
        /^curl\b/i, /^wget\b/i, /python-requests/i, /^httpie\b/i,
    ];

    if (botPatterns.some((p) => p.test(userAgent))) {
        return res.status(403).json({
            success: false,
            error: 'Forbidden',
            code: 'BOT_DETECTED',
        });
    }

    next();
};

module.exports = { catalogRateLimiter, botDetection, requireBrowser };
