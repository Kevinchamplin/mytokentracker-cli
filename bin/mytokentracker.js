#!/usr/bin/env node
// mytokentracker: see what your AI coding agents cost, locally, and optionally
// sync it to mytokentracker.io. Usage data comes from ccusage, which reads the
// agents' own local logs; nothing here reads prompts or code.
import { closeSync, openSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { checkToken, ping, uploadBuckets } from '../src/api.js';
import { applyCutover, flattenDaily } from '../src/buckets.js';
import { runDaily } from '../src/ccusage.js';
import {
  DEFAULT_API,
  addDays,
  configDir,
  configPath,
  isoDate,
  loadConfig,
  maskToken,
  newMachineId,
  removeConfig,
  saveConfig,
} from '../src/config.js';
import { ago, isNewer, problems } from '../src/health.js';
import * as legacy from '../src/legacy.js';
import { renderReport } from '../src/report.js';
import * as schedule from '../src/schedule.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const CLIENT = { name: 'mytokentracker-cli', version: pkg.version };

const HELP = `mytokentracker ${pkg.version}

Usage:
  npx mytokentracker                 Local report, last 30 days (nothing is uploaded)
  npx mytokentracker init            Connect this machine to your mytokentracker.io account
  npx mytokentracker sync            Upload usage now (init sets this up every 30 minutes)
  npx mytokentracker status          Check the connection, last sync and any errors
  npx mytokentracker uninstall       Remove the schedule and the saved token

Options:
  --days <n>       Report window in days (default 30)
  --plan <usd>     Monthly plan price to compare against, e.g. --plan 200
  --token <t>      API token for init (or set MTT_TOKEN)
  --api <url>      Server (default ${DEFAULT_API})
  --since <date>   sync: start date YYYY-MM-DD
  --dry-run        sync: show what would upload, send nothing
  --no-schedule    init: skip the background schedule
  --yes            init: retire the old hook install without asking
  --quiet          Only print errors
`;

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    days: { type: 'string' },
    plan: { type: 'string' },
    token: { type: 'string' },
    api: { type: 'string' },
    since: { type: 'string' },
    'dry-run': { type: 'boolean' },
    'no-schedule': { type: 'boolean' },
    yes: { type: 'boolean', short: 'y' },
    quiet: { type: 'boolean', short: 'q' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  },
});

const log = (...a) => {
  if (!opt.quiet) console.log(...a);
};

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.includes(question)) rl.output.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function report() {
  const days = Math.max(1, Number(opt.days ?? 30));
  const until = isoDate();
  const since = addDays(until, -(days - 1));
  const buckets = flattenDaily(await runDaily({ since, until }));
  const plan = Number(opt.plan ?? loadConfig()?.plan ?? 0);
  console.log(renderReport(buckets, { since, until, plan }));
  if (!loadConfig()?.token) console.log('  Track it over time and across machines: npx mytokentracker init\n');
}

// launchd/cron and a manual run can overlap; the second one steps aside.
// A lock older than 20 minutes is from a crashed run and is taken over.
function withLock(fn) {
  const lock = join(configDir(), 'sync.lock');
  try {
    if (Date.now() - statSync(lock).mtimeMs > 20 * 60 * 1000) rmSync(lock);
  } catch {
    /* no lock */
  }
  let fd;
  try {
    fd = openSync(lock, 'wx');
  } catch {
    log('Another sync is already running, skipping.');
    return Promise.resolve();
  }
  closeSync(fd);
  return Promise.resolve()
    .then(fn)
    .finally(() => rmSync(lock, { force: true }));
}

