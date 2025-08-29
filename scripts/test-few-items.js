const fs = require("fs");
const path = require("path");

// .env dosyasının doğru path'ini belirt
require("dotenv").config({ path: path.join(__dirname, "../.env") });

// AccessoryLibrary'yi import et
const { accessoryLibrary } = require("../temp/accessoryLibrary_relevant.js");

console.log("🧪 Casual kategorisindeki ilk 5 item:");
const casualItems = accessoryLibrary["Casual"];
casualItems.slice(0, 5).forEach((item, index) => {
  console.log(
    `${index + 1}. ${item.name} (for_localize: ${item.for_localize})`
  );
});

console.log("\n🧪 Tüm kategorilerdeki ilk item:");
Object.keys(accessoryLibrary).forEach((category) => {
  const firstItem = accessoryLibrary[category][0];
  console.log(`${category}: ${firstItem.name}`);
});

console.log("\n🎨 Renk testi:");
// Basit renk counter test
const COLOR_PALETTE = ["#FF6B6B", "#E74C3C", "#C0392B", "#FF1744", "#D32F2F"];

let colorCounter = 0;

function getTestColor(accessoryName) {
  const colorIndex = colorCounter % COLOR_PALETTE.length;
  const selectedColor = COLOR_PALETTE[colorIndex];
  colorCounter++;
  console.log(`${accessoryName} -> Renk #${colorIndex + 1}: ${selectedColor}`);
  return selectedColor;
}

casualItems.slice(0, 5).forEach((item) => {
  getTestColor(item.name);
});
