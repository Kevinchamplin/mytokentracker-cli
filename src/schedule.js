// Background sync every 30 minutes: a launchd agent on macOS, a crontab line on
// Linux. A schedule (rather than a Claude Code hook) is what covers Codex, Gemini
// and the other agents, which never fire Claude's hooks.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDir } from './config.js';

const LABEL = 'io.mytokentracker.sync';
const CRON_TAG = '# mytokentracker-sync';
const INTERVAL_MIN = 30;

const plistPath = () => join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const cliPath = () => resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'mytokentracker.js');

// A version-manager node (nvm, fnm, volta, asdf) or Homebrew's resolved Cellar
// path lives under a versioned directory that vanishes on upgrade, silently
// killing a schedule pinned to it. Prefer a stable symlink when one exists.
export function stableNode(execPath = process.execPath, exists = existsSync) {
  if (!/[\\/](\.nvm|\.fnm|fnm|\.volta|\.asdf|Cellar)[\\/]/.test(execPath)) return execPath;
  return ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'].find((p) => exists(p)) ?? execPath;
}

// npx runs from a throwaway cache dir, so a schedule must re-resolve through npx
// instead of pinning that path. A global or repo install can be called directly.
export function syncCommand() {
  const cli = cliPath();
  const node = stableNode();
  if (/[\\/]_npx[\\/]/.test(cli)) {
    const npx = join(dirname(node), 'npx');
    return [existsSync(npx) ? npx : 'npx', '-y', 'mytokentracker@latest', 'sync', '--quiet'];
  }
  return [node, cli, 'sync', '--quiet'];
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sh = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export function buildPlist(argv, logFile, pathEnv) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argv.map((a) => `    <string>${xml(a)}</string>`).join('\n')}
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${xml(pathEnv)}</string></dict>
  <key>StartInterval</key><integer>${INTERVAL_MIN * 60}</integer>
  <key>RunAtLoad</key><true/>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(logFile)}</string>
  <key>StandardErrorPath</key><string>${xml(logFile)}</string>
</dict>
</plist>
`;
}

function crontab() {
  try {
    return execFileSync('crontab', ['-l'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

export function isInstalled() {
  if (process.platform === 'darwin') return existsSync(plistPath());
  if (process.platform === 'win32') return false;
  return crontab().includes(CRON_TAG);
}

// Whether the OS scheduler actually has the job: a plist can exist while launchd
// has it unloaded. Null where there is no cheap check (cron reads its table live).
export function isLoaded() {
  if (process.platform !== 'darwin') return null;
  try {
    execFileSync('launchctl', ['print', `gui/${process.getuid()}/${LABEL}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export const logFile = () => join(configDir(), 'sync.log');

export function install() {
  const argv = syncCommand();
  const log = logFile();
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });

  if (process.platform === 'darwin') {
    const pathEnv = `${dirname(argv[0])}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin`;
    mkdirSync(dirname(plistPath()), { recursive: true });
    try {
      execFileSync('launchctl', ['bootout', `gui/${process.getuid()}`, plistPath()], { stdio: 'ignore' });
    } catch {
      /* not loaded yet */
    }
    writeFileSync(plistPath(), buildPlist(argv, log, pathEnv));
    execFileSync('launchctl', ['bootstrap', `gui/${process.getuid()}`, plistPath()], { stdio: 'ignore' });
    return `launchd agent ${LABEL} (every ${INTERVAL_MIN} min)`;
  }
  if (process.platform === 'win32') {
    return null;
  }
  const line = `*/${INTERVAL_MIN} * * * * PATH=${sh(dirname(argv[0]))}:/usr/bin:/bin ${argv.map(sh).join(' ')} >> ${sh(log)} 2>&1 ${CRON_TAG}`;
  const kept = crontab().split('\n').filter((l) => l && !l.includes(CRON_TAG));
  execFileSync('crontab', ['-'], { input: [...kept, line].join('\n') + '\n' });
  return `cron job (every ${INTERVAL_MIN} min)`;
}

export function uninstall() {
  if (process.platform === 'darwin') {
    if (!existsSync(plistPath())) return false;
    try {
      execFileSync('launchctl', ['bootout', `gui/${process.getuid()}`, plistPath()], { stdio: 'ignore' });
    } catch {
      /* not loaded */
    }
    rmSync(plistPath());
    return true;
  }
  if (process.platform === 'win32') return false;
  const cron = crontab();
  if (!cron.includes(CRON_TAG)) return false;
  const kept = cron.split('\n').filter((l) => l && !l.includes(CRON_TAG));
  execFileSync('crontab', ['-'], { input: kept.length ? kept.join('\n') + '\n' : '' });
  return true;
}
