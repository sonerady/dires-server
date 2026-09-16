const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const supported = version => {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 19);
};

function selectNode() {
  if (supported(process.versions.node)) return process.execPath;
  const pinned = fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim();
  const nvm = process.env.NVM_DIR || path.join(os.homedir(), '.nvm');
  const candidates = [
    path.join(nvm, 'versions', 'node', `v${pinned}`, 'bin', 'node'),
    ...((process.env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, 'node'))),
  ];
  for (const candidate of new Set(candidates)) {
    if (!fs.existsSync(candidate)) continue;
    const result = spawnSync(candidate, ['-p', 'process.versions.node'], { encoding: 'utf8', timeout: 5000 });
    if (result.status === 0 && supported(result.stdout.trim())) return candidate;
  }
  throw new Error('Node.js 22.19+ is required. Run: nvm install && nvm use && npm start');
}

try {
  const node = selectNode();
  if (node !== process.execPath) console.log('[Backend] Switching from Node ' + process.versions.node + ' to ' + node);
  const child = spawn(node, [require.resolve('nodemon/bin/nodemon.js'), 'src/app.js'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PATH: path.dirname(node) + path.delimiter + (process.env.PATH || '') },
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1); });
} catch (error) {
  console.error('[Backend] ' + error.message);
  process.exitCode = 1;
}