// A failed sync is saved to the config so `status` can show it later; scheduled
// runs only otherwise leave it in sync.log, where nobody looks.
function sync() {
  return withLock(() =>
    syncNow().catch((e) => {
      const cfg = loadConfig();
      if (cfg?.token && !opt['dry-run']) {
        const message = (e.cause?.code ? `${e.message} (${e.cause.code})` : e.message).slice(0, 300);
        const at = new Date().toISOString();
        saveConfig({ ...cfg, lastError: { message, at }, lastAttemptAt: at });
      }
      // "fetch failed" alone tells nobody anything in sync.log.
      if (e.cause?.code && !e.message.includes(e.cause.code)) e.message = `${e.message} (${e.cause.code})`;
      throw e;
    }),
  );
}

async function syncNow() {
  const cfg = loadConfig();
  if (!cfg?.token) throw new Error('Not connected yet. Run `npx mytokentracker init` first.');
  const until = isoDate();
  const since = opt.since ?? (cfg.lastSyncDate ? addDays(cfg.lastSyncDate, -2) : addDays(until, -365));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error('--since must be YYYY-MM-DD');

  const buckets = applyCutover(flattenDaily(await runDaily({ since, until })), cfg.claudeSince);
  if (opt['dry-run']) {
    console.log(renderReport(buckets, { since, until }));
    console.log(`  Dry run: ${buckets.length} daily bucket(s) would upload to ${cfg.api}.\n`);
    return;
  }
  let upserted = 0;
  if (buckets.length) {
    upserted = await uploadBuckets({ api: cfg.api, token: cfg.token, machineId: cfg.machineId, client: CLIENT, buckets });
  } else {
    // Nothing new, but check in so the dashboard knows this machine is alive.
    const p = await ping(cfg.api, cfg.token, { machineId: cfg.machineId, client: CLIENT });
    if (p.state === 'rejected') throw new Error('The API token was rejected. Run `mytokentracker init` with a fresh token.');
    if (p.state !== 'ok') throw new Error(`Could not check in with ${cfg.api} (${p.detail ?? `HTTP ${p.status}`}).`);
  }
  const at = new Date().toISOString();
  const { lastError, ...rest } = cfg;
  saveConfig({ ...rest, lastSyncDate: until, lastSyncAt: at, lastAttemptAt: at });
  log(`Synced ${upserted} daily bucket(s), ${since} to ${until}.`);
}

async function init() {
  const prev = loadConfig();
  const api = (opt.api ?? process.env.MTT_API ?? prev?.api ?? DEFAULT_API).replace(/\/+$/, '');
  let token = opt.token ?? process.env.MTT_TOKEN;
  if (!token) {
    if (!process.stdin.isTTY) throw new Error('No token. Pass --token or set MTT_TOKEN.');
    console.log(`\nCopy your API token from ${api}/settings`);
    token = await ask('Paste it here (input is hidden): ', { hidden: true });
  }
  if (!token) throw new Error('No token entered.');

  const check = await checkToken(api, token);
  if (!check.ok) throw new Error(`That token was not accepted by ${api} (HTTP ${check.status}).`);
  log(`Token accepted (${maskToken(token)}).`);

  // The old hook install reports Claude Code usage itself. Retire it, and start
  // the CLI's Claude numbers tomorrow so no day is counted twice.
  let claudeSince = prev?.claudeSince ?? null;
  const found = legacy.detect();
  if (found.length) {
    log('\nFound the previous MyTokenTracker install:');
    found.forEach((f) => log(`  - ${f}`));
    let go = opt.yes;
    if (!go && process.stdin.isTTY) {
      go = !/^n/i.test(await ask('Replace it with the CLI? Backups are kept. [Y/n] '));
    }
    if (!go) throw new Error('Left the old install in place. Re-run with --yes to replace it.');
    const backup = join(configDir(), `legacy-backup-${Date.now()}`);
    legacy.retire(backup).forEach((d) => log(`  ${d}`));
    log(`  Backups: ${backup}`);
    claudeSince = addDays(isoDate(), 1);
    log(`  Claude Code history before ${claudeSince} is already on your dashboard, so the CLI picks up from there.`);
  }

  saveConfig({
    api,
    token,
    machineId: prev?.machineId ?? newMachineId(),
    claudeSince,
    lastSyncDate: prev?.lastSyncDate ?? null,
    plan: prev?.plan ?? (opt.plan ? Number(opt.plan) : undefined),
  });
  log(`\nSaved ${configPath()} (readable only by you).`);

  // First sync before the schedule, so launchd's RunAtLoad cannot race it.
  log('\nFirst sync (up to a year of history, this can take a minute)...');
  await sync();

  if (!opt['no-schedule']) {
    const how = schedule.install();
    log(how ? `Background sync: ${how}.` : 'Windows: add a Task Scheduler job that runs `npx -y mytokentracker sync --quiet` every 30 minutes.');
  }
  log(`\nDone. Your dashboard: ${api}/dashboard`);
}

