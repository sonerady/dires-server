const { Resend } = require('resend');
const { supabaseAdmin } = require('../supabaseClient');
const { createSupportMailStore } = require('./supportMailStore');
const { createSupportMail } = require('./supportMail');
const resend = new Resend(process.env.RESEND_API_KEY);
const service = createSupportMail({ resend, store: createSupportMailStore(supabaseAdmin) });
module.exports = { resend, service };
