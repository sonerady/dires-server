const { formatWithOptions } = require('node:util');
const REDACTED = '[REDACTED]';
const installed = Symbol.for('diress.logRedaction');
const sensitiveKey = (key) => /authorization|cookie|password|passwd|secret|token|apikey|privatekey|credential|receiptdata|clientsecret|verificationcode|resetcode/i.test(String(key).replace(/[^a-z0-9]/gi, ''));

function createLogRedactor(env = process.env) {
  // Catch configured credentials even when a legacy log prints just the value.
  const secrets = [...new Set(Object.entries(env)
    .filter(([key, value]) => (sensitiveKey(key) || /database.*url|dsn|key$|auth$/i.test(key)) && typeof value === 'string' && value.length >= 8)
    .map(([, value]) => value))].sort((a, b) => b.length - a.length);

  function redactText(value) {
    let text = String(value);
    for (const secret of secrets) {
      text = text.split(secret).join(REDACTED);
      text = text.split(encodeURIComponent(secret)).join(REDACTED);
    }
    return text
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, REDACTED)
      .replace(/(^|\n)(\s*(?:cookie|set-cookie|authorization)\s*:)[^\r\n]*/gi, `$1$2 ${REDACTED}`)
      .replace(/\b(?:Bearer|Basic)\s+[^\s,'"}\]]+/gi, REDACTED)
      .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, REDACTED)
      .replace(/\b(?:sk_(?:live_|test_)?|sk-proj-|sb_secret_|gh[pousr]_)[\w-]{8,}/g, REDACTED)
      // JSON, query strings, Node inspect output and human-readable labels.
      .replace(/((?:["']?)(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|(?:access|refresh|id|reset|verification)[_ -]?token|token|(?:x[-_])?api[-_ ]?key|client[_ -]?secret|secret|verification[_ -]?code|receipt[_ -]?data)["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&}\]]+)/gi, `$1${REDACTED}`)
      .replace(/(https?:\/\/|postgres(?:ql)?:\/\/|redis(?:s)?:\/\/)[^\s/@]+:[^\s/@]+@/gi, `$1${REDACTED}@`);
  }

  function clean(value, seen = new WeakSet(), depth = 0) {
    if (typeof value === 'string') return redactText(value);
    if (value === null || typeof value !== 'object') return value;
    if (depth > 8) return '[Truncated]';
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return '[Binary omitted]';
    if (value instanceof Date) return value.toISOString();
    if (value instanceof URL || value instanceof URLSearchParams) return redactText(String(value));
    if (value instanceof Map) return Object.fromEntries([...value].slice(0, 200).map(([k, v]) => [redactText(String(k)), sensitiveKey(k) ? REDACTED : clean(v, seen, depth + 1)]));
    if (value instanceof Set) return [...value].slice(0, 200).map(v => clean(v, seen, depth + 1));
    if (Array.isArray(value)) return value.slice(0, 200).map(v => clean(v, seen, depth + 1));
    const output = Object.create(null);
    // Error message/stack are non-enumerable; keep useful diagnosis, not config secrets.
    const keys = value instanceof Error ? [...new Set(['name', 'message', 'stack', 'cause', ...Object.keys(value)])] : Object.keys(value);
    for (const key of keys.slice(0, 200)) {
      if (sensitiveKey(key)) { output[key] = REDACTED; continue; }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor?.get) { output[key] = '[Getter omitted]'; continue; }
      output[key] = clean(value[key], seen, depth + 1);
    }
    return output;
  }

  return (...args) => {
    try {
      return redactText(formatWithOptions({ colors: false, customInspect: false, getters: false, depth: 8 }, ...args.map((value, index) => {
        if (index === 0 && typeof value === "string") return value; // preserve printf placeholders
        if (typeof value === "string" && typeof args[0] === "string" && sensitiveKey(args[0])) return REDACTED;
        return clean(value);
      })));
    } catch {
      // Logging must neither crash a request nor fall back to leaking raw args.
      return '[Log omitted: could not safely format]';
    }
  };
}

function installLogRedaction(target = console, env = process.env) {
  if (target[installed]) return;
  const redact = createLogRedactor(env);
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'table']) {
    if (typeof target[method] !== 'function') continue;
    const original = target[method].bind(target);
    target[method] = (...args) => original(redact(...args));
  }
  if (typeof target.assert === 'function') {
    const original = target.assert.bind(target);
    target.assert = (condition, ...args) => { if (!condition) original(false, redact(...args)); };
  }
  Object.defineProperty(target, installed, { value: true });
}

module.exports = { createLogRedactor, installLogRedaction };
