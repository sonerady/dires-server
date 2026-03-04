const { supabaseAdmin } = require('../supabaseClient');

const AUTH_ENABLED = process.env.AUTH_ENFORCEMENT_ENABLED === 'true';

if (!AUTH_ENABLED) {
    console.log('⚠️  [Auth] AUTH_ENFORCEMENT_ENABLED is not true — auth middleware is in pass-through mode');
}

if (AUTH_ENABLED && !supabaseAdmin) {
    console.error('❌ [Auth] CRITICAL: supabaseAdmin is null — Service Role Key missing. All protected routes will return 500.');
}

/**
 * Supabase JWT authentication middleware.
 * Verifies the Bearer token via supabaseAdmin.auth.getUser().
 * Attaches req.user = { id, email } on success.
 */
const requireAuth = async (req, res, next) => {
    // Pass-through when enforcement is disabled (safe deploy)
    if (!AUTH_ENABLED) {
        return next();
    }

    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                code: 'NO_TOKEN',
            });
        }

        const token = authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Invalid token format',
                code: 'INVALID_TOKEN_FORMAT',
            });
        }

        if (!supabaseAdmin) {
            console.error('[Auth] supabaseAdmin is null — cannot verify token');
            return res.status(500).json({
                success: false,
                error: 'Server configuration error',
                code: 'SERVER_ERROR',
            });
        }

        const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

        if (error || !user) {
            return res.status(401).json({
                success: false,
                error: 'Invalid or expired token',
                code: 'INVALID_TOKEN',
            });
        }

        req.user = {
            id: user.id,
            email: user.email,
        };

        next();
    } catch (err) {
        console.error('[Auth] Middleware error:', err.message);
        return res.status(401).json({
            success: false,
            error: 'Authentication failed',
            code: 'AUTH_ERROR',
        });
    }
};

module.exports = { requireAuth };
