import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const PINNED = '20.0.26';

// Prefer the pinned dependency; fall back to npx only if it is somehow missing.
function resolveCli() {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require.resolve('ccusage/package.json');
    return { cmd: process.execPath, pre: [join(dirname(pkg), 'src', 'cli.js')] };
  } catch {
    return { cmd: process.platform === 'win32' ? 'npx.cmd' : 'npx', pre: ['-y', `ccusage@${PINNED}`] };
  }
}

export function localTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

// Returns parsed JSON of `ccusage daily --json --by-agent --breakdown`.
export function runDaily({ since, until, timezone = localTimezone() } = {}) {
  const { cmd, pre } = resolveCli();
  const args = [...pre, 'daily', '--json', '--by-agent', '--breakdown', '--timezone', timezone];
  if (since) args.push('--since', since.replaceAll('-', ''));
  if (until) args.push('--until', until.replaceAll('-', ''));

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ccusage exited ${code}: ${err.trim().split('\n').slice(-3).join(' ')}`));
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error('ccusage returned output that is not JSON'));
      }
    });
  });
}
