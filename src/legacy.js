// Detects and retires the pre-CLI capture paths (the curl | bash installer):
// Claude Code hooks pointing at ~/.claude/hooks/mtt-*, the heartbeat daemon's
// launchd agent (macOS) or cron line (Linux). They read the same transcripts
// ccusage reads, so leaving them running alongside the CLI double counts Claude.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LEGACY_CMD = /\.claude\/hooks\/mtt-[a-z-]+\.(sh|py)\b/;
const PLIST_LABEL = 'io.mytokentracker.heartbeat';

export const paths = () => ({
  settings: join(homedir(), '.claude', 'settings.json'),
  plist: join(homedir(), 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`),
});

// Pure: returns { settings, removed } with every legacy hook command stripped.
// Empty hook groups and empty event arrays are dropped; everything else is kept.
export function stripLegacyHooks(settings) {
  const removed = [];
  if (!settings || typeof settings !== 'object' || !settings.hooks) return { settings, removed };
  const hooks = {};
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) {
      hooks[event] = groups;
      continue;
    }
    const kept = [];
    for (const g of groups) {
      if (!g || !Array.isArray(g.hooks)) {
        kept.push(g);
        continue;
      }
      const inner = g.hooks.filter((h) => {
        const legacy = typeof h?.command === 'string' && LEGACY_CMD.test(h.command);
        if (legacy) removed.push(`${event}: ${h.command}`);
        return !legacy;
      });
      if (inner.length) kept.push({ ...g, hooks: inner });
    }
    if (kept.length) hooks[event] = kept;
  }
  return { settings: { ...settings, hooks }, removed };
}

function readCrontab() {
  try {
    return execFileSync('crontab', ['-l'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

export function detect() {
  const p = paths();
  const found = [];
  if (existsSync(p.settings)) {
    try {
      const { removed } = stripLegacyHooks(JSON.parse(readFileSync(p.settings, 'utf8')));
      found.push(...removed.map((r) => `Claude Code hook (${r.split(':')[0]})`));
    } catch {
      /* unreadable settings: nothing we can safely detect or change */
    }
  }
  if (process.platform === 'darwin' && existsSync(p.plist)) found.push(`launchd agent ${PLIST_LABEL}`);
  if (process.platform !== 'darwin' && process.platform !== 'win32' && /mtt-heartbeat-daemon/.test(readCrontab())) {
    found.push('cron heartbeat daemon');
  }
  return found;
}

// Side effects, each backed up first into backupDir.
export function retire(backupDir) {
  const p = paths();
  const done = [];
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });

  if (existsSync(p.settings)) {
    const raw = readFileSync(p.settings, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (parsed) {
      const { settings, removed } = stripLegacyHooks(parsed);
      if (removed.length) {
        copyFileSync(p.settings, join(backupDir, 'claude-settings.json'));
        writeFileSync(p.settings, JSON.stringify(settings, null, 2) + '\n');
        done.push(`removed ${removed.length} legacy hook(s) from ~/.claude/settings.json`);
      }
    }
  }

  if (process.platform === 'darwin' && existsSync(p.plist)) {
    try {
      execFileSync('launchctl', ['bootout', `gui/${process.getuid()}`, p.plist], { stdio: 'ignore' });
    } catch {
      /* not loaded */
    }
    renameSync(p.plist, join(backupDir, `${PLIST_LABEL}.plist`));
    done.push(`stopped and removed launchd agent ${PLIST_LABEL}`);
  }

  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    const cron = readCrontab();
    if (/mtt-heartbeat-daemon/.test(cron)) {
      writeFileSync(join(backupDir, 'crontab.txt'), cron);
      const next = cron.split('\n').filter((l) => !/mtt-heartbeat-daemon/.test(l)).join('\n');
      execFileSync('crontab', ['-'], { input: next.endsWith('\n') ? next : next + '\n' });
      done.push('removed the cron heartbeat daemon');
    }
  }

  const pidFile = '/tmp/mtt-heartbeat-daemon.pid';
  if (existsSync(pidFile)) {
    try {
      // A stale pid file (reboot, pid reuse) could name an unrelated process,
      // so only kill it if it really is the heartbeat daemon.
      const pid = Number(readFileSync(pidFile, 'utf8').trim());
      const cmd = pid > 1 ? execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }) : '';
      if (/mtt-heartbeat/.test(cmd)) {
        process.kill(pid);
        done.push('stopped the running heartbeat daemon');
      }
    } catch {
      /* already gone */
    }
  }
  return done;
}
