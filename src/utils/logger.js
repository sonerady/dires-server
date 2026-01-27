/**
 * Centralized Logger Utility
 *
 * Varsayılan: Sadece error logları görünür
 * DEBUG_LOGS=true ile tüm loglar açılır
 */

const isDebug = process.env.DEBUG_LOGS === 'true';

const logger = {
  // Her zaman göster - kritik hatalar
  error: (...args) => console.error(...args),

  // Her zaman göster - önemli uyarılar
  warn: (...args) => console.warn(...args),

  // Sadece DEBUG modda göster
  log: (...args) => {
    if (isDebug) console.log(...args);
  },

  info: (...args) => {
    if (isDebug) console.log(...args);
  },

  debug: (...args) => {
    if (isDebug) console.log(...args);
  }
};

module.exports = logger;
