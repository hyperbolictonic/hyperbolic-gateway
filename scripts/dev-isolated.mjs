/**
 * Start the dev build as a second, independent instance.
 *
 * Electron scopes the single-instance lock to `userData`, and a dev run and an
 * installed build derive the same directory from the package name. This script
 * gives the dev run its own profile and bridge port so both can run at once,
 * and prints the MCP client config that points at the dev bridge.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

const port = (process.env.HB_BRIDGE_PORT || '4113').trim();
const base = process.env.APPDATA || path.join(process.env.HOME || process.env.USERPROFILE || '.', '.config');
const profile = process.env.HB_USER_DATA_DIR || path.join(base, 'hypagon-gateway-dev');
const repo = process.cwd();

const config = {
  mcpServers: {
    'hb-browser-dev': {
      command: 'node',
      args: [path.join(repo, 'bin', 'mcp-server.cjs')],
      env: {
        HB_BRIDGE_URL: `http://127.0.0.1:${port}`,
        HB_WRAP_TOKEN_FILE: path.join(profile, 'wrap', 'token'),
      },
    },
  },
};

console.log('');
console.log(`  profile  ${profile}`);
console.log(`  bridge   http://127.0.0.1:${port}`);
console.log('');
console.log('  MCP client config for the dev instance:');
console.log('');
console.log(JSON.stringify(config, null, 2));
console.log('');
console.log('  The dev window\'s Settings → MCP Clients tab generates the same config.');
console.log('');

if (process.argv.includes('--print-only')) process.exit(0);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npm, ['run', 'dev'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, HB_USER_DATA_DIR: profile, HB_BRIDGE_PORT: port },
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
