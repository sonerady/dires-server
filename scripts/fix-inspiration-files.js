const fs = require("fs");
const path = require("path");

const languages = ["de", "es", "fr", "it", "ja", "ko", "pt", "ru", "zh"];

console.log("🔄 Inspiration dosyaları düzenleniyor...");

languages.forEach((lang) => {
  const filePath = path.join(
    __dirname,
    "translations",
    `inspiration-${lang}.json`
  );

  if (fs.existsSync(filePath)) {
    try {
      // Mevcut dosyayı oku
      const fileContent = fs.readFileSync(filePath, "utf8");
      const data = JSON.parse(fileContent);

      // Eğer zaten "inspiration" key'i varsa, düzenleme yapma
      if (data.inspiration) {
        console.log(`✅ ${lang}.json zaten doğru formatta`);
        return;
      }

      // Yeni format: tüm içeriği "inspiration" objesi içine al
      const newData = {
        inspiration: data,
      };

      // Dosyayı yaz
      fs.writeFileSync(filePath, JSON.stringify(newData, null, 2), "utf8");
      console.log(`✅ ${lang}.json dosyası düzenlendi`);
    } catch (error) {
      console.error(`❌ ${lang}.json dosyası düzenlenemedi:`, error.message);
    }
  } else {
    console.log(`⚠️ ${lang}.json dosyası bulunamadı`);
  }
});

console.log("🎉 Tüm dosyalar düzenlendi!");
