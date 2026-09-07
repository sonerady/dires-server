const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { formatSupportContext } = require('./supportContext');
const { simpleParser } = require('mailparser');
const { dkimVerify } = require('mailauth/lib/dkim/verify');

const SUPPORT_EMAIL = 'support@diress.ai';
const OWNER_EMAIL = process.env.SUPPORT_OWNER_EMAIL || 'skozayy@gmail.com';
const FROM = `Diress Support <${SUPPORT_EMAIL}>`;
const WEBHOOK_URL = process.env.SUPPORT_WEBHOOK_URL || 'https://dires-server-production.up.railway.app/api/support/inbound';
const MAX_RAW = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 10 * 1024 * 1024;
const cleanHeader = value => String(value || '').replace(/[\r\n\x00-\x1f]/g, ' ').trim().slice(0, 200);
const normalizeEmail = value => String(value || '').trim().toLowerCase();
const isEmail = value => typeof value === 'string' && value.length <= 254 && /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/.test(value);
const messageId = value => /^<[^\s<>]{1,240}>$/.test(value || '') ? value : undefined;
const replyAddress = (kind, ticket) => `${kind}+${ticket[kind === 'agent' ? 'agent_token' : 'customer_token']}@diress.ai`;
const privateText = text => String(text || '').replace(new RegExp(OWNER_EMAIL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), SUPPORT_EMAIL).replace(/agent\+[a-f0-9]{48}@diress\.ai/gi, SUPPORT_EMAIL);

function validateForm(body) {
  const { email, subject, message, name = '', requestId = randomUUID() } = body || {};
  if (!isEmail(email) || typeof subject !== 'string' || !subject.trim() || subject.length > 200 || /[\r\n]/.test(subject) || typeof message !== 'string' || message.trim().length < 1 || message.length > 10000 || typeof name !== 'string' || name.length > 120 || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId)) {
    throw Object.assign(new Error('Invalid support message'), { status: 400, code: 'INVALID_SUPPORT_MESSAGE' });
  }
  return { email: normalizeEmail(email), subject: cleanHeader(subject), message: message.trim(), name: cleanHeader(name), requestId };
}

function createTicket(id, email, subject, extra = {}) {
  return { id, customer_email: email, subject: cleanHeader(subject) || 'Diress Support', agent_token: randomBytes(24).toString('hex'), customer_token: randomBytes(24).toString('hex'), ...extra };
}

