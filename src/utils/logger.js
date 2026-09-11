const { createLogRedactor } = require("./logRedaction");
const redactLog = createLogRedactor();
/**
 * Centralized Logger Utility
 *
 * Varsayılan: Sadece error logları görünür
 * DEBUG_LOGS=true ile tüm loglar açılır
 */

const isDebug = process.env.DEBUG_LOGS === 'true';

const logger = {
  // Her zaman göster - kritik hatalar
  error: (...args) => console.error(redactLog(...args)),

  // Her zaman göster - önemli uyarılar
  warn: (...args) => console.warn(redactLog(...args)),

  // Sadece DEBUG modda göster
  log: (...args) => {
    if (isDebug) console.log(redactLog(...args));
  },

  info: (...args) => {
    if (isDebug) console.log(redactLog(...args));
  },

  debug: (...args) => {
    if (isDebug) console.log(redactLog(...args));
  }
};

module.exports = logger;
