#!/usr/bin/env node
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error('Hyperbench requires Node.js 22.13 or newer. Install a current Node.js LTS release, then retry.');
  process.exit(1);
}
try { await import('../dist/cli.js'); }
catch (error) {
  console.error(error?.code === 'ERR_MODULE_NOT_FOUND' && String(error?.message).includes('/dist/cli.js')
    ? 'Build this source checkout first: npm ci && npm run build' : String(error?.message ?? error));
  process.exitCode = 1;
}
