const send = require("send");

if (typeof send.mime?.charsets?.lookup !== "function") {
  console.error(
    "❌ mime kurulumu bozuk: send.mime.charsets yok. node_modules silip npm install çalıştır.",
  );
  process.exit(1);
}

const topLevelMime = require("mime/package.json").version;
if (topLevelMime !== "1.6.0") {
  console.error(`❌ mime sürümü hatalı: ${topLevelMime} (beklenen 1.6.0)`);
  process.exit(1);
}

console.log("✅ mime 1.6.0 doğrulandı");
