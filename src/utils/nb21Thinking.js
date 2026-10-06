// 🧠 Nano Banana 2.1 thinking — Eki 2026 kullanıcı kararı: TÜM NB 2.1 çağrılarında thinking "high".
// NB 2.1 istekleri ~30 farklı yerden axios ile fal.run/google/nano-banana-2.1(/edit) adresine gidiyor;
// her gövdeyi tek tek değiştirmek yerine genel axios örneğine istek kancası takılır. Kanca istek gövdesi
// henüz JSON'a çevrilmeden çalışır. app_config.nb2_thinking_level ("minimal"/"off") burada EZİLİR.
// fal fiyatı: high thinking görsel başına +$0,002.
const axios = require("axios");

const NB21_URL = /^https:\/\/(?:queue\.)?fal\.run\/google\/nano-banana-2\.1(?:\/edit)?(?:[?#]|$)/;
const NB21_THINKING_LEVEL = "high";

function applyNb21Thinking(config) {
  if (
    config &&
    String(config.method || "").toLowerCase() === "post" &&
    NB21_URL.test(String(config.url || "")) &&
    config.data &&
    typeof config.data === "object" &&
    !Array.isArray(config.data)
  ) {
    config.data = { ...config.data, thinking_level: NB21_THINKING_LEVEL };
  }
  return config;
}

let installed = false;
function installNb21Thinking() {
  if (installed) return;
  installed = true;
  axios.interceptors.request.use(applyNb21Thinking);
}

module.exports = { installNb21Thinking, applyNb21Thinking, NB21_THINKING_LEVEL };
