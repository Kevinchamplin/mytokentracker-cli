// Pure helpers behind `mytokentracker status`, kept free of I/O so they can be tested.

export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

export function ago(iso, now = Date.now()) {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (Number.isNaN(s)) return 'unknown';
  if (s < 90) return 'just now';
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function isNewer(latest, current) {
  const parse = (v) => String(v ?? '').split('-')[0].split('.').map((n) => Number(n) || 0);
  const [a, b] = [parse(latest), parse(current)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export function categorize(message = '') {
  if (/token was rejected|HTTP 401|HTTP 403/i.test(message)) return 'token';
  if (/rate limited|HTTP 429/i.test(message)) return 'rate';
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|timed out|network/i.test(message)) return 'network';
  if (/ccusage|ENOENT|spawn/i.test(message)) return 'logs';
  if (/HTTP 5\d\d/.test(message)) return 'server';
  return 'other';
}

const HINTS = {
  token: 'Get a fresh token from your settings page and run `npx mytokentracker init` again.',
  rate: 'Nothing to do: the next scheduled sync retries.',
  network: 'This computer could not reach the server. It retries every 30 minutes once the connection is back.',
  logs: 'Reading the local agent logs failed. Run `npx mytokentracker sync` to see the full error.',
  server: 'The server had a problem. It retries every 30 minutes.',
  other: 'Run `npx mytokentracker sync` to try again and see the full error.',
};

// Plain-language next step for an error message the CLI recorded.
export function hintFor(message = '') {
  return HINTS[categorize(message)];
}

/**
 * Problems worth showing, most serious first. `connection` is ping()'s result,
 * `loaded` is whether the OS scheduler has the job (null when unknown).
 */
export function problems({ cfg, connection, scheduleInstalled, loaded, now = Date.now() }) {
  const out = [];
  if (connection?.state === 'rejected') out.push('The server rejected the saved token. Get a fresh one from your settings page and run `npx mytokentracker init`.');
  else if (connection?.state === 'unreachable') out.push(`Could not reach ${cfg.api} (${connection.detail}). Check your internet connection.`);
  else if (connection?.state === 'error') out.push(`The server answered with HTTP ${connection.status}. Try again in a few minutes.`);

  // Skip a recorded error that only repeats what the live check just said.
  const repeat = { rejected: 'token', unreachable: 'network' }[connection?.state];
  if (cfg.lastError?.message && categorize(cfg.lastError.message) !== repeat) {
    out.push(`Last sync failed ${ago(cfg.lastError.at, now)}: ${cfg.lastError.message}\n             ${hintFor(cfg.lastError.message)}`);
  }
  if (!scheduleInstalled) out.push('Background sync is not set up, so nothing uploads on its own. Run `npx mytokentracker init` to add it.');
  else if (loaded === false) out.push('The background sync is installed but not loaded. Run `npx mytokentracker init` again to reload it.');
  else if (!cfg.lastSyncAt && !cfg.lastAttemptAt) out.push('This computer has not synced yet. Run `npx mytokentracker sync` to start now.');
  else {
    const last = Date.parse(cfg.lastAttemptAt ?? cfg.lastSyncAt ?? '');
    if (!Number.isNaN(last) && now - last > STALE_AFTER_MS) {
      out.push(`No sync has run for ${ago(new Date(last).toISOString(), now).replace(' ago', '')}. Normal if this computer was asleep; otherwise check the log below.`);
    }
  }
  return out;
}
