// Keep startup failures readable before importing SDKs that require Node 22.
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 19)) {
  throw new Error(
    `Backend requires Node.js 22.19 or newer; current version: ${process.versions.node}. ` +
    "In the server directory run: nvm install && nvm use && npm start"
  );
}
