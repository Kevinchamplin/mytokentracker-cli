import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_API = 'https://mytokentracker.io';

export function configDir() {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'mytokentracker');
}

export const configPath = () => join(configDir(), 'config.json');

export function loadConfig() {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8'));
  } catch {
    return null;
  }
}

// The file holds the API token, so it is written owner-only.
export function saveConfig(cfg) {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  chmodSync(configPath(), 0o600);
}

export function removeConfig() {
  if (existsSync(configPath())) rmSync(configPath());
}

export const newMachineId = () => randomBytes(8).toString('hex');

export function maskToken(t) {
  return t ? `...${String(t).slice(-4)}` : '(none)';
}

export function isoDate(d = new Date()) {
  // Local calendar date, matching ccusage's --timezone grouping.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDate(new Date(y, m - 1, d + n));
}