async function status() {
  const cfg = loadConfig();
  console.log(`mytokentracker ${pkg.version}\n`);
  if (!cfg?.token) {
    console.log('Not connected. Run `npx mytokentracker init` to connect this computer.');
    return;
  }
  const connection = await ping(cfg.api, cfg.token, { machineId: cfg.machineId, client: CLIENT }, 5000);
  const scheduleInstalled = schedule.isInstalled();
  const loaded = scheduleInstalled ? schedule.isLoaded() : null;
  const label = { ok: 'Connected', rejected: 'Token rejected', unreachable: 'Server unreachable', error: 'Server error' };

  console.log(`Connection:  ${label[connection.state] ?? connection.state} (${cfg.api})`);
  console.log(`Token:       ${maskToken(cfg.token)}`);
  console.log(`Computer:    ${cfg.machineId.slice(0, 8)} (shown under Sync status on your settings page)`);
  console.log(`Last sync:   ${cfg.lastSyncAt ? `${ago(cfg.lastSyncAt)} (${new Date(cfg.lastSyncAt).toLocaleString()})` : 'never'}`);
  console.log(`Schedule:    ${scheduleInstalled ? (loaded === false ? 'installed, NOT loaded' : 'every 30 minutes') : 'not installed'}`);
  if (scheduleInstalled) console.log(`Log:         ${schedule.logFile()}`);
  if (cfg.claudeSince) console.log(`Claude from: ${cfg.claudeSince} (earlier days came from the old hook)`);

  const issues = problems({ cfg, connection, scheduleInstalled, loaded });
  const left = legacy.detect();
  if (left.length) issues.push(`The old hook install is still active (${left.join(', ')}). Run \`npx mytokentracker init\` to replace it.`);
  if (connection.latestCli && isNewer(connection.latestCli, pkg.version)) {
    issues.push(`Version ${connection.latestCli} is available (you have ${pkg.version}). Scheduled syncs pick it up on their own; a global install needs \`npm i -g mytokentracker\`.`);
  }

  console.log(issues.length ? `\n${issues.map((i) => `  ! ${i}`).join('\n')}` : '\nAll good.');
  if (issues.length && connection.state !== 'ok') process.exitCode = 1;
}

// Keeps machineId and claudeSince so a later `init` on this machine replaces
// the same rows instead of uploading a second, overlapping copy.
function uninstall() {
  const removed = schedule.uninstall();
  const cfg = loadConfig();
  if (cfg) saveConfig({ machineId: cfg.machineId, claudeSince: cfg.claudeSince, api: cfg.api });
  else removeConfig();
  console.log(`${removed ? 'Removed the background sync. ' : ''}Removed the saved token. Data already on mytokentracker.io stays there.`);
}

const commands = { report, init, sync, status, uninstall };

async function main() {
  if (opt.version) return console.log(pkg.version);
  const cmd = positionals[0] ?? 'report';
  if (opt.help || cmd === 'help' || !commands[cmd]) {
    console.log(HELP);
    if (!opt.help && cmd !== 'help' && !commands[cmd]) process.exitCode = 1;
    return;
  }
  await commands[cmd]();
}

main().catch((e) => {
  console.error(`mytokentracker: ${e.message}`);
  process.exitCode = 1;
});
