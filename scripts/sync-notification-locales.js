// Run from the workspace when notification translations change. The generated
// catalog is committed with the server and requires no client files in production.
const fs = require('node:fs');
const path = require('node:path');
const source = path.resolve(__dirname, '../../client/locales');
const target = path.resolve(__dirname, '../locales/notifications.json');
const catalog = {};
for (const file of fs.readdirSync(source).sort()) {
  if (!file.endsWith('.json') || file === 'web.json') continue;
  const notification = JSON.parse(fs.readFileSync(path.join(source, file), 'utf8')).notification;
  if (!notification?.generationCompletedTitle || !notification?.generationCompletedBody) {
    throw new Error(`Missing generation notification translation: ${file}`);
  }
  catalog[file.slice(0, -5)] = notification;
}
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(catalog, null, 2) + '\n');
console.log(`Bundled notification translations: ${Object.keys(catalog).length} languages`);
