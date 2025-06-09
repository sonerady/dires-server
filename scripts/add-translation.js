const fs = require("fs");
const path = require("path");

// Script kullanımı: node add-translation.js <lang> <section> <json-file>
// Örnek: node add-translation.js tr photoUpload ./translations/photoUpload.json

function addTranslation(language, section, translationData) {
  try {
    // Client locales klasör yolu
    const localesPath = path.join(__dirname, "../../client/locales");
    const targetFile = path.join(localesPath, `${language}.json`);

    // Hedef dosya var mı kontrol et
    if (!fs.existsSync(targetFile)) {
      console.error(`❌ ${language}.json dosyası bulunamadı: ${targetFile}`);
      return false;
    }

    // Mevcut JSON dosyasını oku
    const fileContent = fs.readFileSync(targetFile, "utf8");
    let jsonData;

    try {
      jsonData = JSON.parse(fileContent);
    } catch (parseError) {
      console.error(
        `❌ ${language}.json dosyası parse edilemedi:`,
        parseError.message
      );
      return false;
    }

    // Translation dosyasında section adı ile aynı key varsa, onun içeriğini al
    // Yoksa tüm dosya içeriğini kullan
    let dataToAdd;
    if (translationData[section]) {
      dataToAdd = translationData[section];
      console.log(
        `📋 Translation dosyasında '${section}' key'i bulundu, içeriği kullanılıyor`
      );
    } else {
      dataToAdd = translationData;
      console.log(
        `📋 Translation dosyasında '${section}' key'i bulunamadı, tüm içerik kullanılıyor`
      );
    }

    // Yeni section'ı ekle
    jsonData[section] = dataToAdd;

    // JSON dosyasını güzel formatta yazı
    const updatedContent = JSON.stringify(jsonData, null, 2);

    // Dosyayı güncelle
    fs.writeFileSync(targetFile, updatedContent, "utf8");

    console.log(
      `✅ ${language}.json dosyasına '${section}' bölümü başarıyla eklendi!`
    );
    return true;
  } catch (error) {
    console.error(`❌ Hata oluştu:`, error.message);
    return false;
  }
}

// Komut satırı parametrelerini al
const args = process.argv.slice(2);

if (args.length < 3) {
  console.log(`
🌍 Translation Ekleme Script'i

Kullanım:
  node add-translation.js <dil> <section> <json-file>

Parametreler:
  <dil>       : Hedef dil kodu (tr, en, de, es, fr, vb.)
  <section>   : Eklenecek section adı (photoUpload, tryOnModeSelection, vb.)
  <json-file> : Translation verilerini içeren JSON dosyası yolu

Örnekler:
  node add-translation.js tr photoUpload ./translations/photoUpload-tr.json
  node add-translation.js en photoUpload ./translations/photoUpload-en.json
  node add-translation.js de photoUpload ./translations/photoUpload-de.json
  `);
  process.exit(1);
}

const [language, section, jsonFilePath] = args;

// JSON dosyasını oku
if (!fs.existsSync(jsonFilePath)) {
  console.error(`❌ Translation dosyası bulunamadı: ${jsonFilePath}`);
  process.exit(1);
}

try {
  const translationContent = fs.readFileSync(jsonFilePath, "utf8");
  const translationData = JSON.parse(translationContent);

  console.log(`🔄 ${language}.json dosyasına '${section}' bölümü ekleniyor...`);

  const success = addTranslation(language, section, translationData);

  if (success) {
    console.log(`🎉 İşlem tamamlandı!`);
  } else {
    process.exit(1);
  }
} catch (error) {
  console.error(`❌ Translation dosyası parse edilemedi:`, error.message);
  process.exit(1);
}