function createSupportMail({ resend, store, download = fetch, verifyDkim = dkimVerify, parse = simpleParser }) {
  let webhookCache, webhookUntil = 0, webhookPending;
  async function webhookSecret() {
    if (process.env.RESEND_SUPPORT_WEBHOOK_SECRET) return process.env.RESEND_SUPPORT_WEBHOOK_SECRET;
    if (webhookCache && Date.now() < webhookUntil) return webhookCache;
    // Existing deployments can discover this secret with their server-only Resend key.
    // Only the fixed application endpoint is accepted, never a request-supplied URL.
    if (!webhookPending) webhookPending = (async () => {
      const { data, error } = await resend.webhooks.list({ limit: 100 });
      if (error) throw new Error('Cannot load support webhook');
      const hook = data.data.find(h => h.endpoint === WEBHOOK_URL && h.status === 'enabled' && h.events?.includes('email.received'));
      if (!hook) throw new Error('Support webhook is not configured');
      const response = await resend.webhooks.get(hook.id);
      if (response.error || !response.data.signing_secret) throw new Error('Cannot load support webhook secret');
      webhookCache = response.data.signing_secret; webhookUntil = Date.now() + 5 * 60 * 1000;
      return webhookCache;
    })().finally(() => { webhookPending = null; });
    return webhookPending;
  }
  async function send(payload, id) {
    const { data, error } = await resend.emails.send(payload, { idempotencyKey: `support/${id}` });
    if (error || !data?.id) throw Object.assign(new Error('Support email delivery failed'), { code: error?.name || 'EMAIL_FAILED' });
    return data;
  }
  const headers = id => messageId(id) ? { 'In-Reply-To': id, References: id } : undefined;
  function toOwner(ticket, text, attachments = []) {
    return { from: FROM, to: OWNER_EMAIL, replyTo: replyAddress('agent', ticket), subject: `[Diress #${ticket.id.slice(0, 8)}] ${ticket.subject}`, text: `${text}\n\n--- Diress Support ---\nCustomer: ${ticket.customer_email}\n${formatSupportContext(ticket.support_context)}Reply above this line to respond as ${SUPPORT_EMAIL}.\n`, headers: headers(ticket.last_agent_message_id), ...(attachments.length ? { attachments } : {}) };
  }
  async function submit(body, context = null) {
    const form = validateForm(body);
    if (form.email.endsWith('@diress.ai')) throw Object.assign(new Error('Use the customer email address'), { status: 400, code: 'INVALID_SUPPORT_MESSAGE' });
    const hashInput = [form.email, form.subject, form.message, form.name];
    if (context?.account) hashInput.push(context.account.authUserId);
    const hash = createHash('sha256').update(JSON.stringify(hashInput)).digest('hex');
    const ticket = await store.createConversation(createTicket(form.requestId, form.email, form.subject, { request_hash: hash, support_context: context }));
    if (ticket.request_hash !== hash) throw Object.assign(new Error('Request ID was already used'), { status: 409 });
    await store.deliver(`form:${ticket.id}`, async () => toOwner(ticket, `${form.name ? `${form.name}\n\n` : ''}${form.message}`), send);
    return { success: true, ticketId: ticket.id };
  }
  async function rawEmail(email) {
    if (!email.raw?.download_url || new URL(email.raw.download_url).protocol !== 'https:') throw new Error('Original support email is unavailable');
    const response = await download(email.raw.download_url, { signal: AbortSignal.timeout(30000), redirect: 'error' });
    if (!response.ok || Number(response.headers.get('content-length')) > MAX_RAW) throw new Error('Cannot download support email');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > MAX_RAW) throw new Error('Support email too large'); chunks.push(Buffer.from(chunk)); }
    return Buffer.concat(chunks);
  }
  async function receive(event) {
    if (event.type !== 'email.received') return { ignored: true };
    const id = event.data?.email_id;
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) throw Object.assign(new Error('Invalid received email ID'), { status: 400 });
    return store.deliver(`inbound:${id}`, async () => {
      const { data: email, error } = await resend.emails.receiving.get(id);
      if (error || !email) throw new Error('Cannot retrieve support email');
      // Envelope recipients from the signed event are authoritative, not forwarded To/CC headers.
      const recipients = (event.data.to || []).map(normalizeEmail);
      const targets = recipients.filter(x => x === SUPPORT_EMAIL || /^(agent|reply)\+[a-f0-9]{48}@diress\.ai$/.test(x));
      if (targets.length !== 1) return null;
      const raw = await rawEmail(email);
      const parsed = await parse(raw, { skipImageLinks: true, skipTextToHtml: true });
      if (parsed.from?.value?.length !== 1 || parsed.headerLines.filter(h => h.key === 'from').length !== 1) return null;
      const sender = normalizeEmail(parsed.from.value[0].address);
      if (!isEmail(sender)) return null;
      if ((parsed.headers.get('auto-submitted') || 'no').toLowerCase() !== 'no' || /^(bulk|list|junk)$/i.test(parsed.headers.get('precedence') || '') || parsed.headerLines.some(h => h.key === 'list-id') || sender.startsWith('mailer-daemon@') || sender.startsWith('postmaster@')) return null;
      const target = targets[0], route = target.match(/^(agent|reply)\+([a-f0-9]{48})@/);
      let ticket;
      if (route) ticket = await store.byToken(route[1] === 'agent' ? 'agent' : 'customer', route[2]);
      if (route && !ticket) return null;
      const attachments = (parsed.attachments || []).map(a => ({ filename: privateText(a.filename || 'attachment'), content: a.content.toString('base64'), contentType: a.contentType }));
      if ((parsed.attachments || []).reduce((n, a) => n + a.content.length, 0) > MAX_ATTACHMENTS) throw new Error('Support attachments exceed 10 MB');
      const { default: EmailReplyParser } = await import('email-reply-parser');
      let text = new EmailReplyParser().read(parsed.text || '').getVisibleText().trim();
      if (route?.[1] === 'agent') {
        if (sender !== normalizeEmail(OWNER_EMAIL)) return null;
        if (!parsed.to?.value?.some(v => normalizeEmail(v.address) === target)) return null;
        const verification = await verifyDkim(raw);
        const ownerDomain = sender.split('@')[1];
        if (!verification.results?.some(r => r.status?.result === 'pass' && r.signingDomain?.toLowerCase() === ownerDomain && ['from', 'to', 'subject'].every(h => r.signingHeaders?.keys?.toLowerCase().split(':').map(x => x.trim()).includes(h)) && r.signatureTimeValid !== false && !r.canonBodyLengthLimited)) return null;
        // Send only the new reply; never forward the personal mailbox's headers or quoted routing tokens.
        text = privateText(text.split(/\n(?:--- Diress Support(?: Context)? ---|Reply above this line)/)[0]).trim();
        if (!text && !attachments.length) return null;
        await store.updateConversation(ticket.id, { last_agent_message_id: messageId(parsed.messageId) || null });
        return { from: FROM, to: ticket.customer_email, replyTo: replyAddress('reply', ticket), subject: /^re:/i.test(ticket.subject) ? ticket.subject : `Re: ${ticket.subject}`, text: `${text}\n\nDiress Support\nhttps://diress.ai`, headers: headers(ticket.last_customer_message_id), ...(attachments.length ? { attachments } : {}) };
      }
      if ((!ticket && sender === normalizeEmail(OWNER_EMAIL)) || sender.endsWith('@diress.ai')) return null;
      if (ticket && sender !== ticket.customer_email) return null;
      if (!ticket) ticket = await store.createConversation(createTicket(id, sender, email.subject));
      await store.updateConversation(ticket.id, { last_customer_message_id: messageId(parsed.messageId) || null });
      return toOwner(ticket, text || '(Attachment)', attachments);
    }, send);
  }
  return { submit, receive, webhookSecret };
}
module.exports = { createSupportMail, validateForm, createTicket, SUPPORT_EMAIL, OWNER_EMAIL, WEBHOOK_URL, privateText };
